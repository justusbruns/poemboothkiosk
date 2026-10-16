// =============================================================================
// The reveal: "TADAAA". When the portrait (or poem) appears, a burst of light
// opens behind it: a flash, slowly turning light rays, an expanding ring and
// sparks flying out. Pure CSS animations on a few elements (cheap on the NUC);
// cleared again after ~3 s.
// =============================================================================

const SPARKS = 44;
let clearTimer = null;

export function playReveal() {
  const screen = document.getElementById('result-screen');
  if (!screen) return;
  let el = document.getElementById('reveal-burst');
  if (!el) {
    el = document.createElement('div');
    el.id = 'reveal-burst';
    el.className = 'reveal-burst';
    el.setAttribute('aria-hidden', 'true');
    screen.appendChild(el);
  }
  el.innerHTML = '<div class="reveal-flash"></div><div class="reveal-rays"></div><div class="reveal-ring"></div><div class="reveal-ring reveal-ring--2"></div>';
  for (let i = 0; i < SPARKS; i++) {
    const s = document.createElement('span');
    s.className = 'reveal-spark';
    const angle = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 46; // vmin
    s.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(1) + 'vmin');
    s.style.setProperty('--dy', (Math.sin(angle) * dist).toFixed(1) + 'vmin');
    s.style.setProperty('--d', (Math.random() * 0.35).toFixed(2) + 's');
    s.style.setProperty('--s', (3 + Math.random() * 6).toFixed(1) + 'px');
    el.appendChild(s);
  }
  el.classList.remove('play');
  void el.offsetWidth;
  el.classList.add('play');
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    clearTimer = null;
    el.classList.remove('play');
    el.innerHTML = '';
  }, 3400);
}
