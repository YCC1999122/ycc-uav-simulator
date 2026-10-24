// Procedural WebAudio: motor whine tied to RPM, wind rush, explosions, release clicks
export class AudioSys {
  private ctx: AudioContext | null = null;
  private motorOsc: OscillatorNode[] = [];
  private motorGain: GainNode[] = [];
  private master: GainNode | null = null;
  private windNoise: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private started = false;
  private muted = false;

  init() {
    if (this.started) return;
    this.started = true;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // 4 motors: sawtooth + bandpass
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 80;
      const g = ctx.createGain();
      g.gain.value = 0;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 2.2;
      osc.connect(g).connect(bp).connect(this.master);
      osc.start();
      this.motorOsc.push(osc);
      this.motorGain.push(g);
    }

    // wind / prop wash noise
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    src.connect(lp).connect(wg).connect(this.master);
    src.start();
    this.windNoise = { src, gain: wg };
  }

  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; }

  // motorOmegas in rad/s, airspeed m/s, distance to camera for attenuation
  updateMotors(omegas: number[], airspeed: number, dist: number, throttleAvg: number) {
    if (!this.ctx || this.muted) return;
    const att = 1 / (1 + dist * dist * 0.002);
    for (let i = 0; i < 4; i++) {
      const w = omegas[i];
      const f = 40 + w * 0.62; // whine fundamental
      this.motorOsc[i].frequency.setTargetAtTime(f, this.ctx.currentTime, 0.03);
      this.motorGain[i].gain.setTargetAtTime(0.05 * throttlePresence(w) * att, this.ctx.currentTime, 0.05);
    }
    if (this.windNoise) {
      const g = Math.min(0.16, airspeed * 0.006 + throttlePresenceAvg(omegas) * 0.03) * att;
      this.windNoise.gain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.1);
    }
    function throttlePresence(w: number) { return Math.min(w / 3000, 1); }
    function throttlePresenceAvg(ws: number[]) { return ws.reduce((a, b) => a + b, 0) / ws.length / 3000; }
  }

  explosion(power = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const dur = 1.2 * power;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const t = i / ctx.sampleRate;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 5) * (1 + Math.exp(-t * 30) * 2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, ctx.currentTime);
    lp.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.value = Math.min(0.9, 0.55 * power);
    src.connect(lp).connect(g).connect(this.master!);
    src.start();
    // sub thump
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(58, ctx.currentTime);
    sub.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.5);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.7 * Math.min(power, 1.4), ctx.currentTime);
    sg.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    sub.connect(sg).connect(this.master!);
    sub.start(); sub.stop(ctx.currentTime + 0.8);
  }

  release() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    o.connect(g).connect(this.master!);
    o.start(); o.stop(ctx.currentTime + 0.1);
  }

  beep(freq = 1200, dur = 0.08) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator();
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.08, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g).connect(this.master!);
    o.start(); o.stop(this.ctx.currentTime + dur);
  }
}
