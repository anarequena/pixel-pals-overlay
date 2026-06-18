'use strict';

// Lofi audio: a copyright-safe procedural generator (Web Audio) plus playback
// of any .mp3/.wav/.ogg the user drops into the app's music/ folder.
// Exposed as window.LofiAudio.

(function () {
  const LofiAudio = {
    ctx: null,
    master: null,
    volume: 0.5,
    playing: false,
    playlist: [{ type: 'gen', name: 'Built-in lofi loop ☁' }],
    index: 0,
    audioEl: null,
    gen: null,
    stateCb: null,

    async init(volume) {
      if (typeof volume === 'number') this.volume = volume;
      this.audioEl = new Audio();
      this.audioEl.loop = false;
      this.audioEl.volume = this.volume;
      this.audioEl.addEventListener('ended', () => this.next(true));
      try {
        const files = (await window.overlay.listMusic()) || [];
        for (const f of files) this.playlist.push({ type: 'file', name: f.name, url: f.url });
      } catch {}
      this.emit();
    },

    onState(cb) { this.stateCb = cb; },
    emit() {
      if (this.stateCb) {
        this.stateCb({
          playing: this.playing,
          name: this.current().name,
          count: this.playlist.length,
        });
      }
    },

    current() { return this.playlist[this.index] || this.playlist[0]; },

    ensureCtx() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },

    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, v));
      if (this.master) this.master.gain.value = this.volume;
      if (this.audioEl) this.audioEl.volume = this.volume;
    },

    toggle() {
      if (this.playing) this.stop();
      else this.play(this.index);
    },

    play(i) {
      this.stop();
      this.index = (i + this.playlist.length) % this.playlist.length;
      const track = this.current();
      if (track.type === 'gen') {
        this.startGenerator();
      } else {
        this.audioEl.src = track.url;
        this.audioEl.volume = this.volume;
        this.audioEl.play().catch((e) => console.warn('audio play failed', e));
      }
      this.playing = true;
      this.emit();
    },

    stop() {
      if (this.gen) { this.stopGenerator(); }
      if (this.audioEl) { this.audioEl.pause(); }
      this.playing = false;
      this.emit();
    },

    next(autoAdvance) {
      const wasPlaying = this.playing || autoAdvance;
      const ni = (this.index + 1) % this.playlist.length;
      if (wasPlaying) this.play(ni);
      else { this.index = ni; this.emit(); }
    },

    // ---------------- Procedural lofi generator ----------------
    startGenerator() {
      this.ensureCtx();
      const ctx = this.ctx;
      const out = ctx.createGain();
      out.gain.value = 0.9;

      // Warm lowpass to soften everything.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1700;
      lp.Q.value = 0.4;
      out.connect(lp);
      lp.connect(this.master);

      // Vinyl crackle / hiss bed.
      const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.5;
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      noise.loop = true;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.012;
      const noiseHp = ctx.createBiquadFilter();
      noiseHp.type = 'highpass';
      noiseHp.frequency.value = 1500;
      noise.connect(noiseHp);
      noiseHp.connect(noiseGain);
      noiseGain.connect(this.master);
      noise.start();

      // Mellow jazzy progression (MIDI). Fmaj7 - Em7 - Am7 - Dm7-ish.
      const prog = [
        [53, 57, 60, 64], // Fmaj7
        [52, 55, 59, 62], // Em7
        [57, 60, 64, 67], // Am7
        [50, 53, 57, 60], // Dm7
      ];
      const bass = [41, 40, 45, 38];

      const bpm = 72;
      const beat = 60 / bpm;
      const bar = beat * 4;

      this.gen = { ctx, out, lp, noise, nodes: [out, lp, noiseGain], stop: false, timer: null, bar: 0 };

      const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

      const padVoice = (freq, t, dur, gain) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = freq;
        o.detune.value = (Math.random() * 8 - 4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.4);
        g.gain.setValueAtTime(gain, t + dur - 0.6);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g);
        g.connect(out);
        o.start(t);
        o.stop(t + dur + 0.05);
      };

      const bassVoice = (freq, t, dur) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.18, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g);
        g.connect(out);
        o.start(t);
        o.stop(t + dur + 0.05);
      };

      const kick = (t) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + 0.2);
      };

      const hat = (t) => {
        const src = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
        src.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 7000;
        const g = ctx.createGain(); g.gain.value = 0.05;
        src.connect(hp); hp.connect(g); g.connect(out);
        src.start(t); src.stop(t + 0.05);
      };

      // Lookahead scheduler.
      let nextBarTime = ctx.currentTime + 0.15;
      let barIndex = 0;
      const schedule = () => {
        if (!this.gen || this.gen.stop) return;
        while (nextBarTime < ctx.currentTime + 1.5) {
          const chord = prog[barIndex % prog.length];
          for (const n of chord) padVoice(midi(n + 12), nextBarTime, bar, 0.05);
          bassVoice(midi(bass[barIndex % bass.length]), nextBarTime, beat * 1.5);
          bassVoice(midi(bass[barIndex % bass.length]), nextBarTime + beat * 2, beat * 1.5);
          for (let b = 0; b < 4; b++) {
            if (b === 0 || b === 2) kick(nextBarTime + b * beat);
            hat(nextBarTime + b * beat + beat / 2);
          }
          nextBarTime += bar;
          barIndex++;
        }
        this.gen.timer = setTimeout(schedule, 250);
      };
      schedule();
    },

    stopGenerator() {
      if (!this.gen) return;
      this.gen.stop = true;
      clearTimeout(this.gen.timer);
      try { this.gen.noise.stop(); } catch {}
      try {
        this.gen.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      } catch {}
      const g = this.gen;
      setTimeout(() => {
        try { g.out.disconnect(); g.lp.disconnect(); } catch {}
      }, 400);
      this.gen = null;
    },
  };

  window.LofiAudio = LofiAudio;
})();
