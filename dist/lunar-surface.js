import * as THREE from 'three';

// Regolith photometry. Lambert alone makes the Moon look like clay: brightness falls to the
// terminator. The lunar-Lambert model (McEwen 1991) blends Lambert with Lommel-Seeliger,
// 2·cos(i)/(cos(i)+cos(e)), with a weight that drops as the phase angle grows; a small
// opposition surge brightens the surface when the Sun is behind the viewer.
// Display only: no calculation in the app depends on it.
const LUNAR_DIFFUSE = `float lunarMu=saturate(dot(geometryNormal,geometryViewDir));
	float lunarPhase=acos(clamp(dot(directLight.direction,geometryViewDir),-1.,1.));
	float lunarL=clamp(1.-.45*lunarPhase,.2,1.);
	float lunarK=mix(1.,2./max(dotNL+lunarMu,.08),lunarL);
	float lunarSurge=1.+.3*exp(-lunarPhase/.06);
	reflectedLight.directDiffuse += irradiance*min(lunarK,3.2)*lunarSurge*BRDF_Lambert( material.diffuseColor );`;

// psr: optional shared uniform { value: 0..1 } that makes permanently shadowed ground glow faintly.
export const PSR_COLOR = new THREE.Color(0x8a7dff);
// normalY: +1 for image normal maps (north up), −1 for the generated tiles. hole: { dir, cos } uniforms that
// cut a spherical cap out of a globe (object space), where a finer mesh takes over. transparent: per-vertex alpha.
export function lunarMaterial({ vertexColors = true, map = null, normalMap = null, normalScale = 0.5, normalY = -1, color = 0xffffff, psr = null, hole = null, transparent = false } = {}) {
  const material = new THREE.MeshLambertMaterial({ color, vertexColors, map, normalMap, normalScale: new THREE.Vector2(normalScale, normalY * normalScale), transparent });
  material.onBeforeCompile = shader => {
    if (hole) {
      shader.uniforms.uHoleDir = hole.dir; shader.uniforms.uHoleCos = hole.cos;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHolePos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHolePos = position;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHoleDir;\nuniform float uHoleCos;\nvarying vec3 vHolePos;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (dot(normalize(vHolePos), uHoleDir) > uHoleCos) discard;');
    }
    const chunk = THREE.ShaderChunk.lights_lambert_pars_fragment;
    const target = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
    if (chunk.includes(target)) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_lambert_pars_fragment>', chunk.replace(target, LUNAR_DIFFUSE));
    if (psr) {
      shader.uniforms.uPsr = psr; shader.uniforms.uPsrColor = { value: PSR_COLOR };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute float psr;
varying float vPsr;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vPsr = psr;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uPsr;
uniform vec3 uPsrColor;
varying float vPsr;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += uPsrColor * smoothstep(.35, .95, vPsr) * uPsr * .32;`);
    }
  };
  material.customProgramCacheKey = () => `lunar-lambert-3-${psr ? 'psr' : 'plain'}-${hole ? 'hole' : 'whole'}`;
  return material;
}

// Earth clouds (three.js earth_clouds_1024.png): the cloud mask is the alpha channel, RGB is not.
export function cloudMaterial(texture) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: texture, transparent: true, depthWrite: false, roughness: 1 });
  material.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', 'diffuseColor.a *= texture2D( map, vMapUv ).a;'); };
  material.customProgramCacheKey = () => 'cloud-alpha';
  return material;
}

// Deterministic hash and tileable value noise.
function hash(x, y, seed) {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const w = k => ((k % period) + period) % period;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed), c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export function fbm(x, y, octaves = 4, seed = 1) {
  let value = 0, amp = 0.5, freq = 1;
  for (let o = 0; o < octaves; o++) { value += amp * valueNoise(x * freq, y * freq, 1 << 20, seed + o); amp *= 0.5; freq *= 2; }
  return value;
}

// Small-scale relief below the DEM sampling (craterlets and roughness), as a tileable normal map.
// Synthetic and visual only; the elevation model and every number come from LOLA.
export function regolithNormalMap(size = 512, seed = 11, { craters = 200 } = {}) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, amp = 1;
    for (let o = 0; o < 6; o++) { const p = 4 << o; v += amp * valueNoise(x / size * p, y / size * p, p, seed + o); amp *= 0.52; }
    h[y * size + x] = v * 1.4;
  }
  let s = seed * 7919;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // Crater size-frequency: many small, few large (power law).
  for (let i = 0; i < craters; i++) {
    const cx = rnd() * size, cy = rnd() * size, r = 1.5 + Math.pow(rnd(), 3.4) * 26, depth = r * 0.08;
    const reach = Math.ceil(r * 1.6);
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const d = Math.hypot(dx, dy) / r;
      if (d > 1.6) continue;
      const bowl = d < 1 ? (d * d - 1) * depth : 0;
      const rim = 0.32 * depth * Math.exp(-((d - 1) * (d - 1)) / 0.045);
      const px = ((Math.round(cx + dx) % size) + size) % size, py = ((Math.round(cy + dy) % size) + size) % size;
      h[py * size + px] += bowl + rim;
    }
  }
  const data = new Uint8Array(size * size * 4), k = 1.6;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
    const nx = (l - r) * k, ny = (u - d) * k, len = Math.hypot(nx, ny, 1), i = (y * size + x) * 4;
    data[i] = (nx / len * 0.5 + 0.5) * 255; data[i + 1] = (ny / len * 0.5 + 0.5) * 255; data[i + 2] = (1 / len * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8; texture.needsUpdate = true;
  return texture;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Albedo per vertex: highland regolith is fairly uniform (~0.12–0.16 normal albedo); fresh,
// steep slopes are a little brighter. Kept subtle and monochrome.
function albedo(x, z, slope) {
  const patch = fbm(x / 14 + 31.7, z / 14 - 12.3, 4, 3);
  return 0.6 + 0.14 * Math.min(1, slope * 2.2) + (patch - 0.5) * 0.1;
}

// Detailed tile: (size × size) grid over extent km, centred on the observer. The context tile
// sits slightly below it where they overlap, so the seam never opens.
function addPsr(geometry, terrain) {
  const pos = geometry.attributes.position, values = new Float32Array(pos.count);
  if (terrain.psr) for (let i = 0; i < pos.count; i++) values[i] = terrain.psrAt(pos.getX(i), pos.getZ(i));
  geometry.setAttribute('psr', new THREE.BufferAttribute(values, 1));
}

// Finest tile at the centre (real 40 m relief near the observer).
// hole (km, half-size): leave out cells fully inside a centred square another mesh covers.
export function innerTerrainGeometry(terrain, { stride = 1, uvRepeat = 46, hole = 0 } = {}) {
  const inner = terrain.inner; if (!inner) return null;
  const n = Math.floor((inner.size - 1) / stride) + 1, extent = inner.extent;
  const geometry = new THREE.PlaneGeometry(extent, extent, n - 1, n - 1);
  const pos = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const i = row * n + col, x = (col / (n - 1) - 0.5) * extent, z = (row / (n - 1) - 0.5) * extent;
    pos.setXYZ(i, x, terrain.height(x, z), z);
    uv.setXY(i, (x / terrain.extent + 0.5) * uvRepeat, (0.5 - z / terrain.extent) * uvRepeat);
  }
  geometry.computeVertexNormals();
  const normal = geometry.attributes.normal, colors = new Float32Array(n * n * 3);
  for (let i = 0; i < n * n; i++) { const a = albedo(pos.getX(i), pos.getZ(i), 1 - normal.getY(i)); colors.set([a, a * 0.985, a * 0.955], i * 3); }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (hole) {
    const index = geometry.index.array, kept = [];
    for (let f = 0; f < index.length; f += 3) {
      const inside = [0, 1, 2].every(k => { const v = index[f + k]; return Math.abs(pos.getX(v)) <= hole + 1e-6 && Math.abs(pos.getZ(v)) <= hole + 1e-6; });
      if (!inside) kept.push(index[f], index[f + 1], index[f + 2]);
    }
    geometry.setIndex(kept);
  }
  addPsr(geometry, terrain); geometry.computeBoundingSphere();
  return geometry;
}

export function detailedTerrainGeometry(terrain, { stride = 1, uvRepeat = 46 } = {}) {
  const n0 = terrain.size, n = Math.floor((n0 - 1) / stride) + 1, extent = terrain.extent, hole = terrain.inner ? terrain.inner.extent / 2 : 0;
  const geometry = new THREE.PlaneGeometry(extent, extent, n - 1, n - 1);
  const pos = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const i = row * n + col, x = (col / (n - 1) - 0.5) * extent, z = (row / (n - 1) - 0.5) * extent;
    // Where the finer centre takes over, sink this tile slightly so the finer surface always wins.
    const under = hole && Math.abs(x) < hole + 0.4 && Math.abs(z) < hole + 0.4;
    pos.setXYZ(i, x, terrain.height(x, z) - (under ? 0.02 : 0), z);
    uv.setXY(i, (col / (n - 1)) * uvRepeat, (1 - row / (n - 1)) * uvRepeat);
  }
  geometry.computeVertexNormals();
  const normal = geometry.attributes.normal, colors = new Float32Array(n * n * 3);
  for (let i = 0; i < n * n; i++) {
    const a = albedo(pos.getX(i), pos.getZ(i), 1 - normal.getY(i));
    colors.set([a, a * 0.985, a * 0.955], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (hole) {
    const index = geometry.index.array, kept = [];
    for (let f = 0; f < index.length; f += 3) {
      const inside = [0, 1, 2].every(k => { const v = index[f + k]; return Math.abs(pos.getX(v)) < hole - 0.6 && Math.abs(pos.getZ(v)) < hole - 0.6; });
      if (!inside) kept.push(index[f], index[f + 1], index[f + 2]);
    }
    geometry.setIndex(kept);
  }
  addPsr(geometry, terrain); geometry.computeBoundingSphere();
  return geometry;
}

// Context tile: wide, coarser ring of the same DEM family. Cells fully inside the detailed tile
// are dropped; the outer edge fades into the dark so the tile never reads as a square slab.
export function contextTerrainGeometry(terrain, { uvRepeat = 46 } = {}) {
  const wide = terrain.wide; if (!wide) return null;
  const n = wide.size, extent = wide.extent, inner = terrain.extent / 2 - 1.2, outer = extent / 2;
  const positions = new Float32Array(n * n * 3), uvs = new Float32Array(n * n * 2), colors = new Float32Array(n * n * 3);
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const i = row * n + col, x = (col / (n - 1) - 0.5) * extent, z = (row / (n - 1) - 0.5) * extent;
    // Sink the context slightly under the detailed tile so the finer surface always wins.
    const inside = Math.abs(x) < inner + 1.6 && Math.abs(z) < inner + 1.6;
    positions.set([x, terrain.heightAt(x, z) - (inside ? 0.05 : 0), z], i * 3);
    uvs.set([(x / terrain.extent + 0.5) * uvRepeat, (0.5 - z / terrain.extent) * uvRepeat], i * 2);
    const fade = 1 - smooth(outer * 0.62, outer * 0.98, Math.hypot(x, z));
    colors.set([fade, fade, fade], i * 3);
  }
  const index = [];
  for (let row = 0; row < n - 1; row++) for (let col = 0; col < n - 1; col++) {
    const x0 = (col / (n - 1) - 0.5) * extent, x1 = ((col + 1) / (n - 1) - 0.5) * extent;
    const z0 = (row / (n - 1) - 0.5) * extent, z1 = ((row + 1) / (n - 1) - 0.5) * extent;
    if (Math.max(Math.abs(x0), Math.abs(x1)) < inner && Math.max(Math.abs(z0), Math.abs(z1)) < inner) continue;
    const a = row * n + col, b = a + 1, c = a + n, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const normal = geometry.attributes.normal;
  for (let i = 0; i < n * n; i++) {
    const fade = colors[i * 3], a = albedo(positions[i * 3], positions[i * 3 + 2], 1 - normal.getY(i)) * fade;
    colors.set([a, a * 0.985, a * 0.955], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

// The same LOLA relief seen from orbit, inside the globe of the mission scene: true heights out to
// ~120 km from the site, eased down to the sphere by 150 km and faded out by 192 km (per-vertex alpha),
// so the mesh meets the textured globe without a step.
export function orbitalPatchGeometry(terrain) {
  const wide = terrain.wide; if (!wide) return null;
  const n = wide.size, extent = wide.extent, inner = terrain.extent / 2 - 1.2;
  const positions = new Float32Array(n * n * 3), colors = new Float32Array(n * n * 4);
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const i = row * n + col, x = (col / (n - 1) - 0.5) * extent, z = (row / (n - 1) - 0.5) * extent, d = Math.hypot(x, z);
    const inside = Math.abs(x) < inner + 1.6 && Math.abs(z) < inner + 1.6, level = terrain.curvature(0.25, x, z);
    const y = terrain.heightAt(x, z) - (inside ? 0.05 : 0), flat = smooth(118, 150, d);
    positions.set([x, y + (level - y) * flat, z], i * 3); colors[i * 4 + 3] = 1 - smooth(156, 192, d);
  }
  const index = [];
  for (let row = 0; row < n - 1; row++) for (let col = 0; col < n - 1; col++) {
    const x0 = (col / (n - 1) - 0.5) * extent, x1 = ((col + 1) / (n - 1) - 0.5) * extent, z0 = (row / (n - 1) - 0.5) * extent, z1 = ((row + 1) / (n - 1) - 0.5) * extent;
    if (Math.max(Math.abs(x0), Math.abs(x1)) < inner && Math.max(Math.abs(z0), Math.abs(z1)) < inner) continue;
    if (Math.min(Math.hypot(x0, z0), Math.hypot(x1, z1), Math.hypot(x0, z1), Math.hypot(x1, z0)) > 194) continue;
    const a = row * n + col, b = a + 1, c = a + n, e = c + 1; index.push(a, c, b, b, c, e);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setIndex(index); geometry.computeVertexNormals();
  const normal = geometry.attributes.normal;
  for (let i = 0; i < n * n; i++) { const a = albedo(positions[i * 3], positions[i * 3 + 2], 1 - normal.getY(i)); colors.set([a, a * 0.985, a * 0.955], i * 4); }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4)); geometry.computeBoundingSphere();
  return geometry;
}
