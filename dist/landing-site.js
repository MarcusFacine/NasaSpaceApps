import * as THREE from 'three';
import { lunarMaterial, fbm, lunarSpace, craterField, craterList, DETAIL_GROUND } from './lunar-surface.js';

// The landing site at the scale of the lander: 800 m × 800 m around the destination, 2 m mesh.
// Base heights are the LOLA relief (bilinear, the same numbers the app uses). On top of it, and
// only for the picture: LOLA does not resolve features below ~40 m.
//  - Craters 5–150 m across are real geometry, taken from the same crater field the shader draws on
//    the globe and on the LOLA tiles (lunar-surface.js, craterField): the crater seen from orbit is the
//    crater the lander sets down beside. Ages, depths and rim sharpness vary per crater; most are
//    degraded hollows, a few are fresh bowls with raised rims and bright ejecta.
//  - Craters below 5 m, down to ~15 cm, are drawn by the material (DETAIL_GROUND), with their shadows.
//  - Rocks: a steep power law of sizes; blocks gather on the rims and ejecta of fresh craters large
//    enough to dig below the regolith (a few metres thick on the highlands), sparse cobbles elsewhere.
//    Rocks are a little brighter than mature soil, partly buried, angular or rounded.
// The pad stays flat, as on the Apollo sites (pad: false for ground with no lander, the explorer's walk). Scene units are km.
// space: lunarSpace() of the local frame (siteSpace), so the craters match the other lunar meshes.
// earthshine: earthshineUniforms() (night side). detail: false to skip the material's small craters.

// Cumulative block counts N(>D) follow D^-2.3 (Apollo/Surveyor); sizes and radii are metres.
export const GROUND_ROCKS = Object.freeze({ minimumM: 0.08, maximumM: 1.6, exponent: 2.3, backgroundCount: 3000 });
export const CLAST_CARPET = Object.freeze({ radiusM: 36, lowPowerRadiusM: 26, cellM: 6, perSquareM: 2.6, lowPowerPerSquareM: 1.15, minimumM: 0.018, maximumM: 0.32, exponent: 2.15 });

// Fracture planes truncate an irregular block; flat normals preserve facets instead of noisy blobs.
function fracturedBlock(kind, clast = false) {
  const g = clast ? new THREE.IcosahedronGeometry(1, 0) : new THREE.DodecahedronGeometry(1, 0), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    x += 0.19 * y + 0.08 * z; z -= 0.14 * y;
    y = Math.max(-0.57, Math.min(0.66 + 0.20 * x - 0.12 * z, y));
    x = Math.min(0.76 - 0.17 * y + 0.08 * z, Math.max(-0.83 + 0.11 * z, x));
    z = Math.min(0.79 + 0.13 * x, Math.max(-0.75 - 0.15 * y, z));
    p.setXYZ(i, x * (kind === 1 ? 1.2 : 1), y * (kind === 1 ? 0.48 : kind === 2 ? 0.84 : 1), z * (kind === 2 ? 0.68 : 1));
  }
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}

// A dust apron is real low relief, coloured and illuminated exactly like its surrounding regolith.
function dustFillet() {
  const positions = [], indices = [], segments = 8;
  for (let ring = 0; ring < 2; ring++) for (let j = 0; j < segments; j++) {
    const a = j / segments * Math.PI * 2, radius = (ring ? 0.58 : 1.35) * (1 + 0.08 * Math.sin(j * 2.7));
    positions.push(Math.cos(a) * radius, ring ? 0.12 : 0, Math.sin(a) * radius);
  }
  for (let j = 0; j < segments; j++) { const k = (j + 1) % segments; indices.push(j, j + segments, k, k, j + segments, k + segments); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const colors = new Float32Array(positions.length), macro = new Float32Array(positions.length);
  for (let i = 0; i < positions.length / 3; i++) { colors.set([0.56, 0.552, 0.536], i * 3); macro[i * 3 + 1] = 1; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); g.setAttribute('lunarNormal', new THREE.BufferAttribute(macro, 3));
  g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function random(seed) { let s = (seed * 2654435761) % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// Geometric octaves: cells 500 m to 31 m (craters ~5 to 150 m across); finer ones are left to the material.
const GEOMETRY_CRATERS = { coarseKm: 0.5, fineKm: 0.03125 };

export class LandingSite {
  constructor(terrain, { seed = 7, half = 0.4, step = 0.002, space = null, earthshine = null, detail = true, pad = true, lowPower = false } = {}) {
    this.terrain = terrain; this.half = half; this.step = step; this.space = space || lunarSpace(); this.seed = seed; this.pad = pad;
    const n = this.n = Math.round(2 * half / step) + 1, rnd = random(seed + 101);
    const cell = step * 1000, halfM = half * 1000, base = new Float32Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) base[r * n + c] = terrain.height(-half + c * step, -half + r * step);
    // Gentle regolith undulation (m): long, low swells, as on the Apollo 11 and 12 plains.
    const micro = this.micro = new Float32Array(n * n), albedo = new Float32Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = c * cell - halfM, z = r * cell - halfM;
      micro[r * n + c] = (fbm(x / 70 + 13.1, z / 70 - 7.7, 4, seed) - 0.5) * 0.9 + (fbm(x / 16 + 3.3, z / 16 + 9.9, 3, seed + 9) - 0.5) * 0.18 + (fbm(x / 4 + 1.1, z / 4 - 4.4, 2, seed + 5) - 0.5) * 0.06;
    }
    // Craters of the shared field, on the LOLA surface normal; faded on the pad and towards the edge,
    // where the LOLA tile and its shader craters take over. The uncratered LOLA normal is kept as an
    // attribute: the reference plane of the material's craters and of their shadows.
    const field = craterField(this.space, GEOMETRY_CRATERS), macro = new Float32Array(n * n * 3);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c, x = c * cell - halfM, z = r * cell - halfM, edge = halfM - Math.max(Math.abs(x), Math.abs(z));
      const cl = Math.max(0, c - 1), cr = Math.min(n - 1, c + 1), rl = Math.max(0, r - 1), rr = Math.min(n - 1, r + 1);
      const gx = (base[r * n + cr] - base[r * n + cl]) / ((cr - cl) * step), gz = (base[rr * n + c] - base[rl * n + c]) / ((rr - rl) * step), gl = Math.hypot(gx, 1, gz);
      macro.set([-gx / gl, 1 / gl, -gz / gl], i * 3);
      const keep = (pad ? smooth(5, 16, Math.hypot(x, z)) : 1) * smooth(0, 60, edge);
      if (keep <= 0) { micro[i] = 0; continue; }
      const s = field(x / 1000, base[i], z / 1000, -gx / gl, 1 / gl, -gz / gl);
      micro[i] = (micro[i] + s.height * 1000) * keep; albedo[i] = s.bright * keep;
    }
    // Geometry.
    const positions = new Float32Array(n * n * 3), colors = new Float32Array(n * n * 3), uvs = new Float32Array(n * n * 2);
    this.heights = new Float32Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c, x = -half + c * step, z = -half + r * step, h = base[i] + micro[i] / 1000;
      this.heights[i] = h; positions.set([x, h, z], i * 3); uvs.set([x * 1000 / 24, -z * 1000 / 24], i * 2);
      // Mature soil, mottled at tens of metres; fresh ejecta brighter (immature regolith).
      const a = (0.56 + (fbm(x * 1000 / 30 + 5, z * 1000 / 30 - 2, 3, seed + 3) - 0.5) * 0.07) * (1 + albedo[i]);
      colors.set([a, a * 0.985, a * 0.958], i * 3);
    }
    const index = new Uint32Array((n - 1) * (n - 1) * 6); let k = 0;
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const a = r * n + c, b = a + 1, d = a + n, e = d + 1; index.set([a, d, b, b, d, e], k); k += 6; }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('lunarNormal', new THREE.BufferAttribute(macro, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    // Fine regolith grain (clods, footprint-scale roughness); no stamped craterlets: the material draws them.
    this.normalMap = null;
    this.mesh = new THREE.Mesh(geometry, lunarMaterial({ grain: true, space: this.space, earthshine, detail: detail ? DETAIL_GROUND : null }));
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.group = new THREE.Group(); this.group.add(this.mesh);
    this.craters = craterList(this.space, half, { ...GEOMETRY_CRATERS, height: (x, z) => this.heightAt(x, z) });
    this.rocks = this.makeRocks(rnd, earthshine); this.group.add(this.rocks);
    if (!pad) { this.clasts = this.makeClasts(); this.group.add(this.clasts); this.updateClasts(0, 0, { lowPower }); }
    this.dust = this.makeDust(); this.group.add(this.dust);
  }
  heightAt(x, z) {
    const n = this.n, fx = (x + this.half) / this.step, fz = (z + this.half) / this.step;
    if (!this.heights || fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) return this.terrain.height(x, z);
    const c = Math.min(n - 2, Math.floor(fx)), r = Math.min(n - 2, Math.floor(fz)), u = fx - c, v = fz - r, h = this.heights;
    return (h[r * n + c] * (1 - u) + h[r * n + c + 1] * u) * (1 - v) + (h[(r + 1) * n + c] * (1 - u) + h[(r + 1) * n + c + 1] * u) * v;
  }
  makeRocks(rnd, earthshine) {
    const shapes = [0, 1, 2].map(kind => fracturedBlock(kind));
    const material = this.rockMaterial = lunarMaterial({ vertexColors: false, color: 0xffffff, grain: 'rock', space: this.space, earthshine });
    const counts = [3200, 1500, 1500], meshes = shapes.map((g, i) => { const m = new THREE.InstancedMesh(g, material, counts[i]); m.count = 0; m.castShadow = m.receiveShadow = true; return m; });
    const fillets = new THREE.InstancedMesh(dustFillet(), this.mesh.material, 1800); fillets.count = 0; fillets.castShadow = false; fillets.receiveShadow = true; fillets.userData.groundFillet = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), color = new THREE.Color(), e = new THREE.Euler();
    const place = (x, z, size) => {
      const fromPad = Math.hypot(x, z); if ((this.pad && fromPad < 9 + size) || (fromPad < 5 && size > 0.6)) return;
      if (Math.abs(x) > this.half * 970 || Math.abs(z) > this.half * 970) return;
      const kind = rnd() < 0.54 ? 0 : rnd() < 0.62 ? 1 : 2, mesh = meshes[kind]; if (mesh.count >= counts[kind]) return;
      const kx = x / 1000, kz = z / 1000, sy = 0.75 + rnd() * 0.5, half = size / 2 * sy * (kind === 1 ? 0.45 : kind === 2 ? 0.68 : 0.7);
      // Partly buried: 10 to 45 % of the height below the surface (regolith gardening buries blocks over time).
      pos.set(kx, this.heightAt(kx, kz) + half * (1 - 2 * (0.1 + rnd() * 0.35)) / 1000, kz);
      q.setFromEuler(e.set((rnd() - 0.5) * 0.7, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.7));
      s.set(size * (0.75 + rnd() * 0.5), size * sy, size * (0.75 + rnd() * 0.5)).multiplyScalar(0.0005);
      mesh.setMatrixAt(mesh.count, m.compose(pos, q, s));
      // Mature dust coats most blocks; keep albedo close to soil, without distant white pebbles.
      const g = 0.48 + rnd() * 0.13; mesh.setColorAt(mesh.count, color.setRGB(g, g * 0.985, g * 0.965)); mesh.count++;
      if (size > 0.16 && fillets.count < fillets.instanceMatrix.count) {
        const delta = 0.002, gx = (this.heightAt(kx + delta, kz) - this.heightAt(kx - delta, kz)) / (2 * delta), gz = (this.heightAt(kx, kz + delta) - this.heightAt(kx, kz - delta)) / (2 * delta);
        pos.y = this.heightAt(kx, kz) + 0.0000005;
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-gx, 1, -gz).normalize());
        s.setScalar(size * 0.0005); fillets.setMatrixAt(fillets.count++, m.compose(pos, q, s));
      }
    };
    // Blocky ejecta around fresh craters: count grows with the crater area and freshness; sizes up to
    // ~1/15 of the crater diameter for craters that reach bedrock (D > ~25 m), cobbles for smaller ones.
    for (const c of this.craters) {
      const rM = c.r * 1000, fresh = 1 - smooth(0.02, 0.2, c.age); if (fresh <= 0 || rM < 3) continue;
      const deep = smooth(10, 30, rM), count = Math.min(400, Math.round(fresh * (4 + rM * rM * (0.03 + 0.15 * deep))));
      for (let i = 0; i < count; i++) {
        const a = rnd() * Math.PI * 2, d = rM * (0.55 + Math.pow(rnd(), 2.2) * 1.9), size = Math.min(rM * 0.14, (0.08 + 0.12 * deep) * Math.pow(1 - rnd(), -1 / 2.4));
        place(c.x * 1000 + Math.cos(a) * d, c.z * 1000 + Math.sin(a) * d, size);
      }
    }
    // Background: scattered cobbles and a few blocks (cumulative N(>D) ∝ D^-2.3 above 8 cm, after the
    // Surveyor and Apollo counts, Cintala & McBride 1995), denser close to the lander where the camera looks.
    for (let i = 0; i < GROUND_ROCKS.backgroundCount; i++) {
      const near = rnd() < 0.6, a = rnd() * Math.PI * 2, d = near ? 10 + Math.pow(rnd(), 0.9) * 150 : rnd() * this.half * 1400;
      place(Math.cos(a) * d, Math.sin(a) * d, Math.min(GROUND_ROCKS.maximumM, GROUND_ROCKS.minimumM * Math.pow(Math.max(1e-6, 1 - rnd()), -1 / GROUND_ROCKS.exponent)));
    }
    const group = new THREE.Group();
    for (const mesh of meshes) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; group.add(mesh); }
    fillets.instanceMatrix.needsUpdate = true; fillets.computeBoundingSphere(); group.add(fillets);
    group.userData.meshes = meshes; group.userData.fillets = fillets; return group;
  }
  makeClasts() {
    const group = new THREE.Group(), meshes = [0, 1, 2].map(i => {
      const mesh = new THREE.InstancedMesh(fracturedBlock(i, true), this.rockMaterial, 6000);
      mesh.count = 0; mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(mesh); return mesh;
    });
    const fillets = new THREE.InstancedMesh(dustFillet(), this.mesh.material, 1600);
    fillets.count = 0; fillets.castShadow = false; fillets.receiveShadow = true; fillets.userData.groundFillet = true; fillets.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(fillets);
    group.userData.meshes = meshes; group.userData.fillets = fillets; return group;
  }
  // Deterministic 6 m cells: stones stay fixed underfoot, and only the outer carpet changes on crossing a cell.
  // Return true so the caller can invalidate its small-caster shadow map once, rather than every frame.
  updateClasts(x, z, { lowPower = false } = {}) {
    if (!this.clasts) return false;
    const cfg = CLAST_CARPET, cx = Math.floor(x * 1000 / cfg.cellM), cz = Math.floor(z * 1000 / cfg.cellM), key = `${cx}:${cz}:${lowPower}`;
    if (key === this.clastCell) return false; this.clastCell = key;
    const radius = lowPower ? cfg.lowPowerRadiusM : cfg.radiusM, density = lowPower ? cfg.lowPowerPerSquareM : cfg.perSquareM;
    const meshes = this.clasts.userData.meshes, fillets = this.clasts.userData.fillets, span = Math.ceil(radius / cfg.cellM) + 1;
    for (const mesh of meshes) mesh.count = 0; fillets.count = 0;
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(), up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3();
    const cache = this.clastCache || (this.clastCache = new Map()), centerX = (cx + 0.5) * cfg.cellM, centerZ = (cz + 0.5) * cfg.cellM;
    let minHeight = Infinity, maxHeight = -Infinity;
    for (let iz = cz - span; iz <= cz + span; iz++) for (let ix = cx - span; ix <= cx + span; ix++) {
      const cellKey = `${ix}:${iz}:${lowPower}`; let cell = cache.get(cellKey);
      if (!cell) {
        const rnd = random(((Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ this.seed) >>> 0) + 1);
        const count = Math.round(cfg.cellM * cfg.cellM * density), records = new Float32Array(count * 24), collars = new Float32Array(count * 16);
        for (let j = 0; j < count; j++) {
          const px = (ix + rnd()) * cfg.cellM, pz = (iz + rnd()) * cfg.cellM;
          const size = Math.min(cfg.maximumM, cfg.minimumM * Math.pow(Math.max(1e-6, 1 - rnd()), -1 / cfg.exponent)), kind = Math.floor(rnd() * 3);
          const yaw = rnd() * Math.PI * 2, tiltX = (rnd() - 0.5) * 0.7, tiltZ = (rnd() - 0.5) * 0.7, stretch = 0.7 + rnd() * 0.7, shade = 0.47 + rnd() * 0.13;
          const kx = px / 1000, kz = pz / 1000, height = this.heightAt(kx, kz), offset = j * 24;
          position.set(kx, height + size * 0.00010, kz); scale.set(size * 0.0005, size * 0.0005 * stretch, size * 0.0005);
          quaternion.setFromEuler(euler.set(tiltX, yaw, tiltZ)); matrix.compose(position, quaternion, scale);
          records.set([px, pz, kind, size], offset); records.set(matrix.elements, offset + 4); records.set([shade, shade * 0.985, shade * 0.965], offset + 20);
          if (size > 0.075) {
            const delta = 0.002, gx = (this.heightAt(kx + delta, kz) - this.heightAt(kx - delta, kz)) / (2 * delta), gz = (this.heightAt(kx, kz + delta) - this.heightAt(kx, kz - delta)) / (2 * delta);
            quaternion.setFromUnitVectors(up, normal.set(-gx, 1, -gz).normalize()); position.y = height + 0.0000005; scale.setScalar(size * 0.0005);
            matrix.compose(position, quaternion, scale); collars.set(matrix.elements, j * 16); records[offset + 23] = 1;
          }
        }
        cell = { records, collars }; cache.set(cellKey, cell);
      } else { cache.delete(cellKey); cache.set(cellKey, cell); }
      const data = cell.records;
      for (let j = 0; j < data.length; j += 24) {
        const px = data[j], pz = data[j + 1], mesh = meshes[data[j + 2]];
        if ((px - centerX) ** 2 + (pz - centerZ) ** 2 > radius * radius || (this.pad && Math.hypot(px, pz) < 7) || mesh.count >= mesh.instanceMatrix.count) continue;
        mesh.instanceMatrix.array.set(data.subarray(j + 4, j + 20), mesh.count * 16);
        if (!mesh.instanceColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
        mesh.instanceColor.array.set(data.subarray(j + 20, j + 23), mesh.count++ * 3);
        minHeight = Math.min(minHeight, data[j + 17]); maxHeight = Math.max(maxHeight, data[j + 17]);
        if (data[j + 23] && fillets.count < fillets.instanceMatrix.count) {
          fillets.instanceMatrix.array.set(cell.collars.subarray(j / 24 * 16, j / 24 * 16 + 16), fillets.count++ * 16);
        }
      }
    }
    // Bounded LRU and an analytic bound avoid re-querying terrain and transforming 10,000 bounds on each step.
    while (cache.size > 400) cache.delete(cache.keys().next().value);
    const middle = Number.isFinite(minHeight) ? (minHeight + maxHeight) * 0.5 : this.heightAt(x, z), vertical = Number.isFinite(minHeight) ? (maxHeight - minHeight) * 0.5 : 0;
    for (const mesh of [...meshes, fillets]) {
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(centerX / 1000, middle, centerZ / 1000), Math.hypot(radius / 1000, vertical) + cfg.maximumM / 1000);
    }
    return true;
  }
  makeDust() {
    // Engine-blown regolith, as in the Apollo 16 mm landing films: not lines on the ground but a thin, translucent sheet
    // of dust racing outward a few decimetres above it, made of fine radial fibres, that veils and smears the surface
    // more and more as the engine comes down (from ~30 m), and stops at shutdown. A ring 3-75 m around the lander,
    // following the relief; the shader moves the fibres outward at ~40 m/s and fades the sheet with distance.
    const rings = 10, segments = 96, inner = 0.003, outer = 0.075, positions = [], index = [];
    for (let i = 0; i <= rings; i++) for (let j = 0; j <= segments; j++) {
      const r = inner * Math.pow(outer / inner, i / rings), a = j / segments * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      positions.push(x, this.heightAt(x, z) + 0.0003, z);
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segments; j++) { const k = i * (segments + 1) + j; index.push(k, k + segments + 1, k + 1, k + 1, k + segments + 1, k + segments + 2); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(index);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uLevel: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0.30, 0.29, 0.275) } },
      vertexShader: 'varying vec3 vLocal;void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `uniform float uLevel,uTime;uniform vec3 uColor;varying vec3 vLocal;
        float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
        void main(){
          float r=length(vLocal.xz)*1000.,a=atan(vLocal.z,vLocal.x);
          // Fibres: fine in angle (about 700 around), long and moving outward along the radius.
          float s=n(vec2(a*110.,r*.08-uTime*3.2))*.6+n(vec2(a*260.,r*.15-uTime*5.))*.4;
          float sheet=(1.-smoothstep(18.,75.,r))*smoothstep(3.,8.,r);
          float alpha=uLevel*sheet*(.18+.32*s);
          gl_FragColor=vec4(uColor*(.85+.3*s),alpha);
        }`
    });
    const mesh = new THREE.Mesh(geometry, material); mesh.renderOrder = 2; mesh.frustumCulled = false; mesh.visible = false; return mesh;
  }
  // level 0..1 (engine near the ground), time in seconds.
  updateDust(level, time) {
    const dust = this.dust; dust.visible = level > 0.02; if (!dust.visible) return;
    dust.material.uniforms.uLevel.value = Math.min(1, level * 1.3); dust.material.uniforms.uTime.value = time;
  }
  dispose() {
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.normalMap?.dispose();
    for (const group of [this.rocks, this.clasts].filter(Boolean)) {
      for (const mesh of group.userData.meshes) mesh.geometry.dispose(); group.userData.fillets.geometry.dispose();
    }
    this.rockMaterial.dispose(); this.clastCache?.clear();
    this.dust.geometry.dispose(); this.dust.material.dispose();
  }
}
