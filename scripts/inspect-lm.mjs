import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

// Bounds use the same metre frame as nasa-models.js + buildLM: +Y up, +Z ladder/forward.
const root = path.resolve(import.meta.dirname, '..'), file = path.join(root, 'dist/assets/mission/models/lunar-module.glb');
const bytes = fs.readFileSync(file), jsonSize = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize));
const binary = bytes.subarray(28 + jsonSize);
const bake = new THREE.Matrix4().makeScale(1.25, 1.25, 1.25).multiply(new THREE.Matrix4().makeTranslation(0, -.1, 0));
const xyz = v => v.toArray().map(n => +n.toFixed(4));
let decoderModule, decoderReady;
async function decode(primitive) {
  if (!decoderModule) {
    if (!decoderReady) decoderReady = (async () => {
    const dir = path.join(root, 'dist/vendor/addons/libs/draco'), module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'draco_wasm_wrapper.js'), 'utf8'), { module, exports: module.exports, require: createRequire(import.meta.url), __dirname: dir, console, WebAssembly, TextDecoder, Uint8Array, Buffer, setTimeout, clearTimeout });
    return module.exports({ wasmBinary: fs.readFileSync(path.join(dir, 'draco_decoder.wasm')) });
    })();
    decoderModule = await decoderReady;
  }
  const d = decoderModule, decoder = new d.Decoder(), buffer = new d.DecoderBuffer(), ext = primitive.extensions.KHR_draco_mesh_compression;
  const view = gltf.bufferViews[ext.bufferView], data = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  buffer.Init(new Int8Array(data), data.byteLength);
  const mesh = new d.Mesh(), status = decoder.DecodeBufferToMesh(buffer, mesh);
  if (!status.ok()) throw new Error(status.error_msg());
  const attr = decoder.GetAttributeByUniqueId(mesh, ext.attributes.POSITION), values = new d.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, attr, values);
  const positions = Array.from({ length: mesh.num_points() }, (_, i) => new THREE.Vector3(values.GetValue(i * 3), values.GetValue(i * 3 + 1), values.GetValue(i * 3 + 2)));
  const indices = [], face = new d.DracoInt32Array();
  for (let i = 0; i < mesh.num_faces(); i++) { decoder.GetFaceFromMesh(mesh, i, face); indices.push(face.GetValue(0), face.GetValue(1), face.GetValue(2)); }
  d.destroy(face); positions.indices = indices;
  for (const value of [values, mesh, buffer, decoder]) d.destroy(value);
  return positions;
}
const records = [];
function visit(index, parent = new THREE.Matrix4(), depth = 0) {
  const n = gltf.nodes[index], local = n.matrix ? new THREE.Matrix4().fromArray(n.matrix) : new THREE.Matrix4().compose(new THREE.Vector3(...(n.translation || [0, 0, 0])), new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(n.scale || [1, 1, 1])));
  const world = parent.clone().multiply(local);
  if (n.mesh !== undefined) gltf.meshes[n.mesh].primitives.forEach((p, primitive) => {
    const a = gltf.accessors[p.attributes.POSITION], bounds = new THREE.Box3(new THREE.Vector3(...a.min), new THREE.Vector3(...a.max)).applyMatrix4(bake.clone().multiply(world));
    records.push({ name: n.name, primitive, material: gltf.materials[p.material]?.name, stage: bounds.getCenter(new THREE.Vector3()).y < 3 ? 'descent' : 'ascent', min: xyz(bounds.min), max: xyz(bounds.max), primitiveData: p, matrix: bake.clone().multiply(world), depth });
  });
  for (const child of n.children || []) visit(child, world, depth + 1);
}
for (const n of gltf.scenes[gltf.scene || 0].nodes) visit(n);
export async function inspectLM() {
  const parts = [];
  for (const r of records) { const vertices = await decode(r.primitiveData); parts.push({ ...r, vertices: vertices.map(v => v.applyMatrix4(r.matrix)), indices: vertices.indices }); }
  return parts;
}
if (process.argv.includes('--cabin-check')) {
  const { buildLMCabin } = await import('../dist/lm-cabin.js');
  const assert = (await import('node:assert/strict')).default;
  // Stub drawing for geometric checks; panel rendering remains a browser-lab visual check.
  const context = new Proxy({}, { get: (o, k) => o[k] || (() => {}), set: (o, k, v) => (o[k] = v, true) });
  const cabin = buildLMCabin({ textureFactory: (width, height) => ({ width, height, getContext: () => context }) });
  cabin.group.updateMatrixWorld(true);
  const meshes = []; cabin.group.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const station of ['cdr', 'lmp']) {
    const window = cabin.windows[station], ray = new THREE.Raycaster(cabin.eyes[station], cabin.lookDir, 0, 2);
    assert.equal(ray.intersectObjects(meshes).length, 0, `${station} forward-down view must be open`);
    const center = window.center;
    ray.set(cabin.eyes[station], center.clone().sub(cabin.eyes[station]).normalize());
    assert.equal(ray.intersectObjects(meshes).length, 0, `${station} triangular center must be open`);
    for (const p of window.vertices) { const inset = p.clone().lerp(center, .25); ray.set(cabin.eyes[station], inset.sub(cabin.eyes[station]).normalize()); assert.equal(ray.intersectObjects(meshes).length, 0, `${station} inset aperture must be open`); }
  }
  const dockCenter = cabin.windows.docking.center, dockEye = new THREE.Vector3(.59, 4.80, .355);
  assert.equal(new THREE.Raycaster(dockEye, dockCenter.clone().sub(dockEye).normalize(), 0, 1).intersectObjects(meshes).length, 0, 'Docking opening must be open');
  const triangles = meshes.reduce((n, o) => n + (o.geometry.index?.count || o.geometry.attributes.position.count) / 3 * (o.count || 1), 0);
  console.log(JSON.stringify({ eyes: cabin.eyes, lookDir: cabin.lookDir, meshes: meshes.length, triangles, instances: meshes.filter(o => o.isInstancedMesh).map(o => [o.name, o.count]), apertureRays: 'passed' }, null, 2));
  cabin.dispose(); cabin.dispose();
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
console.log('Frame: metres; +X crew left when looking forward; +Y up; +Z forward/ladder. NASA raw -> (1.25*x, 1.25*(y-.1), 1.25*z).');
for (const r of records) {
  if (process.argv.includes('--ascent') && r.stage !== 'ascent') continue;
  console.log(`${'  '.repeat(r.depth)}${r.name} [${r.primitive}] ${r.material} ${r.stage} ${JSON.stringify(r.min)} .. ${JSON.stringify(r.max)}`);
  if (process.argv.includes('--vertices') && /polySurfac/.test(r.name)) {
    const vertices = await decode(r.primitiveData), unique = new Map();
    for (const vertex of vertices) { vertex.applyMatrix4(r.matrix); const a = xyz(vertex); unique.set(a.join(','), a); }
    console.log('  shell vertices:', JSON.stringify([...unique.values()].sort((a, b) => b[2] - a[2])));
  }
}
}

