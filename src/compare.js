// The paving before/after: one frame, "Przed" left of a divider and "Po" right
// of it. Drag it, tap where it should go, or use the arrow keys (a real range
// input underneath keeps it usable for keyboards and screen readers). The first
// time the frame comes into view the divider slides in from the right, washing
// the paving red, so people see that it moves.
const ease = (t) => 1 - (1 - t) ** 3;

export function setupCompare(figure, { still }) {
  const frame = figure?.querySelector('.compare__frame');
  const range = figure?.querySelector('.compare__range');
  if (!frame || !range) return;

  let split = 50;
  let raf = 0;

  function set(value) {
    split = Math.max(0, Math.min(100, value));
    frame.style.setProperty('--split', `${split}%`);
    frame.style.setProperty('--s', split.toFixed(2));
    const s = Math.round(split);
    range.value = s;
    range.setAttribute('aria-valuetext',
      s <= 2 ? 'całe zdjęcie po myciu' : s >= 98 ? 'całe zdjęcie przed myciem' : `${s}% przed myciem, ${100 - s}% po myciu`);
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function glide(from, to, ms) {
    stop();
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      set(from + (to - from) * ease(t));
      raf = t < 1 ? requestAnimationFrame(step) : 0;
    };
    raf = requestAnimationFrame(step);
  }

  function follow(e) {
    const r = frame.getBoundingClientRect();
    set(((e.clientX - r.left) / r.width) * 100);
  }

  // Mouse: press anywhere and drag. Touch: a sideways drag moves the divider,
  // an up/down swipe still scrolls the page (touch-action: pan-y), a tap jumps.
  let drag = null;
  frame.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    stop();
    drag = { id: e.pointerId, x: e.clientX, moved: e.pointerType === 'mouse' };
    if (drag.moved) {
      e.preventDefault();
      frame.setPointerCapture(e.pointerId);
      follow(e);
      range.focus({ preventScroll: true });
    }
  });
  frame.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) > 6) {
      drag.moved = true;
      frame.setPointerCapture(e.pointerId);
    }
    if (drag.moved) follow(e);
  });
  frame.addEventListener('pointerup', (e) => {
    if (drag && e.pointerId === drag.id && !drag.moved) follow(e);
    drag = null;
  });
  frame.addEventListener('pointercancel', () => { drag = null; });

  range.addEventListener('input', () => {
    stop();
    set(Number(range.value));
  });

  range.hidden = false;
  figure.classList.add('is-live');

  // Already on screen when the script arrives (a slow connection): don't
  // snap the divider away from where the visitor is looking
  const r = frame.getBoundingClientRect();
  if (still || !('IntersectionObserver' in window) || (r.top < innerHeight && r.bottom > 0)) {
    set(50);
    return;
  }
  set(88);
  const seen = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry.intersectionRatio >= 0.6) {
      seen.disconnect();
      if (!drag && split === 88) glide(88, 50, 1400);
    } else if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
      // Arrived lower down the page: nothing to show off, just sit in the middle
      seen.disconnect();
      if (split === 88) set(50);
    }
  }, { threshold: [0, 0.6] });
  seen.observe(frame);
}
