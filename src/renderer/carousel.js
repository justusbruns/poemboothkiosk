// =============================================================================
// Knob carousel: the selected item sits large in the middle, its neighbours to
// the left and right, smaller and dimmer, so a guest sees at once that turning
// the knob gives more choice. One component for every "turn to choose" moment:
// the number of prints on the paywall, extra prints after printing and the
// portrait / style choice on the result screen. Same easing everywhere.
//
//   const c = createCarousel(el, { items, index, render: (item, i) => node });
//   c.move(+1)      → true when the selection changed
//   c.index / c.item / c.node(i) / c.setItems(items, index) / c.select(i)
//
// Layout is pure transforms on absolutely positioned items (cheap on the NUC);
// the container needs a size (CSS).
// =============================================================================

export function createCarousel(container, opts = {}) {
  const {
    render,
    spacing = 82,       // neighbour centre, in % of an item's own width
    sideScale = 0.68,   // first neighbour; further ones shrink again
    sideOpacity = 0.55,
    visible = 2         // neighbours shown on each side
  } = opts;

  container.classList.add('kc');
  container.innerHTML = '';
  const track = document.createElement('div');
  track.className = 'kc-track';
  container.appendChild(track);

  let list = [];
  let idx = 0;
  let nodes = [];

  const clamp = (i) => Math.max(0, Math.min(list.length - 1, i));

  function layout() {
    nodes.forEach((el, i) => {
      const off = i - idx;
      const abs = Math.abs(off);
      const scale = off === 0 ? 1 : Math.pow(sideScale, Math.min(abs, 3));
      // Push further neighbours a little less far so they tuck behind
      const x = off === 0 ? 0 : Math.sign(off) * (spacing + (abs - 1) * spacing * 0.55);
      el.style.transform = `translate(-50%, -50%) translateX(${x}%) scale(${scale})`;
      el.style.opacity = abs > visible ? '0' : off === 0 ? '1' : String(sideOpacity / abs);
      el.style.zIndex = String(100 - abs);
      el.classList.toggle('is-active', off === 0);
      el.setAttribute('aria-hidden', off === 0 ? 'false' : 'true');
    });
  }

  function setItems(items, index = 0) {
    list = items || [];
    idx = clamp(index);
    track.innerHTML = '';
    nodes = list.map((item, i) => {
      const el = document.createElement('div');
      el.className = 'kc-item';
      const content = render(item, i);
      if (content) el.appendChild(content);
      track.appendChild(el);
      return el;
    });
    // First frame without transition so items do not fly in from the centre
    container.classList.add('kc-instant');
    layout();
    void container.offsetWidth;
    container.classList.remove('kc-instant');
  }

  setItems(opts.items || [], opts.index || 0);

  return {
    setItems,
    move(dir) {
      const next = clamp(idx + (dir > 0 ? 1 : -1));
      if (next === idx) return false;
      idx = next;
      layout();
      return true;
    },
    select(i) { idx = clamp(i); layout(); },
    node(i) { return nodes[i] || null; },
    get index() { return idx; },
    get item() { return list[idx]; },
    get length() { return list.length; },
    destroy() { container.innerHTML = ''; container.classList.remove('kc'); }
  };
}
