// Soap bubbles: instanced spheres with a thin-film (interference) shader.
// Each bubble drifts upwards, wobbles, and can be popped into droplets.
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

const bubbleVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aAlpha;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  varying float vSeed;
  varying float vAlpha;
  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    vLocal = position;
    vSeed = aSeed;
    vAlpha = aAlpha;
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

  void main() {
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
    vec3 color = film * (0.25 + rim * 1.1) + vec3(spec);
    float alpha = clamp(0.04 + rim * 0.8 + spec, 0.0, 1.0) * vAlpha;
    gl_FragColor = vec4(color, alpha);
  }
`;

const dropVertex = /* glsl */ `
  attribute float aLife;
  uniform float uPixelRatio;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (6.0 + 10.0 * aLife) * uPixelRatio * (8.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const dropFragment = /* glsl */ `
  varying float vLife;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5 || vLife <= 0.0) discard;
    float a = smoothstep(0.5, 0.25, d) * vLife;
    gl_FragColor = vec4(vec3(1.0), a * 0.9);
  }
`;

const DROPS_PER_POP = 22;
const DROP_POOL = DROPS_PER_POP * 8;

export function createBubbles(scene, { count = 16, area = { x: 6, y: 4 }, pixelRatio = 1 } = {}) {
  const geometry = new SphereGeometry(1, 48, 32);
  const seeds = new Float32Array(count);
  const alphas = new Float32Array(count).fill(1);
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
  geometry.setAttribute('aAlpha', new InstancedBufferAttribute(alphas, 1));

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
    const b = { seed: Math.random(), pos: new Vector3(), vel: new Vector3(), radius: 1, pop: -1 };
    spawn(b, true);
    seeds[i] = b.seed;
    bubbles.push(b);
  }

  function spawn(b, anywhere) {
    b.radius = 0.18 + Math.pow(Math.random(), 1.8) * 0.75;
    b.pos.set(
      (Math.random() * 2 - 1) * area.x,
      anywhere ? (Math.random() * 2 - 1) * area.y : -area.y - b.radius - Math.random() * 2,
      (Math.random() * 2 - 1) * 1.5,
    );
    b.vel.set((Math.random() - 0.5) * 0.15, 0.18 + Math.random() * 0.25, 0);
    b.seed = Math.random();
    b.pop = -1;
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

  function burst(b) {
    for (let k = 0; k < DROPS_PER_POP; k++) {
      const i = nextDrop;
      nextDrop = (nextDrop + 1) % DROP_POOL;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const dx = Math.sin(phi) * Math.cos(theta);
      const dy = Math.sin(phi) * Math.sin(theta);
      const dz = Math.cos(phi);
      dropPos[i * 3] = b.pos.x + dx * b.radius;
      dropPos[i * 3 + 1] = b.pos.y + dy * b.radius;
      dropPos[i * 3 + 2] = b.pos.z + dz * b.radius;
      const speed = 1.2 + Math.random() * 1.8;
      dropVel[i * 3] = dx * speed;
      dropVel[i * 3 + 1] = dy * speed + 0.6;
      dropVel[i * 3 + 2] = dz * speed;
      dropLife[i] = 0.7 + Math.random() * 0.3;
    }
  }

  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const push = new Vector3();

  function update(dt, time, pointer) {
    material.uniforms.uTime.value = time;
    for (let i = 0; i < count; i++) {
      const b = bubbles[i];
      let scale = b.radius;
      if (b.pop >= 0) {
        // A pop is a quick swell and fade, then the bubble respawns below.
        b.pop += dt;
        const k = Math.min(b.pop / 0.12, 1);
        scale *= 1 + 0.25 * k;
        alphas[i] = 1 - k;
        if (b.pop > 0.6) {
          spawn(b, false);
          seeds[i] = b.seed;
          alphas[i] = 1;
          geometry.attributes.aSeed.needsUpdate = true;
        }
      } else {
        b.pos.x += (b.vel.x + Math.sin(time * 0.8 + b.seed * 20) * 0.12) * dt;
        b.pos.y += b.vel.y * dt;
        if (pointer && pointer.active) {
          push.set(b.pos.x - pointer.world.x, b.pos.y - pointer.world.y, 0);
          const d = push.length();
          const reach = b.radius + 0.9;
          if (d < reach && d > 0.0001) {
            push.multiplyScalar(((reach - d) / reach) * 2.2 * dt / d);
            b.pos.add(push);
          }
        }
        if (b.pos.y - b.radius > area.y + 0.5) spawn(b, false);
      }
      const wob = Math.sin(time * 2.1 + b.seed * 40) * 0.035;
      s.set(scale * (1 + wob), scale * (1 - wob), scale * (1 + wob * 0.5));
      m.compose(b.pos, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    geometry.attributes.aAlpha.needsUpdate = true;

    for (let i = 0; i < DROP_POOL; i++) {
      if (dropLife[i] <= 0) continue;
      dropVel[i * 3 + 1] -= 6 * dt;
      dropPos[i * 3] += dropVel[i * 3] * dt;
      dropPos[i * 3 + 1] += dropVel[i * 3 + 1] * dt;
      dropPos[i * 3 + 2] += dropVel[i * 3 + 2] * dt;
      dropLife[i] = Math.max(0, dropLife[i] - dt * 1.6);
    }
    dropGeometry.attributes.position.needsUpdate = true;
    dropGeometry.attributes.aLife.needsUpdate = true;
  }

  // Pop the nearest bubble under a ray; returns true when one popped.
  function popAt(raycaster) {
    mesh.boundingSphere = null; // instances move, so the cached bounds go stale
    const hits = raycaster.intersectObject(mesh, false);
    for (const hit of hits) {
      const b = bubbles[hit.instanceId];
      if (b && b.pop < 0) {
        b.pop = 0;
        burst(b);
        return true;
      }
    }
    return false;
  }

  function setArea(x, y) {
    area.x = x;
    area.y = y;
  }

  return { update, popAt, setArea, mesh };
}
