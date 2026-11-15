import * as THREE from 'three';
import { lunarMaterial, regolithNormalMap, fbm } from './lunar-surface.js';

// The landing site at the scale of the lander: 800 m × 800 m around the destination, 2 m mesh.
// Base heights are the LOLA relief (bilinear, the same numbers the app uses). On top of it, and
// only for the picture, a synthetic small-crater population, gentle regolith undulation and
// boulders: LOLA does not resolve features below ~40 m. The pad stays flat, as on the Apollo sites.
// Scene units are km.

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function random(seed) { let s = (seed * 2654435761) % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export class LandingSite {
  constructor(terrain, { seed = 7, half = 0.4, step = 0.002 } = {}) {
    this.terrain = terrain; this.half = half; this.step = step;
    const n = this.n = Math.round(2 * half / step) + 1, rnd = random(seed + 101);
    // Micro relief in metres on the grid.
    const micro = this.micro = new Float32Array(n * n), albedo = new Float32Array(n * n).fill(0);
    const cell = step * 1000, halfM = half * 1000;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = c * cell - halfM, z = r * cell - halfM;
      micro[r * n + c] = (fbm(x / 70 + 13.1, z / 70 - 7.7, 4, seed) - 0.5) * 3.2 + (fbm(x / 16 + 3.3, z / 16 + 9.9, 3, seed + 9) - 0.5) * 0.7 + (fbm(x / 4 + 1.1, z / 4 - 4.4, 2, seed + 5) - 0.5) * 0.12;
    }
    // Crater population: cumulative N(>r) ∝ r^-1.8 between 1.5 m and 70 m; a few fresh ones.
    this.craters = [];
    const addCrater = (cx, cz, radius, fresh) => {
      if (Math.hypot(cx, cz) < radius + 14) return;
      // Most craters on an old surface are degraded: shallow, soft-rimmed bowls. A few are fresh.
      const depth = radius * (fresh ? 0.17 : 0.025 + rnd() * 0.06), rim = depth * (fresh ? 0.26 : 0.06), reach = radius * (fresh ? 2.6 : 1.5);
      const c0 = Math.max(0, Math.floor((cx - reach + halfM) / cell)), c1 = Math.min(n - 1, Math.ceil((cx + reach + halfM) / cell));
      const r0 = Math.max(0, Math.floor((cz - reach + halfM) / cell)), r1 = Math.min(n - 1, Math.ceil((cz + reach + halfM) / cell));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const d = Math.hypot(c * cell - halfM - cx, r * cell - halfM - cz) / radius; if (d > reach / radius) continue;
        const bowl = fresh ? (d < 1 ? depth * (d * d - 1) : 0) : d < 1.2 ? -depth * (1 - smooth(0, 1.2, d)) ** 1.4 : 0;
        const lip = fresh ? (d < 1 ? rim * Math.exp(-((d - 1) ** 2) / 0.02) : rim * Math.pow(d, -3.2) * smooth(reach / radius, 1, d)) : rim * Math.exp(-((d - 1.1) ** 2) / 0.08);
        micro[r * n + c] += bowl + lip;
        if (fresh) albedo[r * n + c] += d < 1 ? -0.02 : 0.11 * Math.pow(d, -2.2) * smooth(reach / radius, 1, d);
      }
      this.craters.push({ x: cx, z: cz, r: radius, fresh });
    };
    const big = [[-150, -95, 62, false], [120, 140, 44, false], [-60, 210, 30, false], [210, -170, 55, false], [95, -60, 14, true], [-70, 85, 9, true], [160, 40, 6, true]];
    for (const [x, z, r, f] of big) addCrater(x, z, r, f);
    for (let i = 0; i < 420; i++) {
      const radius = Math.min(26, 2 * Math.pow(1 - rnd(), -1 / 1.6));
      addCrater((rnd() * 2 - 1) * halfM, (rnd() * 2 - 1) * halfM, radius, radius < 5 && rnd() < 0.05);
    }
    // Flat pad under the lander, and a fade to the plain LOLA surface at the edge.
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = c * cell - halfM, z = r * cell - halfM, edge = halfM - Math.max(Math.abs(x), Math.abs(z));
      micro[r * n + c] *= smooth(5, 16, Math.hypot(x, z)) * smooth(0, 60, edge);
    }
    // Geometry.
    const positions = new Float32Array(n * n * 3), colors = new Float32Array(n * n * 3), uvs = new Float32Array(n * n * 2);
    this.heights = new Float32Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c, x = -half + c * step, z = -half + r * step, h = terrain.height(x, z) + micro[i] / 1000;
      this.heights[i] = h; positions.set([x, h, z], i * 3); uvs.set([x * 1000 / 24, -z * 1000 / 24], i * 2);
      const a = 0.56 + (fbm(x * 1000 / 30 + 5, z * 1000 / 30 - 2, 3, seed + 3) - 0.5) * 0.08 + albedo[i];
      colors.set([a, a * 0.985, a * 0.958], i * 3);
    }
    const index = new Uint32Array((n - 1) * (n - 1) * 6); let k = 0;
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const a = r * n + c, b = a + 1, d = a + n, e = d + 1; index.set([a, d, b, b, d, e], k); k += 6; }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    this.normalMap = regolithNormalMap(512, seed + 23, { craters: 26 });
    this.mesh = new THREE.Mesh(geometry, lunarMaterial({ normalMap: this.normalMap, normalScale: 0.35 }));
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.group = new THREE.Group(); this.group.add(this.mesh);
    this.rocks = this.makeRocks(rnd); this.group.add(this.rocks);
    this.dust = this.makeDust(rnd); this.group.add(this.dust);
  }
  heightAt(x, z) {
    const n = this.n, fx = (x + this.half) / this.step, fz = (z + this.half) / this.step;
    if (fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) return this.terrain.height(x, z);
    const c = Math.min(n - 2, Math.floor(fx)), r = Math.min(n - 2, Math.floor(fz)), u = fx - c, v = fz - r, h = this.heights;
    return (h[r * n + c] * (1 - u) + h[r * n + c + 1] * u) * (1 - v) + (h[(r + 1) * n + c] * (1 - u) + h[(r + 1) * n + c + 1] * u) * v;
  }
  makeRocks(rnd) {
    // One irregular rock, instanced: sizes follow a steep power law; most sit in the ejecta of fresh craters.
    const base = new THREE.IcosahedronGeometry(1, 2), p = base.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 0.8 + 0.34 * fbm(v.x * 1.3 + 4, v.y * 1.3 + v.z * 1.1, 3, 17); v.multiplyScalar(k); v.y *= 0.72; p.setXYZ(i, v.x, v.y, v.z); }
    base.computeVertexNormals();
    const count = 1500, mesh = new THREE.InstancedMesh(base, lunarMaterial({ vertexColors: false, color: 0x9d9993 }), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), color = new THREE.Color();
    const fresh = this.craters.filter(c => c.fresh && c.r > 4);
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 4; tries++) {
      let x, z, size = 0.06 * Math.pow(1 - rnd(), -1 / 2.1);
      if (fresh.length && rnd() < 0.62) { const c = fresh[Math.floor(rnd() * fresh.length)], a = rnd() * Math.PI * 2, d = c.r * (0.9 + Math.pow(rnd(), 1.6) * 1.9); x = c.x + Math.cos(a) * d; z = c.z + Math.sin(a) * d; size *= 1 + c.r / 30; }
      else { x = (rnd() * 2 - 1) * this.half * 1000 * 0.96; z = (rnd() * 2 - 1) * this.half * 1000 * 0.96; }
      size = Math.min(size, 1.7);
      const fromPad = Math.hypot(x, z); if (fromPad < 9 + size || (fromPad < 35 && size > 0.45)) continue;
      const kx = x / 1000, kz = z / 1000;
      pos.set(kx, this.heightAt(kx, kz) - size * 0.32 / 1000, kz);
      q.setFromEuler(new THREE.Euler(rnd() * 0.5, rnd() * Math.PI * 2, rnd() * 0.5));
      s.set(size * (0.8 + rnd() * 0.5), size * (0.6 + rnd() * 0.5), size * (0.8 + rnd() * 0.5)).multiplyScalar(0.001);
      mesh.setMatrixAt(placed, m.compose(pos, q, s));
      const g = 0.82 + rnd() * 0.3; mesh.setColorAt(placed, color.setRGB(g, g * 0.985, g * 0.96));
      placed++;
    }
    mesh.count = placed; mesh.castShadow = true; mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
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
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.normalMap.dispose(); this.rocks.geometry.dispose(); this.rocks.material.dispose(); this.dust.geometry.dispose(); this.dust.material.dispose(); }
}
