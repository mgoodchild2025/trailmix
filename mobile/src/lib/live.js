// Live transcription from the phone microphone: one channel, 16 kHz 16-bit PCM, straight
// to Deepgram with a short-lived token from CG Core (fetched again on every reconnect).
// Speakers come from Deepgram's diarisation, so segments are marked mono.

const MAX_QUEUE_BYTES = 2 * 1024 * 1024;
const MAX_RETRIES = 6;

export class LiveTranscriber {
  constructor({ authorize, model = 'nova-3', language = 'en', keyterms = [], sampleRate = 16000, offsetSec = 0, onFinal, onInterim, onStatus, onError }) {
    Object.assign(this, { authorize, model, language, keyterms, sampleRate, offsetSec, onFinal, onInterim, onStatus, onError });
    this.queue = [];
    this.queued = 0;
    this.bytesSent = 0;
    this.retries = 0;
    this.n = 0;
    this.stopping = false;
  }

  url() {
    const p = new URLSearchParams({
      model: this.model, encoding: 'linear16', sample_rate: String(this.sampleRate), channels: '1',
      punctuate: 'true', smart_format: 'true', interim_results: 'true', diarize: 'true', endpointing: '300',
    });
    if (this.language) p.set('language', this.language);
    for (const k of this.keyterms) p.append('keyterm', k);
    return `wss://api.deepgram.com/v1/listen?${p}`;
  }

  start() {
    this.connect();
    this.keepAlive = setInterval(() => {
      if (this.ws?.readyState === 1 && Date.now() - (this.lastSend || 0) > 4000) this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
    }, 4000);
  }

  async connect() {
    this.connOffset = this.offsetSec + this.bytesSent / (this.sampleRate * 2);
    this.onStatus?.('connecting');
    let authorization;
    try {
      authorization = await this.authorize();
    } catch (err) {
      if ([401, 403, 503].includes(err.status)) return this.fail(err);
      return this.retry();
    }
    if (this.stopping) return;
    // React Native's WebSocket takes headers as a third argument.
    const ws = new WebSocket(this.url(), [], { headers: { Authorization: authorization } });
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.onStatus?.('open');
      for (const b of this.queue) this.rawSend(b);
      this.queue = [];
      this.queued = 0;
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type !== 'Results') return;
      const alt = msg.channel?.alternatives?.[0];
      const text = alt?.transcript?.trim();
      if (!msg.is_final) return this.onInterim?.(text || '');
      if (!text) return;
      const start = this.connOffset + (msg.start || 0);
      this.onFinal?.({ id: `${Date.now().toString(36)}-${this.n++}`, channel: 0, mono: true, speaker: dominantSpeaker(alt.words), text, start, end: start + (msg.duration || 0) });
    };
    ws.onerror = () => {};
    ws.onclose = (e) => {
      if (this.stopping || this.fatal) return this.onStatus?.('closed');
      if (e.code === 1008 || e.code === 4001) return this.fail(new Error("Deepgram rejected CG Core's transcription token."));
      this.retry();
    };
  }

  retry() {
    if (this.retries >= MAX_RETRIES) return this.fail(new Error('Lost the connection to the transcription service.'));
    const delay = Math.min(500 * 2 ** this.retries++, 8000);
    this.onStatus?.('reconnecting');
    setTimeout(() => !this.stopping && this.connect(), delay);
  }

  fail(err) {
    this.fatal = true;
    this.onError?.(err);
  }

  rawSend(bytes) {
    this.ws.send(bytes);
    this.bytesSent += bytes.byteLength;
    this.lastSend = Date.now();
  }

  send(bytes) {
    if (this.stopping) return;
    if (this.ws?.readyState === 1) return this.rawSend(bytes);
    this.queue.push(bytes);
    this.queued += bytes.byteLength;
    while (this.queued > MAX_QUEUE_BYTES) this.queued -= this.queue.shift().byteLength;
  }

  stop() {
    this.stopping = true;
    clearInterval(this.keepAlive);
    return new Promise((resolve) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== 1) {
        ws?.close();
        return resolve();
      }
      const t = setTimeout(() => (ws.close(), resolve()), 4000);
      ws.onclose = () => (clearTimeout(t), resolve());
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

// The recorder hands over base64 PCM; Deepgram wants the raw bytes.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;

export function base64ToBytes(b64) {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)], b = LOOKUP[clean.charCodeAt(i + 1)];
    const c = LOOKUP[clean.charCodeAt(i + 2)], d = LOOKUP[clean.charCodeAt(i + 3)];
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < len) out[o++] = (n >> 16) & 255;
    if (o < len) out[o++] = (n >> 8) & 255;
    if (o < len) out[o++] = n & 255;
  }
  return out;
}

// RMS level of 16-bit little-endian PCM, 0..1, for the level meter.
export function pcmLevel(bytes) {
  let sum = 0;
  const n = bytes.length >> 1;
  for (let i = 0; i < n; i++) {
    let v = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    if (v & 0x8000) v -= 0x10000;
    sum += (v / 32768) ** 2;
  }
  return n ? Math.sqrt(sum / n) : 0;
}
