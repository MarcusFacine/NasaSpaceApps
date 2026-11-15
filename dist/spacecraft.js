import * as THREE from 'three';

// Apollo-era hardware, built from published dimensions (metres) and shown at true scale in the
// lunar and ocean scenes. Shapes are simplified; proportions, colours and the order of the stages
// follow the Saturn V / CSM / LM of the 1969–1972 missions. Visual only: no number depends on it.
// One scene unit is 1 km, so every model is wrapped in a group scaled by 0.001.

const Y = new THREE.Vector3(0, 1, 0);
const v2 = (x, y) => new THREE.Vector2(x, y);

function noise2(seed) {
  const h = (x, y) => { let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  return (x, y, p) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, w = k => ((k % p) + p) % p;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const a = h(w(xi), w(yi)), b = h(w(xi + 1), w(yi)), c = h(w(xi), w(yi + 1)), d = h(w(xi + 1), w(yi + 1));
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// Crumpled Kapton/Mylar foil: sharp creases from |noise − ½| at several scales.
function foilNormalMap(size = 256) {
  const n = noise2(5), h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, a = 1;
    for (let o = 0; o < 4; o++) { const p = 6 << o; v += a * Math.abs(n(x / size * p, y / size * p, p) - 0.5); a *= 0.55; }
    h[y * size + x] = v;
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + (x + size - 1) % size], r = h[y * size + (x + 1) % size], u = h[((y + size - 1) % size) * size + x], d = h[((y + 1) % size) * size + x];
    const nx = (l - r) * 9, ny = (u - d) * 9, len = Math.hypot(nx, ny, 1), i = (y * size + x) * 4;
    data[i] = (nx / len * 0.5 + 0.5) * 255; data[i + 1] = (ny / len * 0.5 + 0.5) * 255; data[i + 2] = (1 / len * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
  return t;
}

function canvasTexture(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// Environment for metal: what a spacecraft reflects. Near the Moon: grey regolith below, black sky above.
export function makeEnvironment(renderer, { sky = [0, 0, 0], ground = [0.34, 0.33, 0.31], horizon = null } = {}) {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uSky: { value: new THREE.Color(...sky) }, uGround: { value: new THREE.Color(...ground) }, uHorizon: { value: new THREE.Color(...(horizon || ground)) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform vec3 uSky, uGround, uHorizon; varying vec3 vDir; void main(){ float y = vDir.y; vec3 c = y > 0. ? mix(uHorizon, uSky, smoothstep(0., .35, y)) : mix(uHorizon, uGround, smoothstep(0., -.12, y)); gl_FragColor = vec4(c, 1.); }'
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), material));
  // A small bright patch where the Sun would be keeps highlights alive on polished surfaces.
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.8, 5.4) }));
  sun.position.set(6, 3, 5); scene.add(sun);
  const pmrem = new THREE.PMREMGenerator(renderer), target = pmrem.fromScene(scene, 0.02);
  pmrem.dispose(); material.dispose(); return target;
}

export function createMaterials(envMap) {
  const foil = foilNormalMap();
  const std = (o) => new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 1, ...o });
  const quadrants = canvasTexture(256, 64, (g, w, h) => { g.fillStyle = '#f1f0ea'; g.fillRect(0, 0, w, h); g.fillStyle = '#121214'; g.fillRect(0, 0, w / 4, h); g.fillRect(w / 2, 0, w / 4, h); });
  const gores = canvasTexture(512, 64, (g, w, h) => { const n = 24; for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#f3efe6' : '#e2672b'; g.fillRect(i * w / n, 0, w / n + 1, h); } g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, h * 0.82, w, h * 0.06); });
  const m = {
    mirror: std({ color: 0xe4e7ea, metalness: 1, roughness: 0.16 }),
    aluminium: std({ color: 0xc8ccd0, metalness: 0.75, roughness: 0.36 }),
    radiator: std({ color: 0xe9ebec, metalness: 0.35, roughness: 0.42 }),
    white: std({ color: 0xf0efe9, metalness: 0, roughness: 0.55 }),
    black: std({ color: 0x141416, metalness: 0.1, roughness: 0.62 }),
    quadrants: std({ map: quadrants, metalness: 0, roughness: 0.55 }),
    bell: std({ color: 0x3b3d42, metalness: 0.85, roughness: 0.42, side: THREE.DoubleSide }),
    bellBand: std({ color: 0x8d9095, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }),
    gold: std({ color: 0xd7a042, metalness: 1, roughness: 0.3, normalMap: foil, normalScale: new THREE.Vector2(0.9, 0.9) }),
    amber: std({ color: 0xa8742a, metalness: 1, roughness: 0.38, normalMap: foil, normalScale: new THREE.Vector2(0.7, 0.7) }),
    silverFoil: std({ color: 0xc9cacb, metalness: 1, roughness: 0.26, normalMap: foil, normalScale: new THREE.Vector2(0.8, 0.8) }),
    charcoal: std({ color: 0x2b2b2d, metalness: 0.45, roughness: 0.5 }),
    greyPanel: std({ color: 0x8f8f8b, metalness: 0.6, roughness: 0.42 }),
    glass: std({ color: 0x0b1216, metalness: 0.3, roughness: 0.04 }),
    heatShield: std({ color: 0x5e412a, metalness: 0.05, roughness: 0.85 }),
    red: std({ color: 0x8e2c20, metalness: 0.1, roughness: 0.6 }),
    chute: new THREE.MeshStandardMaterial({ map: gores, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 }),
    line: new THREE.LineBasicMaterial({ color: 0xdedad0, transparent: true, opacity: 0.55 }),
  };
  m.dispose = () => { foil.dispose(); quadrants.dispose(); gores.dispose(); for (const x of Object.values(m)) if (x?.isMaterial) x.dispose(); };
  m.setEnvironment = map => { for (const x of Object.values(m)) if (x?.isMeshStandardMaterial && x !== m.chute) x.envMap = map; };
  return m;
}

function add(parent, geometry, material, position, rotation) {
  const mesh = new THREE.Mesh(geometry, material); if (position) mesh.position.set(...position); if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
const cyl = (rt, rb, h, s = 40, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
// Rocket-engine bell: throat at y = 0, exit at y = −length.
function bellGeometry(throat, exit, length, segments = 40) {
  const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(v2(throat + (exit - throat) * Math.pow(t, 0.62), -length * t)); }
  return new THREE.LatheGeometry(pts, segments);
}
function strut(parent, a, b, radius, material) {
  const d = b.clone().sub(a), mesh = add(parent, cyl(radius, radius, d.length(), 10), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(Y, d.normalize()); return mesh;
}
// Four-thruster RCS quad facing outward along +x of its own frame.
function rcsQuad(parent, m, position, yaw) {
  const g = new THREE.Group(); g.position.set(...position); g.rotation.y = yaw; parent.add(g);
  add(g, new THREE.BoxGeometry(0.24, 0.5, 0.36), m.greyPanel);
  for (const [dx, dy, dz, rx, rz] of [[0, 0.33, 0, 0, 0], [0, -0.33, 0, Math.PI, 0], [0, 0, 0.26, Math.PI / 2, 0], [0, 0, -0.26, -Math.PI / 2, 0]]) add(g, cyl(0.03, 0.07, 0.16, 12), m.bell, [dx, dy, dz], [rx, 0, rz]);
  return g;
}

let glowTexture = null;
function radialGlow() {
  return glowTexture || (glowTexture = canvasTexture(128, 128, (c, w, h) => { const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,.55)'); g.addColorStop(0.5, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); }));
}
// Exhaust: bright for the first stage in air, faint for engines in vacuum.
function plume(length, radius, color, opacity) {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  const outer = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 32, 1, true), material);
  outer.rotation.x = Math.PI; outer.position.y = -length / 2; outer.userData.base = opacity;
  const g = new THREE.Group(); g.add(outer);
  const core = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.45, length * 0.45, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: Math.min(1, opacity * 1.6), depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  core.rotation.x = Math.PI; core.position.y = -length * 0.225; core.userData.base = core.material.opacity; g.add(core);
  // Glow at the nozzle: what a camera sees of a burning engine.
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialGlow(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: Math.min(1, opacity * 2.4) }));
  glow.scale.setScalar(radius * 7); glow.position.y = -radius * 0.6; glow.userData.base = glow.material.opacity; glow.userData.glow = true; g.add(glow);
  g.visible = false; return g;
}

// ---- Command and Service Module (CM apex at +Y) ----
function buildCM(m, { shield = true, boostCover = false } = {}) {
  const g = new THREE.Group();
  const r = 1.955, h = 3.23;
  add(g, cyl(0.42, r, h, 64), boostCover ? m.white : m.mirror, [0, h / 2, 0]);
  add(g, cyl(0.42, 0.42, 0.12, 32), m.aluminium, [0, h + 0.06, 0]);
  add(g, cyl(0.06, 0.12, 0.62, 12), m.aluminium, [0, h + 0.42, 0]);
  if (!boostCover) {
    for (const a of [-0.5, 0.5]) add(g, new THREE.BoxGeometry(0.26, 0.3, 0.04), m.glass, [Math.sin(a) * 1.35, 1.75, Math.cos(a) * 1.35], [-0.58, a, 0]);
    add(g, new THREE.BoxGeometry(0.62, 0.56, 0.04), m.charcoal, [0, 1.25, 1.55], [-0.58, 0, 0]);
  }
  // Heat shield: shallow spherical cap under the base.
  if (shield) { const cap = add(g, new THREE.SphereGeometry(4.69, 64, 8, 0, Math.PI * 2, Math.PI - 0.432, 0.432), m.heatShield, [0, 4.69 - 0.42, 0]); cap.userData.shield = true; }
  return g;
}
export function buildSM(m) {
  const g = new THREE.Group(), r = 1.955, h = 4.1;
  add(g, cyl(r, r, h, 64), m.aluminium, [0, -h / 2, 0]);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; add(g, new THREE.BoxGeometry(0.9, 2.6, 0.03), m.radiator, [Math.sin(a) * (r + 0.01), -2.4, Math.cos(a) * (r + 0.01)], [0, a, 0]); }
  add(g, cyl(r, 1.25, 0.5, 64), m.aluminium, [0, -h - 0.25, 0]);
  const bell = add(g, bellGeometry(0.36, 1.25, 2.85), m.bell, [0, -h - 0.45, 0]);
  add(g, bellGeometry(1.0, 1.26, 0.35), m.bellBand, [0, -h - 2.95, 0]);
  for (let i = 0; i < 4; i++) rcsQuad(g, m, [Math.sin(i * Math.PI / 2 + Math.PI / 4) * (r + 0.13), -0.9, Math.cos(i * Math.PI / 2 + Math.PI / 4) * (r + 0.13)], i * Math.PI / 2 + Math.PI / 4 - Math.PI / 2);
  // High-gain antenna: four dishes on a boom off the aft bulkhead.
  const boom = new THREE.Group(); boom.position.set(0, -h + 0.2, -r); boom.rotation.x = -0.9; g.add(boom);
  add(boom, cyl(0.05, 0.05, 2.6, 8), m.aluminium, [0, -1.3, 0]);
  for (const [x, y] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) add(boom, new THREE.SphereGeometry(0.4, 20, 6, 0, Math.PI * 2, 0, 0.7), m.white, [x, -2.6 + y * 0.2, y], [Math.PI / 2, 0, 0]);
  const engine = plume(9, 1.4, 0xffc58a, 0.22); engine.position.y = -h - 3.3; g.add(engine);
  g.userData.plume = engine; g.userData.bell = bell; return g;
}
// CSM with the CM apex at +3.2 m and the SM below the origin.
function buildCSM(m) { const g = new THREE.Group(), cm = buildCM(m, { shield: false }), sm = buildSM(m); g.add(cm, sm); g.userData.plume = sm.userData.plume; return g; }

// ---- Lunar Module ----
export function buildDescentStage(m) {
  const g = new THREE.Group(), y0 = 1.5, hh = 1.65;
  const oct = new THREE.Shape(); const R = 2.28;
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8, p = [Math.cos(a) * R, Math.sin(a) * R]; i ? oct.lineTo(...p) : oct.moveTo(...p); }
  const body = add(g, new THREE.ExtrudeGeometry(oct, { depth: hh, bevelEnabled: false }), m.gold, [0, y0 + hh, 0], [Math.PI / 2, 0, 0]);
  body.material = [m.amber, m.gold];
  add(g, new THREE.BoxGeometry(4.0, 0.06, 4.0), m.black, [0, y0 - 0.02, 0]);
  add(g, bellGeometry(0.4, 0.78, 1.0), m.bell, [0, y0, 0]);
  // Four legs: primary strut, two secondary struts, footpad and (on three legs) the contact probe.
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const pad = dir.clone().multiplyScalar(4.25).setY(0.22), top = dir.clone().multiplyScalar(2.0).setY(y0 + hh - 0.3);
    strut(g, top, pad.clone().setY(0.42), 0.085, m.silverFoil);
    for (const s of [-1, 1]) strut(g, pad.clone().setY(0.62).addScaledVector(dir, -0.12), dir.clone().multiplyScalar(1.85).addScaledVector(side, s * 1.0).setY(y0 + 0.05), 0.045, m.aluminium);
    add(g, cyl(0.47, 0.42, 0.2, 28), m.silverFoil, [pad.x, 0.1, pad.z]);
    if (i !== 0) strut(g, pad.clone().setY(0.2), pad.clone().addScaledVector(dir, 0.35).setY(-1.45), 0.012, m.aluminium);
  }
  // Porch and ladder on the forward (+Z) leg.
  add(g, new THREE.BoxGeometry(0.9, 0.05, 0.7), m.aluminium, [0, y0 + hh + 0.02, 2.45]);
  for (let k = 0; k < 9; k++) add(g, cyl(0.02, 0.02, 0.5, 6), m.aluminium, [0, y0 + hh - 0.25 - k * 0.3, 2.55 + k * 0.2], [0, 0, Math.PI / 2]);
  const dust = new THREE.Group(); g.add(dust);
  const engine = plume(5, 0.75, 0xffd9a8, 0.12); engine.position.y = y0 - 1.0; g.add(engine);
  g.userData.plume = engine; g.userData.height = y0 + hh;
  return g;
}
export function buildAscentStage(m) {
  const g = new THREE.Group();
  // Cabin: faceted prism seen from the front.
  const s = new THREE.Shape(); [[-1.15, 0], [1.15, 0], [1.4, 0.55], [1.4, 1.7], [1.0, 2.35], [-1.0, 2.35], [-1.4, 1.7], [-1.4, 0.55]].forEach((p, i) => i ? s.lineTo(...p) : s.moveTo(...p));
  const cabin = add(g, new THREE.ExtrudeGeometry(s, { depth: 2.0, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 }), m.greyPanel, [0, 0.15, -1.0]);
  cabin.material = [m.greyPanel, m.greyPanel];
  for (const sx of [-1, 1]) add(g, new THREE.BoxGeometry(0.04, 1.1, 1.5), m.charcoal, [1.43 * sx, 1.55, 0.05]);
  add(g, new THREE.BoxGeometry(1.9, 0.5, 0.04), m.silverFoil, [0, 2.25, 1.08]);
  // Front face: triangular windows and the forward hatch.
  for (const sx of [-1, 1]) { const tri = new THREE.Shape(); tri.moveTo(0, 0); tri.lineTo(0.66 * sx, 0); tri.lineTo(0.1 * sx, 0.56); tri.lineTo(0, 0); const w = add(g, new THREE.ShapeGeometry(tri), m.glass, [0.14 * sx, 1.5, 1.075]); w.material = m.glass; }
  add(g, new THREE.BoxGeometry(0.82, 0.82, 0.05), m.charcoal, [0, 0.68, 1.08]);
  add(g, new THREE.BoxGeometry(2.6, 0.3, 0.05), m.silverFoil, [0, 0.2, 1.08]);
  // Propellant-tank bulges on both sides and the aft equipment bay.
  for (const sx of [-1, 1]) { const tank = add(g, new THREE.CapsuleGeometry(0.62, 0.7, 6, 24), sx < 0 ? m.silverFoil : m.charcoal, [1.55 * sx, 1.05, -0.35], [Math.PI / 2, 0, 0]); tank.scale.set(1, 1, 0.92); }
  add(g, new THREE.BoxGeometry(2.3, 1.55, 0.85), m.charcoal, [0, 1.35, -1.45]);
  add(g, new THREE.BoxGeometry(2.0, 0.08, 0.7), m.white, [0, 2.15, -1.45]);
  // Docking tunnel, rendezvous radar, S-band antenna and VHF whips.
  add(g, cyl(0.42, 0.45, 0.45, 32), m.silverFoil, [0, 2.75, 0]);
  add(g, cyl(0.12, 0.42, 0.2, 24), m.charcoal, [0, 3.06, 0]);
  const radar = add(g, new THREE.SphereGeometry(0.31, 24, 8, 0, Math.PI * 2, 0, 0.75), m.silverFoil, [0.75, 2.75, 0.75], [-1.05, 0, 0]); radar.scale.y = 0.6;
  strut(g, new THREE.Vector3(1.25, 2.3, -0.4), new THREE.Vector3(1.75, 3.0, -0.4), 0.03, m.aluminium);
  add(g, new THREE.SphereGeometry(0.33, 24, 8, 0, Math.PI * 2, 0, 0.75), m.white, [1.8, 3.05, -0.4], [0.6, 0, -0.8]);
  for (const sx of [-1, 1]) strut(g, new THREE.Vector3(0.9 * sx, 2.4, -0.9), new THREE.Vector3(1.05 * sx, 3.5, -1.1), 0.01, m.aluminium);
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) rcsQuad(g, m, [1.62 * x, 1.95, 1.08 * z], Math.atan2(z, x) * -1);
  add(g, bellGeometry(0.2, 0.43, 0.5), m.bell, [0, 0.12, 0]);
  const engine = plume(3.5, 0.5, 0xffe2b8, 0.1); engine.position.y = -0.38; g.add(engine);
  g.userData.plume = engine;
  return g;
}
export function buildLM(m) {
  const g = new THREE.Group(), descent = buildDescentStage(m), ascent = buildAscentStage(m);
  ascent.position.y = descent.userData.height; g.add(descent, ascent);
  g.userData.plume = descent.userData.plume; g.userData.descent = descent; g.userData.ascent = ascent; return g;
}

// ---- Saturn V stack (y = 0 at the F-1 nozzle exits) ----
function buildSaturnV(m, { stage = 1 } = {}) {
  const g = new THREE.Group(); let y = 0, plumeAt = 0, plumeKind = null;
  if (stage === 1) {
    for (const [x, z] of [[0, 0], [2.7, 2.7], [-2.7, 2.7], [2.7, -2.7], [-2.7, -2.7]]) add(g, bellGeometry(0.55, 1.85, 5.8, 28), m.bell, [x, 6.0, z]);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; add(g, cyl(0.6, 1.6, 5.2, 16), m.white, [Math.sin(a) * 3.9, 5.6, Math.cos(a) * 3.9]); const fin = add(g, new THREE.BoxGeometry(0.18, 3.6, 3.0), m.white, [Math.sin(a) * 6.2, 3.4, Math.cos(a) * 6.2], [0, a, 0]); fin.scale.set(1, 1, 1); }
    add(g, cyl(5.05, 5.05, 12, 64), m.quadrants, [0, 6 + 6, 0]);
    add(g, cyl(5.05, 5.05, 30, 64), m.white, [0, 6 + 12 + 15, 0]);
    add(g, cyl(5.07, 5.07, 4.5, 64), m.quadrants, [0, 6 + 21, 0]);
    y = 48; plumeAt = 0.2; plumeKind = 'f1';
  }
  if (stage <= 2) {
    const s2 = y; add(g, cyl(5.05, 5.05, 5.5, 64), m.white, [0, s2 + 2.75, 0]);
    if (stage === 2) for (const [x, z] of [[0, 0], [1.8, 1.8], [-1.8, 1.8], [1.8, -1.8], [-1.8, -1.8]]) add(g, bellGeometry(0.3, 0.95, 3.4, 24), m.bell, [x, s2 + 3.2, z]);
    add(g, cyl(5.05, 5.05, 19.3, 64), m.white, [0, s2 + 5.5 + 9.65, 0]);
    y = s2 + 24.8; if (stage === 2) { plumeAt = s2 + 0.2; plumeKind = 'j2'; }
    add(g, cyl(3.3, 5.05, 5.6, 64), m.white, [0, y + 2.8, 0]); y += 5.6;
  }
  if (stage === 3) { add(g, bellGeometry(0.28, 1.0, 3.4, 28), m.bell, [0, y + 3.2, 0]); plumeAt = y - 0.2; plumeKind = 'j2'; y += 3.2; }
  // S-IVB with its black aft skirt, instrument unit, SLA, then CM with boost cover and LES.
  add(g, cyl(3.3, 3.3, 3.6, 64), m.quadrants, [0, y + 1.8, 0]);
  add(g, cyl(3.3, 3.3, 14.2, 64), m.white, [0, y + 3.6 + 7.1, 0]); y += 17.8;
  add(g, cyl(3.3, 3.3, 0.9, 64), m.greyPanel, [0, y + 0.45, 0]); y += 0.9;
  add(g, cyl(1.955, 3.3, 8.5, 64), m.aluminium, [0, y + 4.25, 0]); y += 8.5;
  const cm = buildCM(m, { shield: false, boostCover: stage < 3 }); cm.position.y = y; g.add(cm); y += 3.3;
  if (stage < 3) {
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; strut(g, new THREE.Vector3(Math.sin(a) * 0.55, y, Math.cos(a) * 0.55), new THREE.Vector3(Math.sin(a) * 0.22, y + 3.0, Math.cos(a) * 0.22), 0.05, m.red); }
    add(g, cyl(0.33, 0.33, 4.7, 24), m.white, [0, y + 3.0 + 2.35, 0]);
    add(g, new THREE.ConeGeometry(0.33, 1.6, 24), m.red, [0, y + 3.0 + 4.7 + 0.8, 0]);
    y += 9.3;
  }
  const kind = plumeKind === 'f1' ? plume(70, 7.5, 0xffa040, 0.55) : plume(stage === 2 ? 18 : 10, stage === 2 ? 3.5 : 1.6, 0xbfd8ff, 0.14);
  kind.position.y = plumeAt; g.add(kind); g.userData.plume = kind; g.userData.height = y;
  return g;
}

// Stages left behind: the same models, without what flies on.
export function buildSpent(m, kind) {
  if (kind === 'sm') { const g = buildSM(m); g.userData.plume.visible = false; return g; }
  if (kind === 'asc') return buildAscentStage(m);
  const stage = kind === 'sic' ? 1 : kind === 'sii' ? 2 : 3, top = kind === 'sic' ? 48 : kind === 'sii' ? 30.4 : 30.2;
  const g = buildSaturnV(m, { stage });
  for (const child of [...g.children]) if (child === g.userData.plume || child.position.y > top) g.remove(child);
  const centre = top / 2; for (const child of g.children) child.position.y -= centre;
  return g;
}
export function setLayer(object, layer) { object.traverse(o => o.layers.set(layer)); return object; }

// ---- Entry and recovery ----
function plasma() {
  const g = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.SphereGeometry(2.6, 32, 16, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), new THREE.MeshBasicMaterial({ color: 0xffb46b, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  cap.position.y = 0.6; cap.scale.set(1.15, 0.55, 1.15); g.add(cap);
  const fade = canvasTexture(8, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#000'); gr.addColorStop(0.55, '#333'); gr.addColorStop(1, '#fff'); c.fillStyle = gr; c.fillRect(0, 0, w, h); }, false);
  const wakeMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uColor: { value: new THREE.Color(1.0, 0.52, 0.26) }, opacity: { value: 0.2 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float opacity; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float core = pow(abs(dot(vN, vV)), 4.); float tail = pow(1. - vUv.y, 3.); gl_FragColor = vec4(uColor * core * tail * opacity * 2.2, 1.); }'
  });
  const wake = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 1.7, 60, 40, 1, true), wakeMaterial);
  wake.position.y = 31; g.add(wake);
  // Fireball around the heat shield: a soft additive glow, brightest at peak heating.
  const glowMap = canvasTexture(128, 128, (c, w, h) => { const gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,240,215,1)'); gr.addColorStop(0.18, 'rgba(255,190,120,.85)'); gr.addColorStop(0.45, 'rgba(255,120,60,.28)'); gr.addColorStop(1, 'rgba(255,90,40,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  glow.scale.setScalar(13); glow.position.y = -0.4; g.add(glow);
  g.userData.parts = [[cap, 0.85], [wake, 0.2], [glow, 0.95]]; g.userData.fade = fade; g.userData.glowMap = glowMap; g.visible = false; return g;
}
function buildChutes(m) {
  const g = new THREE.Group(), lines = [];
  const canopy = (radius, at) => {
    const c = add(g, new THREE.SphereGeometry(radius, 48, 12, 0, Math.PI * 2, 0, 1.05), m.chute, at); c.scale.y = 0.62;
    const rim = radius * Math.sin(1.05), rimY = at[1] + radius * Math.cos(1.05) * 0.62;
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; lines.push(at[0] + Math.cos(a) * rim, rimY, at[2] + Math.sin(a) * rim, 0, 3.6, 0); }
    return c;
  };
  const mains = [[0, 42, 0], [13, 39, 7.5], [-13, 39, 7.5]].map(p => canopy(12.7, p));
  const drogues = [[2.5, 22, 0], [-2.5, 22, 0]].map(p => canopy(2.5, p));
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const rig = new THREE.LineSegments(geo, m.line); g.add(rig);
  g.userData = { mains, drogues, rig }; return g;
}

const HEIGHT = { saturnV: 110.6, stage2: 80, sivb: 34, stack: 18, lm: 7, ascent: 3.8, csmAscent: 15, csm: 11, cm: 3.5, cmChutes: 50 };

// One vehicle that switches configuration with the mission phase.
export class Spacecraft {
  constructor(materials) {
    this.m = materials; this.group = new THREE.Group(); this.body = new THREE.Group(); this.body.scale.setScalar(0.001); this.group.add(this.body);
    const m = materials, cfg = this.configs = {};
    cfg.saturnV = buildSaturnV(m, { stage: 1 }); cfg.stage2 = buildSaturnV(m, { stage: 2 }); cfg.sivb = buildSaturnV(m, { stage: 3 });
    for (const [k, model] of [['saturnV', cfg.saturnV], ['stage2', cfg.stage2], ['sivb', cfg.sivb]]) { const h = model.userData.height; model.position.y = -h * 0.45; }
    const stack = new THREE.Group(), csm1 = buildCSM(m), lm1 = buildLM(m); stack.add(csm1); lm1.rotation.x = Math.PI; lm1.position.y = 3.6 + 6.0; stack.add(lm1); stack.position.y = -2; stack.userData.plume = csm1.userData.plume; cfg.stack = stack;
    cfg.lm = buildLM(m);
    cfg.ascent = buildAscentStage(m);
    const csmA = new THREE.Group(), csm2 = buildCSM(m), asc = buildAscentStage(m); asc.rotation.x = Math.PI; asc.position.y = 3.6 + 3.1; csmA.add(csm2, asc); csmA.userData.plume = csm2.userData.plume; cfg.csmAscent = csmA;
    cfg.csm = buildCSM(m);
    const cm = buildCM(m); cm.position.y = -1.5; const glow = plasma(); cm.add(glow); cm.userData.plasma = glow; cfg.cm = cm;
    const cmc = new THREE.Group(), cm2 = buildCM(m); cm2.rotation.z = 0.48; cmc.add(cm2); const chutes = buildChutes(m); cmc.add(chutes); cmc.userData.chutes = chutes; cfg.cmChutes = cmc;
    for (const model of Object.values(cfg)) { model.visible = false; this.body.add(model); }
    this.name = null; this.set('lm');
  }
  get height() { return HEIGHT[this.name] / 1000; }
  set(name) {
    if (name === this.name) return; if (this.name) this.configs[this.name].visible = false;
    this.name = name; this.configs[name].visible = true;
  }
  // engine: 0..1 throttle for the active configuration's plume.
  engine(level) {
    const p = this.configs[this.name].userData.plume; if (!p) return;
    p.visible = level > 0.01; p.children.forEach(c => { c.material.opacity = c.userData.base * level; });
    // A burning engine is never still: the plume length and glow flicker a little.
    const time = performance.now() / 1000, flick = 1 + 0.05 * Math.sin(time * 41) + 0.035 * Math.sin(time * 97 + 1.3);
    p.scale.set(1, (0.85 + 0.3 * level) * flick * (this.plumeLength ?? 1), 1);
  }
  plasma(level) {
    const g = this.configs.cm.userData.plasma; g.visible = level > 0.01;
    for (const [mesh, base] of g.userData.parts) { if (mesh.material.uniforms) mesh.material.uniforms.opacity.value = base * level; else mesh.material.opacity = base * level; }
    g.children[1].scale.y = 0.4 + level;
  }
  chutes(stage) {
    const c = this.configs.cmChutes.userData.chutes;
    c.userData.drogues.forEach(d => d.visible = stage === 'drogue'); c.userData.mains.forEach(d => { d.visible = stage === 'main'; d.scale.setScalar(stage === 'main' ? 1 : 0.2); d.scale.y = 0.62; });
    c.userData.rig.visible = stage === 'main';
  }
}
