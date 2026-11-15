import * as THREE from 'three';
import { lunarMaterial, regolithNormalMap, fbm, lunarSpace, craterField, craterList, DETAIL_GROUND } from './lunar-surface.js';

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
// The pad stays flat, as on the Apollo sites. Scene units are km.
// space: lunarSpace() of the local frame (siteSpace), so the craters match the other lunar meshes.
// earthshine: earthshineUniforms() (night side). detail: false to skip the material's small craters.

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function random(seed) { let s = (seed * 2654435761) % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// Geometric octaves: cells 500 m to 31 m (craters ~5 to 150 m across); finer ones are left to the material.
const GEOMETRY_CRATERS = { coarseKm: 0.5, fineKm: 0.03125 };

export class LandingSite {
  constructor(terrain, { seed = 7, half = 0.4, step = 0.002, space = null, earthshine = null, detail = true } = {}) {
    this.terrain = terrain; this.half = half; this.step = step; this.space = space || lunarSpace();
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
      const keep = smooth(5, 16, Math.hypot(x, z)) * smooth(0, 60, edge);
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
    this.normalMap = regolithNormalMap(512, seed + 23, { craters: 0 });
    this.mesh = new THREE.Mesh(geometry, lunarMaterial({ normalMap: this.normalMap, normalScale: detail ? 0.45 : 0.35, space: this.space, earthshine, detail: detail ? DETAIL_GROUND : null }));
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.group = new THREE.Group(); this.group.add(this.mesh);
    this.craters = craterList(this.space, half, { ...GEOMETRY_CRATERS, height: (x, z) => this.heightAt(x, z) });
    this.rocks = this.makeRocks(rnd, earthshine); this.group.add(this.rocks);
    this.dust = this.makeDust(rnd); this.group.add(this.dust);
  }
  heightAt(x, z) {
    const n = this.n, fx = (x + this.half) / this.step, fz = (z + this.half) / this.step;
    if (!this.heights || fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) return this.terrain.height(x, z);
    const c = Math.min(n - 2, Math.floor(fx)), r = Math.min(n - 2, Math.floor(fz)), u = fx - c, v = fz - r, h = this.heights;
    return (h[r * n + c] * (1 - u) + h[r * n + c + 1] * u) * (1 - v) + (h[(r + 1) * n + c] * (1 - u) + h[(r + 1) * n + c + 1] * u) * v;
  }
  makeRocks(rnd, earthshine) {
    // Three rock shapes, instanced: angular (faceted, the commonest), blocky slabs and rounded, dust-worn ones.
    const shape = (detail, jitter, squash, flat, s) => {
      const g = new THREE.IcosahedronGeometry(1, detail); const p = g.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 0.78 + jitter * fbm(v.x * 1.7 + s, v.y * 1.7 + v.z * 1.3 - s, 3, 17 + s); v.multiplyScalar(k); v.y *= squash; p.setXYZ(i, v.x, v.y, v.z); }
      g.computeVertexNormals();   // the icosahedron is non-indexed: face normals, a faceted block
      // Rounded, dust-worn stones: smooth normals from the (squashed) ellipsoid instead.
      if (!flat) { const nrm = g.attributes.normal; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).multiply(new THREE.Vector3(1, 1 / (squash * squash), 1)).normalize(); nrm.setXYZ(i, v.x, v.y, v.z); } }
      return g;
    };
    const shapes = [shape(1, 0.55, 0.7, true, 1), shape(1, 0.4, 0.45, true, 7), shape(2, 0.32, 0.68, false, 13)];
    const material = lunarMaterial({ vertexColors: false, color: 0xffffff, space: this.space, earthshine });
    const counts = [4200, 1100, 1300], meshes = shapes.map((g, i) => { const m = new THREE.InstancedMesh(g, material, counts[i]); m.count = 0; m.castShadow = m.receiveShadow = true; return m; });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), color = new THREE.Color(), e = new THREE.Euler();
    const place = (x, z, size) => {
      const fromPad = Math.hypot(x, z); if (fromPad < 9 + size || (fromPad < 35 && size > 0.6)) return;
      if (Math.abs(x) > this.half * 970 || Math.abs(z) > this.half * 970) return;
      const kind = rnd() < 0.62 ? 0 : rnd() < 0.45 ? 1 : 2, mesh = meshes[kind]; if (mesh.count >= counts[kind]) return;
      const kx = x / 1000, kz = z / 1000, sy = 0.75 + rnd() * 0.5, half = size / 2 * sy * (kind === 1 ? 0.45 : kind === 2 ? 0.68 : 0.7);
      // Partly buried: 10 to 45 % of the height below the surface (regolith gardening buries blocks over time).
      pos.set(kx, this.heightAt(kx, kz) + half * (1 - 2 * (0.1 + rnd() * 0.35)) / 1000, kz);
      q.setFromEuler(e.set((rnd() - 0.5) * 0.7, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.7));
      s.set(size * (0.75 + rnd() * 0.5), size * sy, size * (0.75 + rnd() * 0.5)).multiplyScalar(0.0005);
      mesh.setMatrixAt(mesh.count, m.compose(pos, q, s));
      // Rock: fresher, less dusty than the soil around it (linear albedo factor ×1.0–1.5 of mature soil).
      const g = 0.56 * (1 + rnd() * 0.5); mesh.setColorAt(mesh.count, color.setRGB(g, g * 0.985, g * 0.965)); mesh.count++;
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
    // Background: scattered cobbles and a few blocks (cumulative N(>D) ∝ D^-2.3 above 6 cm, after the
    // Surveyor and Apollo counts, Cintala & McBride 1995), denser close to the lander where the camera looks.
    for (let i = 0; i < 4200; i++) {
      const near = rnd() < 0.6, a = rnd() * Math.PI * 2, d = near ? 10 + Math.pow(rnd(), 0.9) * 150 : rnd() * this.half * 1400;
      place(Math.cos(a) * d, Math.sin(a) * d, Math.min(1.6, 0.06 * Math.pow(1 - rnd(), -1 / 2.3)));
    }
    const group = new THREE.Group();
    for (const mesh of meshes) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; group.add(mesh); }
    group.userData.meshes = meshes; return group;
  }
  makeDust(rnd) {
    // Engine-blown regolith: thin radial streaks racing outward close to the ground (Apollo 16 mm films).
    const count = 3200, data = new Float32Array(count * 4), positions = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) data.set([rnd() * Math.PI * 2, rnd(), 0.7 + rnd() * 0.7, rnd()], i * 4);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xd9d3c7, transparent: true, opacity: 0, depthWrite: false }));
    lines.frustumCulled = false; lines.userData.data = data; lines.visible = false; return lines;
  }
  // level 0..1 (engine near the ground), time in seconds.
  updateDust(level, time) {
    const dust = this.dust; dust.visible = level > 0.02; if (!dust.visible) return;
    const data = dust.userData.data, p = dust.geometry.attributes.position, max = 0.06, n = p.count / 2;
    for (let i = 0; i < n; i++) {
      const a = data[i * 4], r0 = data[i * 4 + 1], speed = data[i * 4 + 2], h = data[i * 4 + 3];
      const r = 0.004 + ((r0 + time * speed * 0.55) % 1) * max, len = 0.0008 + 0.0022 * speed;
      const x0 = Math.cos(a) * r, z0 = Math.sin(a) * r, x1 = Math.cos(a) * (r + len), z1 = Math.sin(a) * (r + len), lift = 0.00015 + h * 0.0009 * (1 - r / max);
      p.setXYZ(i * 2, x0, this.heightAt(x0, z0) + lift, z0); p.setXYZ(i * 2 + 1, x1, this.heightAt(x1, z1) + lift * 0.8, z1);
    }
    p.needsUpdate = true; dust.material.opacity = 0.2 * level;
  }
  dispose() {
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.normalMap.dispose();
    for (const mesh of this.rocks.userData.meshes) mesh.geometry.dispose(); this.rocks.userData.meshes[0].material.dispose();
    this.dust.geometry.dispose(); this.dust.material.dispose();
  }
}
