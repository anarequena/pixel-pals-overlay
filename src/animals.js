'use strict';

// Single pixel-pal engine. Draws ONE cute animal in the small focus-card canvas,
// animated by mood (idle / work / break). Sprites are authored as character
// grids; rows are normalised to width at load time so uneven authoring never
// throws.

(function () {
  const BASE_PALETTE = {
    '.': null,
    '1': '#241a2e',
    '5': '#ffffff',
    '6': '#15101c',
    '7': '#ff9ec4',
  };

  const SPRITES = {
    cat: {
      w: 11,
      colors: { '2': '#f4a23b', '3': '#ffe0b0', '4': '#d97a1f', '8': '#d97a1f' },
      grid: [
        '.11.....11.',
        '.142.....241',
        '.1222222221',
        '12233332221',
        '12526652521',
        '12222772221',
        '12333333321',
        '.1.1.1.1.1.',
      ],
    },
    bunny: {
      w: 11,
      colors: { '2': '#e9e3f5', '3': '#ffffff', '4': '#ffb6d5', '8': '#cfc4e8' },
      grid: [
        '..14...41..',
        '..142.241..',
        '..1222221..',
        '.122222221.',
        '.125266521.',
        '.122277221.',
        '.123333321.',
        '..1.1.1.1..',
      ],
    },
    frog: {
      w: 11,
      colors: { '2': '#7bd16a', '3': '#cdefb0', '4': '#4f9e44', '8': '#4f9e44' },
      grid: [
        '.15.....51.',
        '.165...561.',
        '12122221221',
        '12222222221',
        '12222222221',
        '12233333221',
        '.1222222.1.',
        '11.1...1.11',
      ],
    },
    duck: {
      w: 11,
      colors: { '2': '#ffd76a', '3': '#fff0c0', '4': '#ffae3b', '8': '#ffae3b' },
      grid: [
        '...12221...',
        '..1222221..',
        '..1252221..',
        '.12222221..',
        '4422222221.',
        '.122222221.',
        '.123333321.',
        '...1...1...',
      ],
    },
    fox: {
      w: 11,
      colors: { '2': '#ff7a3b', '3': '#ffffff', '4': '#2a1a14', '8': '#d95a1f' },
      grid: [
        '.14.....41.',
        '.142...241.',
        '.12222.2221',
        '112333332.1',
        '12526.65221',
        '12233372.21',
        '128222222.8',
        '.1.1.1.1.1.',
      ],
    },
  };

  function bake(spr) {
    const w = spr.w;
    const palette = Object.assign({}, BASE_PALETTE, spr.colors);
    const cells = [];
    for (let r = 0; r < spr.grid.length; r++) {
      let row = spr.grid[r];
      if (row.length < w) row = row + '.'.repeat(w - row.length);
      const out = [];
      for (let c = 0; c < w; c++) {
        const ch = row[c];
        out.push(palette[ch] !== undefined ? palette[ch] : null);
      }
      cells.push(out);
    }
    return { w, h: cells.length, cells };
  }

  const BAKED = {};
  for (const k of Object.keys(SPRITES)) BAKED[k] = bake(SPRITES[k]);
  const TYPES = Object.keys(BAKED);
  const EMOJI = { cat: '🐱', bunny: '🐰', frog: '🐸', duck: '🐥', fox: '🦊' };

  function hashStr(s) {
    let h = 0;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
    return Math.abs(h);
  }

  const Pal = {
    canvas: null,
    ctx: null,
    type: 'cat',
    mood: 'idle',
    active: true,
    bob: 0,
    raf: null,
    last: 0,

    init(canvas) {
      if (!canvas) return;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.resize();
      this.last = performance.now();
      this.loop = this.loop.bind(this);
      this.raf = requestAnimationFrame(this.loop);
    },

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const cssW = this.canvas.clientWidth || this.canvas.width || 72;
      const cssH = this.canvas.clientHeight || this.canvas.height || 56;
      this.cw = cssW;
      this.ch = cssH;
      this.canvas.width = cssW * dpr;
      this.canvas.height = cssH * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = false;
    },

    setMood(mood) {
      this.mood = mood || 'idle';
    },

    // Pick a pal deterministically from the focus text so the same task keeps
    // the same buddy.
    pickFor(text) {
      this.type = TYPES[hashStr(text) % TYPES.length];
    },

    setActive(on) {
      this.active = !!on;
    },

    emojiFor(type) {
      return EMOJI[type || this.type] || '🐾';
    },

    loop(now) {
      const dt = Math.min(48, now - this.last);
      this.last = now;
      const speed = this.mood === 'work' ? 0.012 : this.mood === 'break' ? 0.003 : 0.006;
      this.bob += dt * speed;
      this.draw();
      this.raf = requestAnimationFrame(this.loop);
    },

    draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      ctx.clearRect(0, 0, this.cw, this.ch);

      const spr = BAKED[this.type] || BAKED.cat;
      const scale = Math.max(
        2,
        Math.floor(Math.min(this.cw / (spr.w + 2), this.ch / (spr.h + 3)))
      );
      const w = spr.w * scale;
      const h = spr.h * scale;

      const hopAmp = this.mood === 'work' ? 5 : this.mood === 'break' ? 1.5 : 3;
      const hop = Math.abs(Math.sin(this.bob)) * hopAmp;
      const flip = Math.sin(this.bob * 0.5) < 0;

      const x = (this.cw - w) / 2;
      const y = (this.ch - h) / 2 - hop + 2;

      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(this.cw / 2, (this.ch + h) / 2 + 1, w * 0.34, 3, 0, 0, Math.PI * 2);
      ctx.fill();

      for (let r = 0; r < spr.h; r++) {
        for (let c = 0; c < spr.w; c++) {
          const color = spr.cells[r][c];
          if (!color) continue;
          const cx = flip ? spr.w - 1 - c : c;
          ctx.fillStyle = color;
          ctx.fillRect(Math.round(x + cx * scale), Math.round(y + r * scale), scale, scale);
        }
      }

      // mood badge
      const badge = this.mood === 'work' ? '💪' : this.mood === 'break' ? '😴' : '';
      if (badge) {
        ctx.font = `${Math.round(scale * 4)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(badge, x + w + scale * 2, y + scale * 2);
      }
    },
  };

  window.FocusPal = Pal;
})();
