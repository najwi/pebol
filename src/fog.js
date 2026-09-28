// A steamed-up glass pane over the hero. Wiping paints into a mask
// (ping-pong render targets); the fog slowly creeps back, but never fully.
import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';

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
  uniform vec2 uA;
  uniform vec2 uB;
  uniform float uRadius;
  uniform float uActive;
  uniform float uAspect;
  uniform float uDt;
  varying vec2 vUv;

  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec2 prev = texture2D(uPrev, vUv).rg;
    // Condensation returns towards 45% of the fog where the glass was wiped.
    float floorClean = prev.g * 0.55;
    float clean = max(floorClean, prev.r - uDt * 0.035);

    vec2 s = vec2(uAspect, 1.0);
    float d = segment(vUv * s, uA * s, uB * s);
    float stamp = smoothstep(uRadius, uRadius * 0.7, d) * uActive;

    clean = max(clean, stamp);
    gl_FragColor = vec4(clean, max(prev.g, stamp), 0.0, 1.0);
  }
`;

const fogFragment = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec2 uTexel;
  uniform float uAspect;
  uniform float uTime;
  uniform float uOpacity;
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
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  // Condensation droplets on a jittered grid; returns (coverage, highlight).
  vec2 droplets(vec2 p, float scale) {
    vec2 g = p * scale;
    vec2 id = floor(g);
    vec2 f = fract(g);
    vec2 h = hash2(id);
    if (h.x < 0.72) return vec2(0.0);
    vec2 c = 0.25 + 0.5 * hash2(id + 7.3);
    float r = 0.1 + 0.22 * h.y;
    vec2 q = (f - c) / r;
    float d = length(q);
    float cover = smoothstep(1.0, 0.8, d);
    float spot = smoothstep(0.45, 0.1, length(q - vec2(-0.35, 0.4)));
    return vec2(cover, spot * cover);
  }

  void main() {
    vec2 p = vUv * vec2(uAspect, 1.0);
    float clean = texture2D(uMask, vUv).r;

    // The wiped edge carries a thin bead of water.
    float cx = texture2D(uMask, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uMask, vUv - vec2(uTexel.x, 0.0)).r;
    float cy = texture2D(uMask, vUv + vec2(0.0, uTexel.y)).r - texture2D(uMask, vUv - vec2(0.0, uTexel.y)).r;
    float edge = clamp(length(vec2(cx, cy)) * 2.2, 0.0, 1.0);

    float cloud = fbm(p * 3.0 + vec2(0.0, uTime * 0.015));
    float grain = fbm(p * 38.0);
    vec3 fogColor = mix(vec3(0.88, 0.9, 0.92), vec3(1.0), cloud * 0.8 + grain * 0.2);
    float fog = 0.84 + 0.12 * cloud;

    vec2 dropA = droplets(p, 22.0);
    vec2 dropB = droplets(p + 3.1, 48.0);
    float drop = max(dropA.x, dropB.x * 0.8);
    float shine = max(dropA.y, dropB.y);

    // Droplets are clearer than the fog around them.
    float alpha = fog * (1.0 - drop * 0.15);
    vec3 color = mix(fogColor, vec3(1.0), shine * 0.9);

    alpha *= (1.0 - clean);
    alpha = max(alpha, edge * 0.55);
    color = mix(color, vec3(1.0), edge);

    gl_FragColor = vec4(color, alpha * uOpacity);
  }
`;

export function createFog(renderer) {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new PlaneGeometry(2, 2);

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
    vertexShader: quadVertex,
    fragmentShader: maskFragment,
    uniforms: {
      uPrev: { value: read.texture },
      uA: { value: new Vector2() },
      uB: { value: new Vector2() },
      uRadius: { value: 0.08 },
      uActive: { value: 0 },
      uAspect: { value: 1 },
      uDt: { value: 0 },
    },
  });
  const maskScene = new Scene();
  maskScene.add(new Mesh(quad, maskMaterial));

  const fogMaterial = new ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: fogFragment,
    uniforms: {
      uMask: { value: write.texture },
      uTexel: { value: new Vector2() },
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const scene = new Scene();
  scene.add(new Mesh(quad, fogMaterial));

  // Queue of wipe segments in uv space (0..1, y up).
  const strokes = [];
  let width = 1;
  let height = 1;

  function resize(w, h) {
    const widthChanged = w !== width;
    width = w;
    height = h;
    const aspect = w / h;
    maskMaterial.uniforms.uAspect.value = aspect;
    fogMaterial.uniforms.uAspect.value = aspect;
    // Height-only changes (mobile toolbars) just stretch the mask.
    if (!widthChanged) return;
    const mw = Math.max(64, Math.round(w / 3));
    const mh = Math.max(64, Math.round(h / 3));
    // Resizing clears the targets, so the glass fogs up again.
    read.setSize(mw, mh);
    write.setSize(mw, mh);
    fogMaterial.uniforms.uTexel.value.set(2 / mw, 2 / mh);
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearAlpha(0);
    for (const t of [read, write]) {
      renderer.setRenderTarget(t);
      renderer.clear(true, false, false);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevAlpha);
  }

  // Wipe from a to b, in CSS pixels relative to the pane; radius in CSS pixels.
  function wipe(ax, ay, bx, by, radius) {
    strokes.push([ax / width, 1 - ay / height, bx / width, 1 - by / height, radius / height]);
  }

  function step(dt) {
    const u = maskMaterial.uniforms;
    const pending = strokes.length ? strokes.splice(0) : [null];
    for (let i = 0; i < pending.length; i++) {
      const s = pending[i];
      u.uPrev.value = read.texture;
      u.uDt.value = i === 0 ? dt : 0;
      u.uActive.value = s ? 1 : 0;
      if (s) {
        u.uA.value.set(s[0], s[1]);
        u.uB.value.set(s[2], s[3]);
        u.uRadius.value = s[4];
      }
      renderer.setRenderTarget(write);
      renderer.render(maskScene, camera);
      [read, write] = [write, read];
    }
    renderer.setRenderTarget(null);
    fogMaterial.uniforms.uMask.value = read.texture;
  }

  function render(time) {
    fogMaterial.uniforms.uTime.value = time;
    renderer.render(scene, camera);
  }

  return {
    resize,
    wipe,
    step,
    render,
    set opacity(v) {
      fogMaterial.uniforms.uOpacity.value = v;
    },
  };
}
