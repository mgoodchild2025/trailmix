// Captures the microphone and system audio, mixes them into a 2-channel 16-bit PCM
// stream (ch0 = mic / "Me", ch1 = system / "Them") and hands ~100 ms chunks to onAudio.

const WORKLET = `
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frames = Math.round(sampleRate / 10);
    this.buf = new Int16Array(this.frames * 2);
    this.n = 0;
    this.paused = false;
    this.sq = [0, 0]; this.peak = [0, 0]; this.count = 0;
    this.port.onmessage = (e) => { if (e.data.type === 'pause') this.paused = e.data.value; };
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const a = input[0], b = input[1];
    for (let i = 0; i < a.length; i++) {
      const l = a[i], r = b ? b[i] : 0;
      this.sq[0] += l * l; this.sq[1] += r * r;
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > this.peak[0]) this.peak[0] = al;
      if (ar > this.peak[1]) this.peak[1] = ar;
      this.buf[this.n++] = Math.max(-1, Math.min(1, l)) * 0x7fff;
      this.buf[this.n++] = Math.max(-1, Math.min(1, r)) * 0x7fff;
      if (this.n === this.buf.length) {
        if (!this.paused) {
          const out = this.buf.slice().buffer;
          this.port.postMessage({ type: 'audio', buf: out }, [out]);
        }
        this.port.postMessage({ type: 'level', mic: Math.sqrt(this.sq[0] / this.frames), sys: Math.sqrt(this.sq[1] / this.frames), micPeak: this.peak[0], sysPeak: this.peak[1] });
        this.n = 0; this.sq = [0, 0]; this.peak = [0, 0];
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
`;

export class Recorder {
  constructor({ onAudio, onLevel } = {}) {
    this.onAudio = onAudio;
    this.onLevel = onLevel;
    this.streams = [];
  }

  async start({ wantSystemAudio = true } = {}) {
    const warnings = [];
    this.ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    let mic;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      this.streams.push(mic);
    } catch (err) {
      await this.stop();
      throw new Error(`Microphone unavailable: ${err.message}. Check microphone permission for Trailmix.`);
    }

    let sys = null;
    if (wantSystemAudio) {
      try {
        sys = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        for (const t of sys.getVideoTracks()) {
          t.stop();
          sys.removeTrack(t);
        }
        if (!sys.getAudioTracks().length) {
          sys = null;
          warnings.push('System audio is not available. Only your microphone is being transcribed.');
        } else this.streams.push(sys);
      } catch (err) {
        sys = null;
        warnings.push(`Couldn't capture system audio (${err.message}). Only your microphone is being transcribed.`);
      }
    }

    const merger = this.ctx.createChannelMerger(2);
    this.ctx.createMediaStreamSource(mic).connect(merger, 0, 0);
    if (sys) this.ctx.createMediaStreamSource(sys).connect(merger, 0, 1);

    this.node = new AudioWorkletNode(this.ctx, 'pcm-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
    });
    merger.connect(this.node);
    // The worklet must be connected to the destination to be pulled; keep it silent.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);

    this.node.port.onmessage = (e) => {
      if (e.data.type === 'audio') this.onAudio?.(e.data.buf);
      else this.onLevel?.(e.data);
    };
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    return { sampleRate: this.ctx.sampleRate, systemAudio: !!sys, warnings };
  }

  setPaused(paused) {
    this.node?.port.postMessage({ type: 'pause', value: paused });
  }

  async stop() {
    for (const s of this.streams) for (const t of s.getTracks()) t.stop();
    this.streams = [];
    this.node?.disconnect();
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close();
  }
}

// Stand-in used by the browser demo: fake level meters, no device access.
export class DemoRecorder {
  constructor({ onLevel } = {}) {
    this.onLevel = onLevel;
  }
  async start() {
    this.t = setInterval(() => !this.paused && this.onLevel?.({ mic: Math.random() * 0.08, sys: Math.random() * 0.12, sysPeak: 0.3 }), 100);
    return { sampleRate: 16000, systemAudio: true, warnings: [] };
  }
  setPaused(p) {
    this.paused = p;
  }
  async stop() {
    clearInterval(this.t);
  }
}
