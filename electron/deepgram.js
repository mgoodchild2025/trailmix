// Streams two-channel PCM (ch0 = mic, ch1 = system audio) to Deepgram's live API and
// emits transcript events. Runs in the main process so the API key never reaches the UI.
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const MAX_QUEUE_BYTES = 4 * 1024 * 1024;
const MAX_RETRIES = 6;

export class TranscriptionSession extends EventEmitter {
  constructor({ apiKey, model = 'nova-3', language = 'en', keyterms = [], sampleRate = 16000, offsetSec = 0, url }) {
    super();
    Object.assign(this, { apiKey, model, language, keyterms, sampleRate, offsetSec });
    this.baseUrl = url || 'wss://api.deepgram.com/v1/listen';
    this.queue = [];
    this.queuedBytes = 0;
    this.bytesSent = 0;
    this.connOffset = offsetSec; // audio time at which the current connection started
    this.retries = 0;
    this.stopping = false;
    this.lastSend = 0;
  }

  get bytesPerSec() {
    return this.sampleRate * 2 /* channels */ * 2 /* bytes */;
  }

  url() {
    const p = new URLSearchParams({
      model: this.model,
      encoding: 'linear16',
      sample_rate: String(this.sampleRate),
      channels: '2',
      multichannel: 'true',
      punctuate: 'true',
      smart_format: 'true',
      interim_results: 'true',
      diarize: 'true',
      endpointing: '300',
    });
    if (this.language) p.set('language', this.language);
    for (const k of this.keyterms) p.append(this.model.startsWith('nova-3') ? 'keyterm' : 'keywords', k);
    return `${this.baseUrl}?${p}`;
  }

  start() {
    this.connect();
    this.keepAlive = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastSend > 4000)
        this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
    }, 4000);
  }

  connect() {
    this.connOffset = this.offsetSec + this.bytesSent / this.bytesPerSec;
    const ws = new WebSocket(this.url(), { headers: { Authorization: `Token ${this.apiKey}` } });
    this.ws = ws;
    this.emit('status', { state: 'connecting' });

    ws.on('open', () => {
      this.retries = 0;
      this.emit('status', { state: 'open' });
      for (const buf of this.queue) this.rawSend(buf);
      this.queue = [];
      this.queuedBytes = 0;
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type !== 'Results') return;
      const alt = msg.channel?.alternatives?.[0];
      if (!alt) return;
      this.emit('transcript', {
        channel: msg.channel_index?.[0] ?? 0,
        isFinal: !!msg.is_final,
        text: alt.transcript || '',
        speaker: dominantSpeaker(alt.words),
        start: this.connOffset + (msg.start || 0),
        end: this.connOffset + (msg.start || 0) + (msg.duration || 0),
      });
    });

    ws.on('unexpected-response', (_req, res) => {
      const msg =
        res.statusCode === 401
          ? 'Deepgram rejected the API key. Check it in Settings.'
          : `Deepgram refused the connection (HTTP ${res.statusCode}).`;
      this.fatal = true;
      this.emit('error', new Error(msg));
    });

    ws.on('error', (err) => {
      if (!this.fatal) this.emit('status', { state: 'error', message: err.message });
    });

    ws.on('close', () => {
      if (this.stopping || this.fatal) {
        this.emit('status', { state: 'closed' });
        return;
      }
      if (this.retries >= MAX_RETRIES) {
        this.emit('error', new Error('Lost connection to Deepgram and could not reconnect.'));
        return;
      }
      const delay = Math.min(500 * 2 ** this.retries++, 8000);
      this.emit('status', { state: 'reconnecting', inMs: delay });
      setTimeout(() => !this.stopping && this.connect(), delay);
    });
  }

  rawSend(buf) {
    this.ws.send(buf);
    this.bytesSent += buf.byteLength;
    this.lastSend = Date.now();
  }

  sendAudio(buf) {
    if (this.stopping) return;
    if (this.ws?.readyState === WebSocket.OPEN) return this.rawSend(buf);
    // Hold audio while (re)connecting so nothing said during a blip is lost.
    this.queue.push(buf);
    this.queuedBytes += buf.byteLength;
    while (this.queuedBytes > MAX_QUEUE_BYTES) this.queuedBytes -= this.queue.shift().byteLength;
  }

  // Ask Deepgram to flush final results, then close.
  stop() {
    this.stopping = true;
    clearInterval(this.keepAlive);
    return new Promise((resolve) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        ws?.terminate();
        return resolve();
      }
      const t = setTimeout(() => {
        ws.terminate();
        resolve();
      }, 4000);
      ws.once('close', () => {
        clearTimeout(t);
        resolve();
      });
      ws.send(JSON.stringify({ type: 'CloseStream' }));
    });
  }
}

function dominantSpeaker(words = []) {
  const counts = new Map();
  for (const w of words) if (w.speaker != null) counts.set(w.speaker, (counts.get(w.speaker) || 0) + 1);
  let best = null;
  let n = 0;
  for (const [s, c] of counts) if (c > n) [best, n] = [s, c];
  return best;
}
