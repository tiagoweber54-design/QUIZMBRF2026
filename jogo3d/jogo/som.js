// Sons sintetizados com WebAudio (sem arquivos externos).
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));

export const Som = {
  ctx: null, out: null, on: true, nb: null, ambG: null, birdT: 3,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC();
      this.out = this.ctx.createGain(); this.out.gain.value = this.on ? .8 : 0; this.out.connect(this.ctx.destination);
      const n = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
      let last = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + .02 * w) / 1.02; d[i] = w * .5 + last * 3; }
      this.nb = b;
      const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      this.ambG = this.ctx.createGain(); this.ambG.gain.value = .05; src.connect(lp); lp.connect(this.ambG); this.ambG.connect(this.out); src.start();
    } catch (e) { this.ctx = null; }
  },
  alternar() { this.on = !this.on; if (this.out) this.out.gain.value = this.on ? .8 : 0; return this.on; },
  env(node, t, a, dur) { const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + dur); node.connect(g); g.connect(this.out); },
  ruido(dur, f0, f1, a, type = 'lowpass', q = 1) {
    if (!this.ctx) return; const t = this.ctx.currentTime, s = this.ctx.createBufferSource(); s.buffer = this.nb;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    s.connect(f); this.env(f, t, a, dur); s.start(t, Math.random() * 1.5); s.stop(t + dur + .05);
  },
  tom(f0, f1, dur, a, type = 'sine', delay = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); this.env(o, t, a, dur); o.start(t); o.stop(t + dur + .05);
  },
  respingo(s = .5) { this.ruido(.35 + s * .4, 2400, 260, .35 * s + .1); },
  ploc() { this.tom(520, 140, .12, .25); this.ruido(.15, 1800, 400, .12); },
  belisco(a = .2) { this.tom(900, 500, .05, a * .5); },
  catraca() { this.tom(2600, 2400, .012, .05, 'square'); },
  freio(v) { this.tom(1500 + v * 180, 1300 + v * 150, .02, .07, 'sawtooth'); },
  zunido(a = 1) { this.ruido(.25, 600, 2600, .12 * a, 'bandpass', .8); },
  baque(a = 1) { this.tom(140, 60, .2, .4 * a); this.ruido(.12, 900, 200, .2 * a); },
  estalo() { this.tom(1800, 200, .18, .25, 'triangle'); this.ruido(.08, 6000, 3000, .3, 'highpass'); },
  ambiente(dt, dia, vento) {
    if (!this.ctx || !this.on) return;
    this.ambG.gain.value = .035 + vento * .002;
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = rand(2, 7);
      if (dia > .4) { const b = rand(2400, 3600), n = randi(2, 5); for (let i = 0; i < n; i++) this.tom(b, b * rand(1.1, 1.5), .07, .03, 'sine', i * .11); }
      else if (dia < .3) { for (let i = 0; i < randi(6, 12); i++) this.tom(4600, 4500, .025, .012, 'sine', i * .05); }
    }
  },
};
