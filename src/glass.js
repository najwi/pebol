// The hero window. Behind the glass is the red wall with the headline painted
// on it, drawn into a texture so the steam can blur it and droplets can bend
// it. Wiping paints into a mask (ping-pong render targets); condensation
// creeps back, never fully, and drops of water run down the pane.
import {
  CanvasTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three';

const MAX_STAMPS = 24;
const MAX_DRIPS = 8;
const PAINT = '#F5C400';
const WALL = '#E4262A';

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// r: how clean the glass is now, g: the most it has ever been wiped.
const maskFragment = /* glsl */ `
  uniform sampler2D uPrev;
  uniform vec4 uSeg[MAX_STAMPS];
  uniform float uRad[MAX_STAMPS];
  uniform int uCount;
  uniform float uAspect;
  uniform float uDt;
  varying vec2 vUv;

  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec2 prev = texture2D(uPrev, vUv).rg;
    // Condensation returns towards a third of the fog where the glass was wiped.
    float clean = max(prev.g * 0.68, prev.r - uDt * 0.035);

    vec2 s = vec2(uAspect, 1.0);
    float stamp = 0.0;
    for (int i = 0; i < MAX_STAMPS; i++) {
      if (i >= uCount) break;
      float d = segment(vUv * s, uSeg[i].xy * s, uSeg[i].zw * s);
      stamp = max(stamp, smoothstep(uRad[i], uRad[i] * 0.7, d));
    }

    clean = max(clean, stamp);
    gl_FragColor = vec4(clean, max(prev.g, stamp), 0.0, 1.0);
  }
`;

const glassFragment = /* glsl */ `
  uniform sampler2D uMask;
  uniform sampler2D uWall;
  uniform vec2 uTexel;
  uniform float uAspect;
  uniform float uTime;
  uniform vec3 uDrips[MAX_DRIPS];
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  // Condensation droplets on a jittered grid.
  // xy: how far the droplet bends the view, z: coverage,
  // w: light (a highlight at the top, positive) or shade (its lower rim, negative).
  vec4 droplets(vec2 p, float scale, float density) {
    vec2 g = p * scale;
    vec2 id = floor(g);
    vec2 h = hash2(id);
    if (h.x > density) return vec4(0.0);
    vec2 c = 0.25 + 0.5 * hash2(id + 7.3);
    float r = 0.1 + 0.2 * h.y;
    vec2 q = (fract(g) - c) / r;
    float d = length(q);
    float cover = smoothstep(1.0, 0.8, d);
    float spot = smoothstep(0.4, 0.05, length(q - vec2(-0.3, 0.42)));
    float shade = smoothstep(0.5, 0.95, d) * smoothstep(0.2, -0.6, q.y);
    return vec4(-q * (r / scale) * cover, cover, (spot - shade * 0.6) * cover);
  }

  // Steam scatters light: a wide, soft sample of the wall.
  vec3 blurWall(vec2 uv, float radius) {
    vec3 sum = texture2D(uWall, uv, 4.5).rgb * 2.0;
    for (int i = 0; i < 7; i++) {
      float a = float(i) * 0.8976 + 0.39;
      vec2 o = vec2(cos(a) / uAspect, sin(a)) * radius;
      sum += texture2D(uWall, uv + o, 3.5).rgb;
    }
    return sum / 9.0;
  }

  void main() {
    vec2 p = vUv * vec2(uAspect, 1.0);
    float clean = texture2D(uMask, vUv).r;
    float steam = 1.0 - clean;

    // Wiped edges carry a thin bead of water.
    float cx = texture2D(uMask, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uMask, vUv - vec2(uTexel.x, 0.0)).r;
    float cy = texture2D(uMask, vUv + vec2(0.0, uTexel.y)).r - texture2D(uMask, vUv - vec2(0.0, uTexel.y)).r;
    float edge = clamp(length(vec2(cx, cy)) * 2.0, 0.0, 1.0);

    float cloud = fbm(p * 2.6 + vec2(0.0, uTime * 0.012));
    float mist = noise(p * 160.0);

    vec4 dA = droplets(p, 17.0, 0.12);
    vec4 dB = droplets(p + 3.1, 40.0, 0.3);
    vec4 dC = droplets(p + 7.7, 96.0, 0.42);

    // Drops running down the pane.
    vec2 runLens = vec2(0.0);
    float runCover = 0.0;
    float runSpot = 0.0;
    for (int i = 0; i < MAX_DRIPS; i++) {
      vec3 d = uDrips[i];
      if (d.z <= 0.0) continue;
      vec2 q = (p - vec2(d.x * uAspect, d.y)) / d.z;
      q.y *= q.y > 0.0 ? 1.25 : 0.9;
      float cover = smoothstep(1.0, 0.72, length(q));
      runLens -= q * d.z * cover;
      runCover = max(runCover, cover);
      runSpot = max(runSpot, smoothstep(0.45, 0.1, length(q - vec2(-0.3, 0.35))) * cover);
    }

    float drop = max(max(dA.z, dB.z * 0.8), dC.z * 0.45) * steam;
    vec2 lens = (dA.xy + dB.xy) * steam + runLens;

    vec3 sharp = texture2D(uWall, vUv + vec2(lens.x / uAspect, lens.y)).rgb;
    vec3 soft = blurWall(vUv, 0.016 + 0.014 * cloud);
    vec3 milk = mix(vec3(0.96, 0.9, 0.9), vec3(1.0, 0.985, 0.975), cloud);
    vec3 steamed = mix(soft, milk, 0.46 + 0.2 * cloud + mist * 0.06);

    float fog = steam * (0.84 + 0.12 * cloud);
    // Droplets are clearer than the steam around them; running drops, fully.
    fog *= (1.0 - drop * 0.4) * (1.0 - runCover * 0.9);

    vec3 color = mix(sharp, steamed, fog);
    float light = (dA.w + dB.w * 0.8 + dC.w * 0.4) * steam;
    color = mix(color, vec3(1.0), max(max(light, 0.0), runSpot) * 0.8);
    color *= 1.0 + min(light, 0.0) * 0.35;
    color = mix(color, vec3(1.0), edge * 0.5);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createGlass(renderer, { hero, title, still = false }) {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new PlaneGeometry(2, 2);

  const wallCanvas = document.createElement('canvas');
  const wall = new CanvasTexture(wallCanvas);
  wall.minFilter = LinearMipmapLinearFilter;
  wall.magFilter = LinearFilter;

  const targetOptions = {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  };
  let read = new WebGLRenderTarget(4, 4, targetOptions);
  let write = new WebGLRenderTarget(4, 4, targetOptions);

  const maskMaterial = new ShaderMaterial({
    defines: { MAX_STAMPS },
    vertexShader: quadVertex,
    fragmentShader: maskFragment,
    uniforms: {
      uPrev: { value: read.texture },
      uSeg: { value: Array.from({ length: MAX_STAMPS }, () => new Vector4()) },
      uRad: { value: new Array(MAX_STAMPS).fill(0) },
      uCount: { value: 0 },
      uAspect: { value: 1 },
      uDt: { value: 0 },
    },
  });
  const maskScene = new Scene();
  maskScene.add(new Mesh(quad, maskMaterial));

  const glassMaterial = new ShaderMaterial({
    defines: { MAX_DRIPS },
    vertexShader: quadVertex,
    fragmentShader: glassFragment,
    uniforms: {
      uMask: { value: read.texture },
      uWall: { value: wall },
      uTexel: { value: new Vector2() },
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uDrips: { value: Array.from({ length: MAX_DRIPS }, () => new Vector3()) },
    },
    depthWrite: false,
    depthTest: false,
  });
  const scene = new Scene();
  scene.add(new Mesh(quad, glassMaterial));

  let width = 1;
  let height = 1;
  // Wipe segments waiting for the next mask pass, in uv space (y up).
  const stamps = [];
  const drips = [];
  let wiped = 0;
  let nextDrip = 3;

  // The wall: brand red, lit from the upper left, with the headline painted
  // exactly where the (transparent) HTML headline sits.
  function paint() {
    const dpr = renderer.getPixelRatio();
    const cw = Math.max(1, Math.round(width * dpr));
    const ch = Math.max(1, Math.round(height * dpr));
    if (wallCanvas.width !== cw || wallCanvas.height !== ch) {
      wallCanvas.width = cw;
      wallCanvas.height = ch;
      // A texture can't change size once uploaded, so start a fresh one.
      wall.dispose();
    }
    const ctx = wallCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = WALL;
    ctx.fillRect(0, 0, width, height);
    const light = ctx.createRadialGradient(width * 0.28, height * 0.1, 0, width * 0.28, height * 0.1, Math.hypot(width, height) * 0.9);
    light.addColorStop(0, 'rgba(255, 110, 80, 0.3)');
    light.addColorStop(0.5, 'rgba(228, 38, 42, 0)');
    light.addColorStop(1, 'rgba(120, 0, 14, 0.32)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, width, height);

    const cs = getComputedStyle(title);
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ('fontStretch' in ctx) ctx.fontStretch = 'condensed';
    if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing;
    ctx.fillStyle = PAINT;
    const metrics = ctx.measureText('Sp');
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;

    const origin = hero.getBoundingClientRect();
    const range = document.createRange();
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const word of node.nodeValue.matchAll(/\S+/g)) {
        range.setStart(node, word.index);
        range.setEnd(node, word.index + word[0].length);
        const box = range.getClientRects()[0];
        if (!box) continue;
        const baseline = box.top - origin.top + (box.height - ascent - descent) / 2 + ascent;
        // Fit each word to its HTML width, in case this browser draws the
        // condensed cut slightly differently on canvas.
        const drawn = ctx.measureText(word[0]).width;
        const fit = drawn > 0 ? box.width / drawn : 1;
        ctx.save();
        ctx.translate(box.left - origin.left, baseline);
        if (Math.abs(fit - 1) > 0.01) ctx.scale(fit, 1);
        ctx.fillText(word[0], 0, 0);
        ctx.restore();
      }
    }
    wall.needsUpdate = true;
  }

  function resize(w, h) {
    const widthChanged = w !== width;
    width = w;
    height = h;
    const aspect = w / h;
    maskMaterial.uniforms.uAspect.value = aspect;
    glassMaterial.uniforms.uAspect.value = aspect;
    paint();
    // Height-only changes (mobile toolbars) just stretch the mask.
    if (!widthChanged) return;
    const mw = Math.max(64, Math.round(w / 1.5));
    const mh = Math.max(64, Math.round(h / 1.5));
    // Resizing clears the targets, so the glass fogs up again.
    read.setSize(mw, mh);
    write.setSize(mw, mh);
    glassMaterial.uniforms.uTexel.value.set(1.5 / mw, 1.5 / mh);
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearAlpha(0);
    for (const t of [read, write]) {
      renderer.setRenderTarget(t);
      renderer.clear(true, false, false);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevAlpha);
    drips.length = 0;
  }

  // CSS pixels relative to the pane, radius in CSS pixels.
  function stamp(ax, ay, bx, by, radius) {
    stamps.push([ax / width, 1 - ay / height, bx / width, 1 - by / height, radius / height]);
  }

  // A drop of water that runs down the glass, stopping and starting.
  function drip(x, y, r) {
    if (still || drips.length >= MAX_DRIPS || y > height - 20) return;
    drips.push({ x, y, x0: x, r, v: 0, hold: 0.15 + Math.random() * 0.5, run: 0, max: 90 + Math.random() * 340, phase: Math.random() * 6.3 });
  }

  // A wipe with the squeegee, cursor or finger. Water gathers at the lower
  // edge of the stroke and now and then runs off as a drip.
  function wipe(ax, ay, bx, by, radius) {
    stamp(ax, ay, bx, by, radius);
    wiped += Math.hypot(bx - ax, by - ay);
    if (wiped > 520) {
      wiped = 0;
      drip(bx + (Math.random() - 0.5) * radius, Math.max(ay, by) + radius * 0.8, 3.5 + Math.random() * 2.5);
    }
  }

  // Spray from a popped bubble lands on the glass as clear specks.
  function splash(x, y, r) {
    const n = 10 + Math.round(r / 5);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = r * (0.6 + Math.random() * 0.9);
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      stamp(px, py, px, py, 2.5 + Math.random() * Math.min(7, r * 0.1));
    }
    if (r > 35) drip(x + (Math.random() - 0.5) * r, y + r * 0.9, 4 + Math.random() * 2);
  }

  function stepDrips(dt) {
    if (still) return;
    nextDrip -= dt;
    if (nextDrip <= 0) {
      nextDrip = 3 + Math.random() * 5;
      drip(width * (0.04 + Math.random() * 0.92), height * (0.05 + Math.random() * 0.5), 3.5 + Math.random() * 2.5);
    }
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i];
      if (d.hold > 0) {
        d.hold -= dt;
        continue;
      }
      d.v = Math.min(d.v + 600 * dt, 35 + d.r * 20);
      if (Math.random() < dt * 0.8) {
        d.hold = 0.1 + Math.random() * 0.7;
        d.v = 0;
      }
      const y = d.y + d.v * dt;
      d.run += y - d.y;
      const x = d.x0 + Math.sin(d.run * 0.03 + d.phase) * d.r * 0.9;
      stamp(d.x, d.y, x, y, Math.max(2.4, d.r * 0.72));
      d.x = x;
      d.y = y;
      d.r = Math.max(2.2, d.r - dt * 0.35);
      if (d.run > d.max || d.y > height + 10) {
        stamp(x, y, x, y, d.r);
        drips.splice(i, 1);
      }
    }
  }

  function step(dt) {
    stepDrips(dt);
    const u = maskMaterial.uniforms;
    let first = true;
    do {
      const batch = stamps.splice(0, MAX_STAMPS);
      batch.forEach((s, i) => {
        u.uSeg.value[i].set(s[0], s[1], s[2], s[3]);
        u.uRad.value[i] = s[4];
      });
      u.uCount.value = batch.length;
      u.uDt.value = first ? dt : 0;
      u.uPrev.value = read.texture;
      renderer.setRenderTarget(write);
      renderer.render(maskScene, camera);
      [read, write] = [write, read];
      first = false;
    } while (stamps.length);
    renderer.setRenderTarget(null);
    glassMaterial.uniforms.uMask.value = read.texture;
  }

  function render(time) {
    const u = glassMaterial.uniforms;
    u.uTime.value = time;
    u.uDrips.value.forEach((v, i) => {
      const d = drips[i];
      if (d) v.set(d.x / width, 1 - d.y / height, (d.r * 1.25) / height);
      else v.set(0, 0, 0);
    });
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }

  return { resize, paint, wipe, stamp, splash, drip, step, render };
}
