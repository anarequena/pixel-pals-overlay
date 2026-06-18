'use strict';

// Animated galaxy starfield drawn behind the whole overlay. Twinkling, slowly
// drifting stars in a few tints, plus the occasional shooting star. Purely
// decorative: the canvas is pointer-events:none so it never affects clicks or
// the click-through hover logic. Cheap enough to run continuously.

(function () {
  let canvas = null;
  let ctx = null;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let stars = [];
  let shooters = [];
  let shootTimer = 4;
  let raf = null;
  let last = 0;

  function pickHue() {
    const roll = Math.random();
    if (roll < 0.7) return '255,255,255';   // white
    if (roll < 0.82) return '255,201,235';  // pink
    if (roll < 0.94) return '178,224,255';  // blue
    return '255,224,150';                   // gold
  }

  function seed() {
    const count = Math.max(40, Math.round((w * h) / 2600));
    stars = [];
    for (let i = 0; i < count; i++) {
      const depth = Math.random();
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + depth * 1.4,
        base: 0.22 + Math.random() * 0.66,
        tw: Math.random() * Math.PI * 2,
        twSpeed: 0.5 + Math.random() * 1.9,
        drift: 1.5 + depth * 8,
        hue: pickHue(),
      });
    }
  }

  function resize() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth || canvas.parentElement.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function spawnShooter() {
    const fromLeft = Math.random() < 0.5;
    shooters.push({
      x: fromLeft ? -30 : w + 30,
      y: Math.random() * h * 0.55,
      vx: (fromLeft ? 1 : -1) * (240 + Math.random() * 180),
      vy: 70 + Math.random() * 90,
      life: 0,
      max: 0.7 + Math.random() * 0.5,
    });
  }

  function frame(t) {
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
    last = t;
    ctx.clearRect(0, 0, w, h);

    for (const s of stars) {
      s.tw += s.twSpeed * dt;
      s.y += s.drift * dt;
      if (s.y > h + 2) {
        s.y = -2;
        s.x = Math.random() * w;
      }
      const a = s.base * (0.5 + 0.5 * Math.sin(s.tw));
      ctx.fillStyle = `rgba(${s.hue},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      if (s.r > 1.15) {
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = `rgba(${s.hue},1)`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(s.x - s.r * 2.2, s.y);
        ctx.lineTo(s.x + s.r * 2.2, s.y);
        ctx.moveTo(s.x, s.y - s.r * 2.2);
        ctx.lineTo(s.x, s.y + s.r * 2.2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    shootTimer -= dt;
    if (shootTimer <= 0) {
      spawnShooter();
      shootTimer = 7 + Math.random() * 11;
    }
    for (let i = shooters.length - 1; i >= 0; i--) {
      const sh = shooters[i];
      sh.life += dt;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      const k = 1 - sh.life / sh.max;
      if (k <= 0) {
        shooters.splice(i, 1);
        continue;
      }
      const tailX = sh.x - sh.vx * 0.06;
      const tailY = sh.y - sh.vy * 0.06;
      const grad = ctx.createLinearGradient(sh.x, sh.y, tailX, tailY);
      grad.addColorStop(0, `rgba(255,255,255,${(0.9 * k).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
    }

    raf = requestAnimationFrame(frame);
  }

  function init(c) {
    if (!c) return;
    canvas = c;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    if (raf) cancelAnimationFrame(raf);
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  window.Starfield = { init };
})();
