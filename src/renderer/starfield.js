// =============================================================================
// Starfield: stars at random spots that fly towards the guest (perspective
// projection from the middle of the screen), drawn on a canvas. Faster =
// "warp" (payment approved, generating). No pattern: every star gets a random
// direction and depth, and a new one when it passes the viewer.
//
//   const sf = createStarfield(canvas); sf.start(); sf.setSpeed(4); sf.stop();
// =============================================================================

const COLORS = ['255,255,255', '255,255,255', '200,225,255', '255,214,240'];

export function createStarfield(canvas, { count = 170 } = {}) {
  const ctx = canvas.getContext('2d');
  let raf = null;
  let speed = 1;
  let target = 1;
  let w = 0, h = 0;
  let last = 0;
  const stars = [];

  function spawn(s, anywhere) {
    // Spread over the whole view, a bit wider than the screen so edges fill too
    s.x = (Math.random() * 2 - 1) * 1.3;
    s.y = (Math.random() * 2 - 1) * 1.3;
    s.z = anywhere ? 0.08 + Math.random() * 0.92 : 1;
    s.pz = s.z;
    s.c = COLORS[(Math.random() * COLORS.length) | 0];
    s.r = 0.6 + Math.random() * 1.1;
  }

  for (let i = 0; i < count; i++) { const s = {}; spawn(s, true); stars.push(s); }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function project(s, z) {
    const k = 0.42 / z;
    return [w / 2 + s.x * k * w * 0.5, h / 2 + s.y * k * h * 0.5];
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(50, now - last);
    last = now;
    speed += (target - speed) * Math.min(1, dt / 400); // ease into warp and back
    ctx.clearRect(0, 0, w, h);
    const dz = dt * 0.00009 * speed;
    for (const s of stars) {
      s.pz = s.z;
      s.z -= dz;
      if (s.z <= 0.04) { spawn(s, false); continue; }
      const [x, y] = project(s, s.z);
      if (x < -40 || x > w + 40 || y < -40 || y > h + 40) { spawn(s, false); continue; }
      const [px, py] = project(s, Math.min(1, s.pz + dz * 2.5));
      const near = 1 - s.z;                 // 0 far … 1 at the viewer
      const alpha = Math.min(1, near * 1.4);
      ctx.strokeStyle = `rgba(${s.c},${alpha})`;
      ctx.lineWidth = s.r * (0.4 + near * 2.4);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x + 0.01, y);
      ctx.stroke();
    }
  }

  return {
    start() {
      if (raf) return;
      resize();
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      ctx.clearRect(0, 0, w, h);
    },
    setSpeed(v, instant = false) { target = v; if (instant) speed = v; },
    get running() { return !!raf; }
  };
}
