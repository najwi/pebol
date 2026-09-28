import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { createBubbles } from './bubbles.js';
import { createGlass } from './glass.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const layers = [];
const tilt = { x: 0 };

function makeRenderer(canvas, maxPixelRatio) {
  try {
    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
    renderer.setClearColor(0x000000, 0);
    return renderer;
  } catch {
    return null;
  }
}

// Something drawn each frame over a section, paused while it is off screen.
function addLayer(section, layer) {
  layer.visible = true;
  layer.drawn = false;
  new IntersectionObserver(([entry]) => {
    layer.visible = entry.isIntersecting;
  }).observe(section);
  new ResizeObserver(() => layer.resize(section.clientWidth, section.clientHeight)).observe(section);
  layer.resize(section.clientWidth, section.clientHeight);
  layers.push(layer);
}

function localPoint(section, e) {
  const r = section.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

const isControl = (target) => target.closest('a, button');

// A canvas of soap bubbles over a section: hover shows which one you'll pop,
// a moving pointer stirs the air, and a click or tap pops.
function bubbleStage(section, canvas, { count, appear = 0, onPop }) {
  const renderer = canvas && makeRenderer(canvas, 1.75);
  if (!renderer) return null;
  renderer.autoClear = false;

  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 12);
  const bubbles = createBubbles(scene, camera, { count, pixelRatio: renderer.getPixelRatio(), still: reduceMotion, appear });
  const air = { active: false, world: new Vector3(), vel: new Vector3(), last: new Vector3(), at: 0 };
  const view = { w: 1, h: 1 };

  function toWorld(x, y, out) {
    const ndc = new Vector3((x / view.w) * 2 - 1, -(y / view.h) * 2 + 1, 0.5).unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    return out.copy(camera.position).addScaledVector(dir, -camera.position.z / dir.z);
  }

  function stir(x, y, time) {
    toWorld(x, y, air.world);
    if (air.active) {
      const dt = Math.max((time - air.at) / 1000, 1 / 240);
      air.vel.lerp(air.last.sub(air.world).multiplyScalar(-1 / dt), 0.5);
      if (air.vel.lengthSq() > 144) air.vel.setLength(12);
    }
    air.last.copy(air.world);
    air.at = time;
    air.active = true;
  }

  function calm() {
    air.active = false;
    air.vel.set(0, 0, 0);
    bubbles.hover(-1);
    section.classList.remove('is-over-bubble');
  }

  section.addEventListener('pointermove', (e) => {
    const p = localPoint(section, e);
    stir(p.x, p.y, e.timeStamp);
    if (e.pointerType !== 'mouse') return;
    const i = isControl(e.target) ? -1 : bubbles.pick(p.x, p.y, 6);
    bubbles.hover(i);
    section.classList.toggle('is-over-bubble', i >= 0);
  });
  section.addEventListener('pointerleave', calm);
  section.addEventListener('pointercancel', calm);
  section.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') calm();
  });
  section.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || isControl(e.target)) return;
    const p = localPoint(section, e);
    const i = bubbles.pick(p.x, p.y, e.pointerType === 'mouse' ? 6 : 22);
    if (i < 0) return;
    const at = bubbles.pop(i, p.x, p.y);
    section.classList.remove('is-over-bubble');
    if (e.pointerType !== 'mouse') navigator.vibrate?.(12);
    onPop?.(at);
  });

  addLayer(section, {
    resize(w, h) {
      if (w === view.w && h === view.h) return;
      view.w = w;
      view.h = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      bubbles.setView(w, h);
    },
    frame(dt, time) {
      air.vel.multiplyScalar(Math.exp(-dt * 5));
      bubbles.update(dt, time, air, tilt.x);
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(scene, camera);
    },
  });
}

function setupHero() {
  const hero = document.querySelector('.hero');
  const title = hero?.querySelector('.hero__title');
  const glassCanvas = hero?.querySelector('.hero__glass');
  if (!title || !glassCanvas) return;
  const renderer = makeRenderer(glassCanvas, 1.5);
  if (!renderer) return;

  const glass = createGlass(renderer, { hero, title, still: reduceMotion });
  addLayer(hero, {
    resize(w, h) {
      renderer.setSize(w, h, false);
      glass.resize(w, h);
    },
    frame(dt, time) {
      glass.step(dt);
      glass.render(time);
    },
    // Weak GPUs get a coarser glass rather than a stuttering page.
    degrade() {
      renderer.setPixelRatio(1);
      renderer.setSize(hero.clientWidth, hero.clientHeight, false);
      glass.paint();
    },
  });
  bubbleStage(hero, hero.querySelector('.hero__bubbles'), {
    count: window.innerWidth < 640 ? 9 : 14,
    appear: reduceMotion ? 0 : 2.2,
    onPop: (p) => glass.splash(p.x, p.y, p.r),
  });
  hero.classList.add('is-fogged');
  // The headline is painted on the wall behind the glass once its font is in.
  document.fonts?.ready.then(() => glass.paint());

  const radius = () => Math.max(30, Math.min(70, hero.clientWidth * 0.05));
  let last = null;
  let introDone = false;

  function wipeTo(x, y) {
    if (last) glass.wipe(last.x, last.y, x, y, radius());
    last = { x, y };
  }
  function lift() {
    last = null;
  }

  hero.addEventListener('pointermove', (e) => {
    if (!introDone || e.pointerType === 'touch') return;
    const p = localPoint(hero, e);
    wipeTo(p.x, p.y);
  });
  hero.addEventListener('pointerleave', lift);
  hero.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') lift();
  });
  // Touch: sideways swipes wipe (the hero only pans vertically), and a
  // vertical swipe still wipes as the page scrolls.
  hero.addEventListener(
    'touchmove',
    (e) => {
      if (!introDone || e.touches.length !== 1) return;
      const p = localPoint(hero, e.touches[0]);
      wipeTo(p.x, p.y);
    },
    { passive: true },
  );
  hero.addEventListener('touchend', lift);

  function finishIntro(path) {
    introDone = true;
    lift();
    blade?.classList.remove('is-on');
    hero.classList.add('is-wipeable');
    // Water gathered under the last stroke runs off.
    const end = path[path.length - 1];
    const start = path[path.length - 2];
    for (let k = 0; k < 3; k++) {
      const x = start.x + (end.x - start.x) * (0.2 + k * 0.3) + (Math.random() - 0.5) * 30;
      setTimeout(() => glass.drip(x, end.y + radius() * 0.75, 4 + Math.random() * 2), 150 + k * 380);
    }
  }

  // Opening move: a squeegee clears the glass over the headline in S-strokes.
  const blade = hero.querySelector('.squeegee');
  function intro() {
    const hr = hero.getBoundingClientRect();
    const cr = title.getBoundingClientRect();
    const r = radius();
    const left = Math.max(cr.left - hr.left - 20, 10);
    const right = Math.min(cr.right - hr.left + 30, hr.width - 10);
    const top = cr.top - hr.top + r * 0.5;
    const bottom = cr.bottom - hr.top - r * 0.35;
    const rows = Math.max(3, Math.round((bottom - top) / (r * 1.5)) + 1);
    const rowH = (bottom - top) / (rows - 1);
    const path = [];
    for (let i = 0; i < rows; i++) {
      const y = top + i * rowH;
      const [from, to] = i % 2 ? [right, left] : [left, right];
      path.push({ x: from, y }, { x: to, y: y + rowH * 0.25 });
    }

    if (reduceMotion) {
      for (let i = 1; i < path.length; i++) {
        glass.wipe(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y, r * 1.3);
      }
      finishIntro(path);
      return;
    }

    // Lengths along the path so the blade moves at a steady speed.
    const lengths = [0];
    for (let i = 1; i < path.length; i++) {
      lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    }
    const total = lengths[lengths.length - 1];
    const duration = Math.min(2600, 700 + total * 0.9);
    const delay = 450;
    let start = null;
    let passed = 0;

    function tick(now) {
      if (start === null) start = now;
      const t = (now - start - delay) / duration;
      if (t < 0) return requestAnimationFrame(tick);
      // Put the blade down at the start, however late the first frame comes.
      if (passed === 0 && !last) wipeTo(path[0].x, path[0].y);
      const eased = t >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * t);
      const dist = Math.min(eased, 1) * total;
      let i = 1;
      while (i < lengths.length - 1 && lengths[i] < dist) i++;
      // Pass through every corner reached since the last frame, so slow frames don't cut corners.
      for (let v = passed + 1; v < i; v++) wipeTo(path[v].x, path[v].y);
      passed = i - 1;
      const k = (dist - lengths[i - 1]) / Math.max(lengths[i] - lengths[i - 1], 1e-6);
      const x = path[i - 1].x + (path[i].x - path[i - 1].x) * k;
      const y = path[i - 1].y + (path[i].y - path[i - 1].y) * k;
      wipeTo(x, y);
      if (blade) {
        blade.classList.add('is-on');
        const dir = path[i].x > path[i - 1].x ? 1 : -1;
        blade.style.transform = `translate(${x}px, ${y}px) rotate(${dir * 8}deg)`;
      }
      if (t < 1) requestAnimationFrame(tick);
      else finishIntro(path);
    }
    requestAnimationFrame(tick);
  }

  // Wait for the fonts so the squeegee follows the final layout: the sign's
  // text wrapping moves the headline too. Polish letters live in a separate
  // subset, so ask for them explicitly.
  const polish = 'Sprzątanie ĄĆĘŁŃÓŚŹŻąćęłńóśźż';
  const titleFont = getComputedStyle(title);
  const bodyFont = getComputedStyle(hero.querySelector('.hero__lead') ?? title).fontFamily;
  const fontsIn = document.fonts
    ? Promise.all([
        document.fonts.load(`${titleFont.fontWeight} ${titleFont.fontSize} ${titleFont.fontFamily}`, polish),
        document.fonts.load(`400 16px ${bodyFont}`, polish),
        document.fonts.load(`700 16px ${bodyFont}`, polish),
      ]).then(() => document.fonts.ready)
    : Promise.resolve();
  Promise.race([fontsIn, new Promise((r) => setTimeout(r, 3000))]).then(intro, intro);
}

function setupContact() {
  const section = document.querySelector('.contact');
  bubbleStage(section, section?.querySelector('.contact__bubbles'), { count: 10 });
}

// On phones and tablets, tipping the device leans the bubbles. Only where
// the browser allows it without asking: no permission prompts on a landing page.
function setupTilt() {
  if (reduceMotion || typeof DeviceOrientationEvent === 'undefined') return;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') return;
  window.addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return;
    const angle = screen.orientation?.angle ?? 0;
    const lean = angle === 90 ? e.beta : angle === 270 || angle === -90 ? -e.beta : e.gamma;
    tilt.x = Math.max(-1, Math.min(1, lean / 35));
  });
}

setupHero();
setupContact();

if (layers.length) {
  document.documentElement.classList.add('has-webgl');
  setupTilt();

  let prev = performance.now();
  let time = 0;
  // Frame time, smoothed; if it stays slow for a while, lighten the load once.
  let slow = 0;
  let pace = 1 / 60;
  function loop(now) {
    const raw = (now - prev) / 1000;
    const dt = Math.min(raw, 1 / 20);
    prev = now;
    time += dt;
    if (slow >= 0 && raw < 0.5 && !document.hidden) {
      pace += (raw - pace) * 0.05;
      slow = pace > 1 / 36 ? slow + raw : 0;
      if (slow > 2.5) {
        slow = -1;
        layers.forEach((l) => l.degrade?.());
      }
    }
    for (const layer of layers) {
      if (layer.visible || !layer.drawn) {
        layer.frame(dt, time);
        layer.drawn = true;
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
