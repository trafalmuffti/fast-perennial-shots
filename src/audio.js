// Procedural WebAudio sound effects — no audio files to download.

export class Audio {
  constructor() {
    this.ctx = null;
    this.listener = { pos: [0, 0, 0], yaw: 0 };
  }

  // Must be called from a user gesture.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.#startWind();
  }

  setListener(pos, yaw) {
    this.listener.pos = pos;
    this.listener.yaw = yaw;
  }

  // Gain + stereo pan for a world-space source.
  #spatial(pos, maxDist = 160) {
    const c = this.ctx;
    const g = c.createGain();
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    let vol = 1, p = 0;
    if (pos) {
      const dx = pos[0] - this.listener.pos[0], dz = pos[2] - this.listener.pos[2];
      const dist = Math.hypot(dx, pos[1] - this.listener.pos[1], dz);
      vol = Math.max(0, 1 / (1 + dist * 0.09) * (1 - dist / maxDist));
      // Right vector for yaw: (cos y, 0, -sin y).
      const y = this.listener.yaw;
      const right = (dx * Math.cos(y) - dz * Math.sin(y)) / (Math.hypot(dx, dz) || 1);
      p = Math.max(-1, Math.min(1, right)) * 0.8;
    }
    g.gain.value = vol;
    if (pan) {
      pan.pan.value = p;
      g.connect(pan).connect(this.master);
    } else g.connect(this.master);
    return { out: g, vol };
  }

  #noiseBurst(dest, { dur, type = 'bandpass', freq = 1000, q = 1, gain = 1, attack = 0.002, sweepTo = null }) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  #tone(dest, { freq, to = freq, dur, type = 'sine', gain = 0.5, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot(kind, pos = null) {
    if (!this.ctx) return;
    const { out, vol } = this.#spatial(pos, kind === 'dmr' ? 260 : 170);
    if (vol <= 0.001) return;
    switch (kind) {
      case 'pulse':
        this.#tone(out, { freq: 1400, to: 180, dur: 0.12, type: 'sawtooth', gain: 0.18 });
        this.#tone(out, { freq: 90, to: 40, dur: 0.14, gain: 0.6 });
        this.#noiseBurst(out, { dur: 0.08, freq: 3200, q: 0.8, gain: 0.35 });
        break;
      case 'shotgun':
        this.#noiseBurst(out, { dur: 0.45, type: 'lowpass', freq: 2400, sweepTo: 300, gain: 1.0 });
        this.#tone(out, { freq: 110, to: 35, dur: 0.3, gain: 0.8 });
        break;
      case 'bullpup':
        this.#noiseBurst(out, { dur: 0.16, type: 'highpass', freq: 1400, gain: 0.7 });
        this.#tone(out, { freq: 160, to: 60, dur: 0.1, gain: 0.4 });
        break;
      case 'carbine':
        this.#noiseBurst(out, { dur: 0.13, type: 'bandpass', freq: 1800, q: 0.7, gain: 0.7 });
        this.#tone(out, { freq: 140, to: 50, dur: 0.09, gain: 0.35 });
        break;
      case 'dmr':
        this.#noiseBurst(out, { dur: 0.9, type: 'lowpass', freq: 4000, sweepTo: 200, gain: 1.0 });
        this.#tone(out, { freq: 90, to: 30, dur: 0.5, gain: 0.8 });
        break;
    }
  }

  laser(pos) {
    if (!this.ctx) return;
    const { out } = this.#spatial(pos, 220);
    this.#tone(out, { freq: 2200, to: 2600, dur: 0.25, type: 'square', gain: 0.05 });
  }

  shieldHit() {
    if (!this.ctx) return;
    this.#tone(this.master, { freq: 900, to: 260, dur: 0.18, type: 'triangle', gain: 0.25 });
    this.#noiseBurst(this.master, { dur: 0.1, type: 'highpass', freq: 5000, gain: 0.2 });
  }

  shieldBreak() {
    if (!this.ctx) return;
    this.#tone(this.master, { freq: 600, to: 60, dur: 0.6, type: 'sawtooth', gain: 0.3 });
    this.#noiseBurst(this.master, { dur: 0.5, type: 'bandpass', freq: 2000, sweepTo: 200, gain: 0.5 });
  }

  shieldRecharge() {
    if (!this.ctx) return;
    this.#tone(this.master, { freq: 300, to: 1200, dur: 0.6, type: 'sine', gain: 0.12 });
  }

  hullHit() {
    if (!this.ctx) return;
    this.#tone(this.master, { freq: 120, to: 50, dur: 0.2, gain: 0.7 });
    this.#noiseBurst(this.master, { dur: 0.15, type: 'lowpass', freq: 900, gain: 0.6 });
  }

  hitMarker(kill = false) {
    if (!this.ctx) return;
    this.#tone(this.master, { freq: kill ? 700 : 1900, to: kill ? 500 : 1700, dur: kill ? 0.25 : 0.05, type: 'triangle', gain: 0.15 });
  }

  impact(pos) {
    if (!this.ctx) return;
    const { out, vol } = this.#spatial(pos, 60);
    if (vol > 0.01) this.#noiseBurst(out, { dur: 0.06, freq: 2500, q: 2, gain: 0.25 });
  }

  footstep(heavy = 1) {
    if (!this.ctx) return;
    this.#tone(this.master, { freq: 70, to: 38, dur: 0.16, gain: 0.35 * heavy });
    this.#noiseBurst(this.master, { dur: 0.09, type: 'lowpass', freq: 500, gain: 0.25 * heavy });
    this.#tone(this.master, { freq: 2400, to: 1800, dur: 0.03, type: 'square', gain: 0.02 });
  }

  jets(on) {
    if (!this.ctx) return;
    if (!this.jetNode) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 700;
      f.Q.value = 0.6;
      this.jetGain = c.createGain();
      this.jetGain.gain.value = 0;
      src.connect(f).connect(this.jetGain).connect(this.master);
      src.start();
      this.jetNode = src;
    }
    this.jetGain.gain.setTargetAtTime(on ? 0.35 : 0, this.ctx.currentTime, 0.05);
  }

  reload() {
    if (!this.ctx) return;
    this.#tone(this.master, { freq: 500, to: 300, dur: 0.05, type: 'square', gain: 0.08 });
    this.#tone(this.master, { freq: 260, to: 900, dur: 0.35, type: 'sine', gain: 0.08, delay: 0.5 });
    this.#tone(this.master, { freq: 700, to: 500, dur: 0.05, type: 'square', gain: 0.1, delay: 1.5 });
  }

  pickup() {
    if (!this.ctx) return;
    [660, 880, 1100].forEach((f, i) => this.#tone(this.master, { freq: f, dur: 0.12, type: 'triangle', gain: 0.15, delay: i * 0.06 }));
  }

  captureTick() {
    if (!this.ctx) return;
    this.#tone(this.master, { freq: 520, dur: 0.06, type: 'triangle', gain: 0.08 });
  }

  fanfare() {
    if (!this.ctx) return;
    const notes = [392, 523.25, 659.25, 783.99, 659.25, 783.99, 1046.5];
    const times = [0, 0.18, 0.36, 0.54, 0.9, 1.08, 1.3];
    notes.forEach((f, i) => {
      this.#tone(this.master, { freq: f, dur: i === notes.length - 1 ? 1.6 : 0.3, type: 'triangle', gain: 0.22, delay: times[i] });
      this.#tone(this.master, { freq: f / 2, dur: i === notes.length - 1 ? 1.6 : 0.3, type: 'sine', gain: 0.12, delay: times[i] });
    });
  }

  alert(pos) {
    if (!this.ctx) return;
    const { out } = this.#spatial(pos, 80);
    this.#tone(out, { freq: 300, to: 220, dur: 0.25, type: 'square', gain: 0.06 });
  }

  #startWind() {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g = c.createGain();
    g.gain.value = 0.06;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.04;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    lfo.start();
  }
}
