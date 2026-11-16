import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// Official NASA models (github.com/nasa/NASA-3D-Resources, "Apollo Lunar Module" and "Apollo Soyuz"),
// brought to the simulation's conventions: metres, +Y along the vehicle axis, origin where the vehicle
// rests or joins. The lunar module is split into its two stages; from the Apollo–Soyuz model only the
// Apollo command and service modules are kept. Geometry is NASA's; materials are remapped by the caller.

const asset = path => new URL(path, import.meta.url).href;
const LM_SCALE = 1.25, LM_STAGE_SPLIT = 2.5, LM_DECK = 2.42, LM_DOCK = 4.62;
const CSM_SCALE = 0.7637, CSM_BASE_X = -3.6, CSM_PARTS = { blinn14SG: 'cm', blinn11SG: 'sm', blinn4SG: 'sm', blinn13SG: 'bell', apollohorns_blin: 'sm', apollohorns_bli1: 'sm' };

let pending = null;
export function loadNasaModels() {
  return pending || (pending = (async () => {
    const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(asset('./vendor/addons/libs/draco/')));
    const [lm, astp] = await Promise.all([loader.loadAsync(asset('./assets/mission/models/lunar-module.glb')), loader.loadAsync(asset('./assets/mission/models/apollo-soyuz.glb'))]);
    const bake = (source, matrix) => { const g = source.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(matrix, source.matrixWorld)); g.computeBoundingBox(); const m = new THREE.Mesh(g, source.material); m.name = source.name; return m; };

    // Lunar module: footpads on y = 0. A part belongs to the stage its centre lies in.
    lm.scene.updateMatrixWorld(true);
    const lmMatrix = new THREE.Matrix4().makeScale(LM_SCALE, LM_SCALE, LM_SCALE).multiply(new THREE.Matrix4().makeTranslation(0, -0.1, 0));
    const descent = new THREE.Group(), ascent = new THREE.Group(), lift = new THREE.Matrix4().makeTranslation(0, -LM_DECK * LM_SCALE, 0);
    lm.scene.traverse(o => {
      if (!o.isMesh) return;
      const centre = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).y, low = centre < LM_STAGE_SPLIT;
      const part = bake(o, lmMatrix); if (!low) part.geometry.applyMatrix4(lift);
      (low ? descent : ascent).add(part);
    });
    // Apollo CSM out of the Apollo–Soyuz stack: the vehicle axis (model X) becomes +Y, apex up.
    astp.scene.updateMatrixWorld(true);
    const csmMatrix = new THREE.Matrix4().set(0, CSM_SCALE, 0, -0.23 * CSM_SCALE, CSM_SCALE, 0, 0, -CSM_BASE_X * CSM_SCALE, 0, 0, -CSM_SCALE, -0.025 * CSM_SCALE, 0, 0, 0, 1);
    const cm = new THREE.Group(), sm = new THREE.Group(), bell = new THREE.Group();
    astp.scene.traverse(o => { if (!o.isMesh) return; const kind = CSM_PARTS[o.material.name]; if (kind) ({ cm, sm, bell })[kind].add(bake(o, csmMatrix)); });
    return {
      lm: { descent, ascent, deck: LM_DECK * LM_SCALE, dock: (LM_DOCK - LM_DECK) * LM_SCALE, height: 5.02 * LM_SCALE },
      csm: { cm, sm, bell, apex: (-0.42 - CSM_BASE_X) * CSM_SCALE, base: (-3.95 - CSM_BASE_X) * CSM_SCALE, bellEnd: (-12.26 - CSM_BASE_X) * CSM_SCALE, radius: 1.955 }
    };
  })().catch(error => { console.warn('NASA models unavailable, using the built-in shapes.', error); return null; }));
}
