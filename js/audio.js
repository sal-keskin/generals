/* Tank Lab — tiny synthesised sound (no audio files needed). */
'use strict';
(function () {
  const G = window.G;

  class Sound {
    constructor() {
      this.ctx = null;
      this.muted = false;
    }

    /** Must be called from a user gesture. */
    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = (this.ctx = new AC());
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(c.destination);
      // noise buffer shared by all bangs
      const len = c.sampleRate * 2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // engine: two detuned low oscillators through a low-pass filter
      this.eng = c.createGain();
      this.eng.gain.value = 0;
      this.engF = c.createBiquadFilter();
      this.engF.type = 'lowpass';
      this.engF.frequency.value = 260;
      this.engF.connect(this.eng);
      this.eng.connect(this.master);
      this.o1 = c.createOscillator();
      this.o1.type = 'sawtooth';
      this.o2 = c.createOscillator();
      this.o2.type = 'square';
      const g2 = c.createGain();
      g2.gain.value = 0.35;
      this.o1.connect(this.engF);
      this.o2.connect(g2);
      g2.connect(this.engF);
      this.o1.start();
      this.o2.start();
      // track clatter: filtered noise loop
      this.clat = c.createBufferSource();
      this.clat.buffer = this.noise;
      this.clat.loop = true;
      this.clatF = c.createBiquadFilter();
      this.clatF.type = 'bandpass';
      this.clatF.frequency.value = 900;
      this.clatF.Q.value = 2;
      this.clatG = c.createGain();
      this.clatG.gain.value = 0;
      this.clat.connect(this.clatF);
      this.clatF.connect(this.clatG);
      this.clatG.connect(this.master);
      this.clat.start();
    }

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
    }

    engine(speed, throttle) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const f = 34 + speed * 2.2 + throttle * 14;
      this.o1.frequency.setTargetAtTime(f, t, 0.1);
      this.o2.frequency.setTargetAtTime(f * 1.51, t, 0.1);
      this.engF.frequency.setTargetAtTime(200 + throttle * 260 + speed * 10, t, 0.1);
      this.eng.gain.setTargetAtTime(0.08 + throttle * 0.08, t, 0.15);
      this.clatG.gain.setTargetAtTime(Math.min(0.06, speed * 0.004), t, 0.1);
      this.clatF.frequency.setTargetAtTime(500 + speed * 40, t, 0.1);
    }

    bang(vol, dur, cutoff, thump) {
      if (!this.ctx || vol < 0.01) return;
      const c = this.ctx, t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 0.7 + Math.random() * 0.3;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoff, t);
      f.frequency.exponentialRampToValueAtTime(80, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(t, Math.random());
      src.stop(t + dur + 0.05);
      if (thump) {
        const o = c.createOscillator();
        o.frequency.setValueAtTime(thump, t);
        o.frequency.exponentialRampToValueAtTime(28, t + dur * 0.6);
        const og = c.createGain();
        og.gain.setValueAtTime(vol * 0.9, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.7);
        o.connect(og);
        og.connect(this.master);
        o.start(t);
        o.stop(t + dur);
      }
    }

    fire() {
      this.bang(0.9, 0.9, 2400, 70);
    }
    explosion(dist, big) {
      const v = Math.max(0, 1 - dist / 700) * (big ? 1 : 0.7);
      this.bang(v, big ? 1.6 : 1.0, big ? 1400 : 1800, big ? 55 : 65);
    }
    crash(dist, vol) {
      const v = Math.max(0, 1 - dist / 300) * vol;
      this.bang(v * 0.6, 0.35, 3000, 0);
    }
    chime() {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      [880, 1320].forEach((f, i) => {
        const o = c.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t + i * 0.09);
        g.gain.linearRampToValueAtTime(0.18, t + i * 0.09 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.4);
        o.connect(g);
        g.connect(this.master);
        o.start(t + i * 0.09);
        o.stop(t + i * 0.09 + 0.45);
      });
    }
  }

  G.Sound = Sound;
})();
