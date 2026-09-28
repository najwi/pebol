// Soap bubbles: instanced spheres with a thin-film (interference) shader.
// They drift upwards, sway in the air the pointer stirs, and pop from the
// point you touch: a hole races across the film and flings droplets off its rim.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Points,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

const RUPTURE = 0.16; // seconds for the hole to cross the bubble
const RESPAWN = 1.1; // seconds after a pop before the bubble comes back
const DROPS_PER_POP = 34;
const DROP_POOL = DROPS_PER_POP * 8;

const bubbleVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aAlpha;
  attribute float aHover;
  attribute vec4 aPop;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  varying float vSeed;
  varying float vAlpha;
  varying float vHover;
  varying vec4 vPop;
  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    vLocal = position;
    vSeed = aSeed;
    vAlpha = aAlpha;
    vHover = aHover;
    vPop = aPop;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const bubbleFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  varying float vSeed;
  varying float vAlpha;
  varying float vHover;
  varying vec4 vPop;

  void main() {
    // A popping bubble: everything within the hole's reach is gone.
    float lip = 0.0;
    if (vPop.w >= 0.0) {
      float reach = acos(clamp(dot(normalize(vLocal), vPop.xyz), -1.0, 1.0)) / 3.14159265;
      float front = reach - vPop.w;
      if (front < 0.0) discard;
      // The film gathers into a bright, thick rim as it pulls back.
      lip = smoothstep(0.12, 0.0, front);
    }

    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    float facing = abs(dot(n, vView));
    float fres = 1.0 - facing;

    // Film thickness: swirling bands that drain towards the bottom of the bubble.
    float t = uTime * 0.35 + vSeed * 12.0;
    float thickness = 0.55
      + 0.22 * sin(vLocal.y * 4.0 + t)
      + 0.14 * sin(vLocal.x * 6.0 - t * 1.3 + vLocal.z * 3.0)
      + 0.10 * sin(length(vLocal.xz) * 9.0 + t * 0.7)
      - vLocal.y * 0.35;

    // Thin-film interference approximated with a phase-shifted cosine palette.
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (thickness * 1.8 + fres * 0.9 + vec3(0.0, 0.33, 0.67)));

    // Two soft window reflections.
    vec3 r = reflect(-vView, n);
    float spec = pow(max(dot(r, normalize(vec3(-0.45, 0.75, 0.5))), 0.0), 70.0) * 1.3
               + pow(max(dot(r, normalize(vec3(0.6, -0.25, 0.75))), 0.0), 160.0) * 0.7;

    float rim = pow(fres, 2.4);
    vec3 color = film * (0.25 + rim * (1.1 + vHover * 0.8)) + vec3(spec);
    float alpha = clamp(0.04 + vHover * 0.06 + rim * (0.8 + vHover * 0.3) + spec, 0.0, 1.0);

    color = mix(color, vec3(1.0), lip * 0.8);
    alpha = max(alpha, lip * 0.9);
    gl_FragColor = vec4(color, alpha * vAlpha);
  }
`;

const dropVertex = /* glsl */ `
  attribute float aLife;
  uniform float uPixelRatio;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (3.0 + 7.0 * aLife) * uPixelRatio * (9.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const dropFragment = /* glsl */ `
  varying float vLife;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5 || vLife <= 0.0) discard;
    float a = smoothstep(0.5, 0.2, d) * min(vLife * 1.6, 1.0);
    gl_FragColor = vec4(vec3(1.0), a * 0.95);
  }
`;

export function createBubbles(scene, camera, { count = 16, pixelRatio = 1, still = false, appear = 0 } = {}) {
  const area = { x: 6, y: 4 };
  const view = { w: 0, h: 0 };
  // Narrow (portrait) screens get smaller bubbles, so one never hides the page.
  let size = 1;

  const geometry = new SphereGeometry(1, 48, 32);
  const seeds = new Float32Array(count);
  const alphas = new Float32Array(count);
  const hovers = new Float32Array(count);
  const pops = new Float32Array(count * 4);
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
  geometry.setAttribute('aAlpha', new InstancedBufferAttribute(alphas, 1));
  geometry.setAttribute('aHover', new InstancedBufferAttribute(hovers, 1));
  geometry.setAttribute('aPop', new InstancedBufferAttribute(pops, 4));

  const material = new ShaderMaterial({
    vertexShader: bubbleVertex,
    fragmentShader: bubbleFragment,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });

  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const bubbles = [];
  for (let i = 0; i < count; i++) {
    const b = {
      seed: 0,
      pos: new Vector3(),
      vel: new Vector3(),
      wind: new Vector3(),
      hit: new Vector3(),
      u: new Vector3(),
      v: new Vector3(),
      radius: 1,
      pop: -1,
      shed: 0,
      age: 0,
      hover: 0,
    };
    spawn(b, true);
    // Bubbles fade in one by one when the page opens.
    b.age = -(appear + Math.random() * 1.6);
    seeds[i] = b.seed;
    pops[i * 4 + 3] = -1;
    bubbles.push(b);
  }

  function spawn(b, anywhere) {
    b.radius = (0.2 + Math.pow(Math.random(), 1.8) * 0.75) * size;
    b.pos.set(
      (Math.random() * 2 - 1) * area.x,
      anywhere ? (Math.random() * 2 - 1) * area.y : -area.y - b.radius - Math.random() * 2,
      (Math.random() * 2 - 1) * 1.5,
    );
    b.vel.set((Math.random() - 0.5) * 0.15, 0.18 + Math.random() * 0.25, 0);
    b.wind.set(0, 0, 0);
    b.seed = Math.random();
    b.pop = -1;
    b.age = 0;
  }

  // Droplets for popped bubbles
  const dropPos = new Float32Array(DROP_POOL * 3);
  const dropLife = new Float32Array(DROP_POOL);
  const dropVel = new Float32Array(DROP_POOL * 3);
  const dropGeometry = new BufferGeometry();
  dropGeometry.setAttribute('position', new BufferAttribute(dropPos, 3));
  dropGeometry.setAttribute('aLife', new BufferAttribute(dropLife, 1));
  const drops = new Points(
    dropGeometry,
    new ShaderMaterial({
      vertexShader: dropVertex,
      fragmentShader: dropFragment,
      uniforms: { uPixelRatio: { value: pixelRatio } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  drops.frustumCulled = false;
  scene.add(drops);
  let nextDrop = 0;

  const dir = new Vector3();
  const tangent = new Vector3();

  // Fling droplets off the rim of the hole, which sits `angle` radians from
  // the point where the bubble was touched.
  function shed(b, angle, n, scale) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let k = 0; k < n; k++) {
      const phi = Math.random() * Math.PI * 2;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      // Point on the rim, and the direction the rim is moving in.
      dir.copy(b.hit).multiplyScalar(cos).addScaledVector(b.u, sin * cp).addScaledVector(b.v, sin * sp);
      tangent.copy(b.hit).multiplyScalar(-sin).addScaledVector(b.u, cos * cp).addScaledVector(b.v, cos * sp);
      const i = nextDrop;
      nextDrop = (nextDrop + 1) % DROP_POOL;
      const speed = 1.4 + Math.random() * 2.2;
      dropPos[i * 3] = b.pos.x + dir.x * scale;
      dropPos[i * 3 + 1] = b.pos.y + dir.y * scale;
      dropPos[i * 3 + 2] = b.pos.z + dir.z * scale;
      dropVel[i * 3] = tangent.x * speed + dir.x * 0.6;
      dropVel[i * 3 + 1] = tangent.y * speed + dir.y * 0.6 + 0.4;
      dropVel[i * 3 + 2] = tangent.z * speed + dir.z * 0.6;
      dropLife[i] = 0.6 + Math.random() * 0.4;
    }
  }

  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const offset = new Vector3();

  // air: { active, world, vel } from the pointer; tilt: sideways lean, -1..1.
  function update(dt, time, air, tilt = 0) {
    const drift = still ? 0 : dt;
    material.uniforms.uTime.value = still ? 4 : time;
    for (let i = 0; i < count; i++) {
      const b = bubbles[i];
      b.age += dt;
      let scale = b.radius;
      if (b.pop >= 0) {
        const before = Math.min(b.pop / RUPTURE, 1);
        b.pop += dt;
        const k = Math.min(b.pop / RUPTURE, 1);
        if (k > before) {
          b.shed += (k - before) * DROPS_PER_POP;
          const n = Math.floor(b.shed);
          b.shed -= n;
          shed(b, k * Math.PI, n, scale);
        }
        pops[i * 4 + 3] = b.pop < RUPTURE ? k : 2;
        if (b.pop > RUPTURE + RESPAWN) {
          spawn(b, false);
          seeds[i] = b.seed;
          pops[i * 4 + 3] = -1;
          geometry.attributes.aSeed.needsUpdate = true;
        }
      } else {
        // Air stirred by a moving pointer pushes nearby bubbles along; a
        // still pointer leaves them be, so they are easy to catch.
        if (air && air.active) {
          offset.set(b.pos.x - air.world.x, b.pos.y - air.world.y, 0);
          const reach = b.radius + 1.6;
          const falloff = Math.exp(-offset.lengthSq() / (reach * reach));
          b.wind.addScaledVector(air.vel, falloff * dt * 2.2);
        }
        b.wind.x += tilt * 1.4 * drift;
        b.wind.multiplyScalar(Math.exp(-dt * 1.5));
        if (b.wind.lengthSq() > 9) b.wind.setLength(3);
        b.pos.x += (b.vel.x + Math.sin(time * 0.8 + b.seed * 20) * 0.12 + b.wind.x) * drift;
        b.pos.y += (b.vel.y + b.wind.y) * drift;
        if (b.pos.y - b.radius > area.y + 0.5) spawn(b, false);
        if (Math.abs(b.pos.x) > area.x + b.radius + 1) b.pos.x = -Math.sign(b.pos.x) * (area.x + b.radius);
      }
      alphas[i] = b.pop >= 0 ? 1 : Math.min(Math.max(b.age / 0.9, 0), 1);
      hovers[i] = b.hover;
      const wob = Math.sin(time * 2.1 + b.seed * 40) * 0.035;
      scale *= 1 + b.hover * 0.04;
      s.set(scale * (1 + wob), scale * (1 - wob), scale * (1 + wob * 0.5));
      m.compose(b.pos, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    geometry.attributes.aAlpha.needsUpdate = true;
    geometry.attributes.aHover.needsUpdate = true;
    geometry.attributes.aPop.needsUpdate = true;

    for (let i = 0; i < DROP_POOL; i++) {
      if (dropLife[i] <= 0) continue;
      dropVel[i * 3 + 1] -= 7 * dt;
      dropPos[i * 3] += dropVel[i * 3] * dt;
      dropPos[i * 3 + 1] += dropVel[i * 3 + 1] * dt;
      dropPos[i * 3 + 2] += dropVel[i * 3 + 2] * dt;
      dropLife[i] = Math.max(0, dropLife[i] - dt * 1.5);
    }
    dropGeometry.attributes.position.needsUpdate = true;
    dropGeometry.attributes.aLife.needsUpdate = true;
  }

  // Where a bubble sits on screen, in CSS pixels.
  const projected = new Vector3();
  function onScreen(b) {
    projected.copy(b.pos).project(camera);
    const depth = camera.position.z - b.pos.z;
    return {
      x: (projected.x + 1) * 0.5 * view.w,
      y: (1 - projected.y) * 0.5 * view.h,
      r: (b.radius * view.h * 0.5) / (Math.tan((camera.fov * Math.PI) / 360) * depth),
    };
  }

  // The front-most bubble under a point, allowing `pad` pixels of slack.
  function pick(x, y, pad = 0) {
    let best = -1;
    for (let i = 0; i < count; i++) {
      const b = bubbles[i];
      if (b.pop >= 0 || b.age < 0.3) continue;
      const p = onScreen(b);
      if (Math.hypot(x - p.x, y - p.y) > p.r + pad) continue;
      if (best < 0 || b.pos.z > bubbles[best].pos.z) best = i;
    }
    return best;
  }

  let hovered = -1;
  function hover(i) {
    if (hovered >= 0) bubbles[hovered].hover = 0;
    hovered = i;
    if (i >= 0) bubbles[i].hover = 1;
  }

  // Pop bubble i where it was touched. Returns its place on screen.
  function pop(i, x, y) {
    const b = bubbles[i];
    const p = onScreen(b);
    let dx = (x - p.x) / p.r;
    let dy = -(y - p.y) / p.r;
    const l = Math.hypot(dx, dy);
    if (l > 0.9) {
      dx *= 0.9 / l;
      dy *= 0.9 / l;
    }
    b.hit.set(dx, dy, Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy)));
    // Two directions across the hole, for placing droplets on its rim.
    b.u.set(0, 1, 0).cross(b.hit);
    if (b.u.lengthSq() < 1e-4) b.u.set(1, 0, 0).cross(b.hit);
    b.u.normalize();
    b.v.crossVectors(b.hit, b.u);
    b.pop = 0;
    b.shed = 0;
    b.hover = 0;
    if (hovered === i) hovered = -1;
    pops.set([b.hit.x, b.hit.y, b.hit.z, 0], i * 4);
    return p;
  }

  function setView(w, h) {
    const first = view.w === 0;
    view.w = w;
    view.h = h;
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    area.x = halfH * camera.aspect + 0.5;
    area.y = halfH + 0.5;
    size = Math.min(1, Math.max(0.62, camera.aspect * 1.3));
    // The first layout decides where the opening bubbles float.
    if (first) {
      for (const b of bubbles) {
        const age = b.age;
        spawn(b, true);
        b.age = age;
      }
      bubbles.forEach((b, i) => (seeds[i] = b.seed));
      geometry.attributes.aSeed.needsUpdate = true;
    }
  }

  return { update, pick, hover, pop, setView };
}
