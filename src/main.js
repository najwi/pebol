import { PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { createBubbles } from './bubbles.js';
import { createFog } from './fog.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scenes = [];

function makeRenderer(canvas) {
  try {
    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0x000000, 0);
    return renderer;
  } catch {
    return null;
  }
}

// A canvas that fills its section, with bubbles in a perspective scene.
function bubbleStage(section, canvas, { count, fog = false }) {
  const renderer = makeRenderer(canvas);
  if (!renderer) return null;
  renderer.autoClear = false;

  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 12);
  const bubbles = createBubbles(scene, { count, pixelRatio: renderer.getPixelRatio() });
  const glass = fog ? createFog(renderer) : null;

  const stage = {
    section,
    renderer,
    visible: true,
    width: 1,
    height: 1,
    pointer: { active: false, world: new Vector3() },
    resize() {
      const w = section.clientWidth;
      const h = section.clientHeight;
      if (w === stage.width && h === stage.height) return;
      stage.width = w;
      stage.height = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      bubbles.setArea(halfH * camera.aspect + 0.5, halfH + 0.5);
      glass?.resize(w, h);
    },
    frame(dt, time) {
      bubbles.update(reduceMotion ? 0 : dt, reduceMotion ? 4 : time, stage.pointer);
      glass?.step(dt);
      renderer.setRenderTarget(null);
      renderer.clear();
      glass?.render(time);
      renderer.render(scene, camera);
    },
    toWorld(x, y, out) {
      const ndc = new Vector3((x / stage.width) * 2 - 1, -(y / stage.height) * 2 + 1, 0.5).unproject(camera);
      const dir = ndc.sub(camera.position).normalize();
      return out.copy(camera.position).addScaledVector(dir, -camera.position.z / dir.z);
    },
    popAt(x, y) {
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2((x / stage.width) * 2 - 1, -(y / stage.height) * 2 + 1), camera);
      return bubbles.popAt(ray);
    },
    glass,
  };

  new IntersectionObserver(([entry]) => {
    stage.visible = entry.isIntersecting;
  }).observe(section);

  section.addEventListener('click', (e) => {
    if (e.target.closest('a, button')) return;
    const r = section.getBoundingClientRect();
    stage.popAt(e.clientX - r.left, e.clientY - r.top);
  });

  stage.resize();
  scenes.push(stage);
  return stage;
}

function setupHero() {
  const hero = document.querySelector('.hero');
  const canvas = hero?.querySelector('.hero__glass');
  if (!canvas) return;
  const stage = bubbleStage(hero, canvas, { count: 14, fog: true });
  if (!stage) return;
  hero.classList.add('is-fogged');

  const radius = () => Math.max(34, Math.min(70, stage.width * 0.05));
  let last = null;

  function wipeTo(x, y) {
    if (last) stage.glass.wipe(last.x, last.y, x, y, radius());
    last = { x, y };
    stage.pointer.active = true;
    stage.toWorld(x, y, stage.pointer.world);
  }

  function local(e) {
    const r = hero.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  let introDone = false;
  hero.addEventListener('pointermove', (e) => {
    if (!introDone) return;
    const p = local(e);
    wipeTo(p.x, p.y);
  });
  hero.addEventListener('pointerleave', () => {
    last = null;
    stage.pointer.active = false;
  });
  hero.addEventListener(
    'touchmove',
    (e) => {
      if (!introDone) return;
      const p = local(e.touches[0]);
      wipeTo(p.x, p.y);
    },
    { passive: true },
  );
  hero.addEventListener('touchend', () => {
    last = null;
    stage.pointer.active = false;
  });

  // Opening move: a squeegee clears the glass over the headline in S-strokes.
  const copy = hero.querySelector('.hero__copy');
  const blade = hero.querySelector('.squeegee');
  const hr = hero.getBoundingClientRect();
  const cr = copy.getBoundingClientRect();
  const left = cr.left - hr.left - 20;
  const right = Math.min(cr.right - hr.left + 40, stage.width - 10);
  const top = cr.top - hr.top + 10;
  const rows = Math.max(3, Math.round(cr.height / (radius() * 1.6)));
  const rowH = (cr.height - 20) / (rows - 1);
  const path = [];
  for (let i = 0; i < rows; i++) {
    const y = top + i * rowH;
    const [from, to] = i % 2 ? [right, left] : [left, right];
    path.push({ x: from, y }, { x: to, y: y + rowH * 0.25 });
  }

  function finishIntro() {
    introDone = true;
    last = null;
    stage.pointer.active = false;
    blade?.classList.remove('is-on');
    hero.classList.add('is-wipeable');
  }

  if (reduceMotion) {
    for (let i = 1; i < path.length; i++) {
      stage.glass.wipe(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y, radius() * 1.3);
    }
    finishIntro();
    return;
  }

  // Lengths along the path so the blade moves at a steady speed.
  const lengths = [0];
  for (let i = 1; i < path.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  }
  const total = lengths[lengths.length - 1];
  const duration = Math.min(2600, 700 + total * 0.9);
  const delay = 500;
  let start = null;
  let passed = 0;

  function tick(now) {
    if (start === null) start = now;
    const t = (now - start - delay) / duration;
    if (t < 0) return requestAnimationFrame(tick);
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
    else finishIntro();
  }
  requestAnimationFrame(tick);
}

function setupContact() {
  const section = document.querySelector('.contact');
  const canvas = section?.querySelector('.contact__bubbles');
  if (canvas) bubbleStage(section, canvas, { count: 10 });
}

setupHero();
setupContact();

if (scenes.length) {
  document.documentElement.classList.add('has-webgl');
  window.addEventListener('resize', () => scenes.forEach((s) => s.resize()));

  let prev = performance.now();
  let time = 0;
  let drewStill = false;
  function loop(now) {
    const dt = Math.min((now - prev) / 1000, 1 / 20);
    prev = now;
    time += dt;
    for (const s of scenes) {
      if (s.visible || !drewStill) s.frame(dt, time);
    }
    drewStill = true;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
