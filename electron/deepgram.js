// Streams two-channel PCM (ch0 = mic, ch1 = system audio) to Deepgram's live API and
// emits transcript events. Runs in the main process so the API key never reaches the UI.
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const MAX_QUEUE_BYTES = 4 * 1024 * 1024;
const MAX_RETRIES = 6;

export class TranscriptionSession extends EventEmitter {
  // `authorize` returns the Authorization header for each new connection, e.g. a fresh
  // short-lived token from CG Core. `apiKey` is the simple alternative for a user's own key.
  constructor({ apiKey, authorize, source = authorize ? 'core' : 'own', model = 'nova-3', language = 'en', keyterms = [], sampleRate = 16000, offsetSec = 0, url }) {
    super();
    Object.assign(this, { model, language, keyterms, sampleRate, offsetSec, source });
    this.authorize = authorize || (async () => `Token ${apiKey}`);
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

  async connect() {
    this.connOffset = this.offsetSec + this.bytesSent / this.bytesPerSec;
    this.emit('status', { state: 'connecting' });
    let authorization;
    try {
      authorization = await this.authorize();
    } catch (err) {
      // A revoked sign-in or missing setup won't fix itself; network blips might.
      if (err.status === 401 || err.status === 503 || err.status === 403) {
        this.fatal = true;
        this.emit('error', err);
      } else this.scheduleReconnect(err.message);
      return;
    }
    if (this.stopping) return;
    const ws = new WebSocket(this.url(), { headers: { Authorization: authorization } });
    this.ws = ws;

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
          ? this.source === 'own'
            ? 'Deepgram rejected your own Deepgram key (Settings → Your own API keys). Remove it to use CG Core instead.'
            : "Deepgram rejected CG Core's transcription token. Ask a CG Core admin to check the Deepgram key in Core."
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
      this.scheduleReconnect();
    });
  }

  scheduleReconnect(reason) {
    if (this.retries >= MAX_RETRIES) {
      this.fatal = true;
      this.emit('error', new Error(`Lost connection to Deepgram and could not reconnect${reason ? ` (${reason})` : ''}.`));
      return;
    }
    const delay = Math.min(500 * 2 ** this.retries++, 8000);
    this.emit('status', { state: 'reconnecting', inMs: delay });
    setTimeout(() => !this.stopping && this.connect(), delay);
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
