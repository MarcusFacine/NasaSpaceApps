import * as THREE from 'three';

// Kennedy Space Center, Launch Complex 39A, at true scale (scene units are km): the pad mound with its
// flame trench, the mobile launcher and its 116 m umbilical tower, the marsh around it and the Atlantic
// to the east. The surroundings are a sketch; the sizes of the pad, tower and rocket are the real ones.

function canvasTexture(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function random(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export const PAD_DECK = 0.0196; // top of the mobile launcher above the ground, km

export class LaunchPad {
  constructor(water) {
    this.group = new THREE.Group();
    const rnd = random(4242);
    // Ground: the real Kennedy Space Center from the air (USDA NAIP via USGS The National Map, public domain; made by
    // scripts/prepare-ksc-imagery.py), north up (-z), east +x, LC-39A at the origin: 6 km at 2 m/pixel around the pad
    // 40 km at 20 m/pixel out to the Banana River, Merritt Island and the coast, and 120 km at 60 m/pixel of the mainland. Pure black in the 40 km square is
    // "no data" (open Atlantic), where the sea underneath shows. Both fade into the air's blue haze with distance
    // (aerial perspective; scale height of the haze ~20 km at the horizon on a clear Florida day).
    this.haze = { value: new THREE.Color(0.55, 0.64, 0.78) };
    const loader = new THREE.TextureLoader(), asset = f => new URL(`./assets/mission/${f}`, import.meta.url).href;
    const imagery = (file, half, hole) => {
      const map = loader.load(asset(file)); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 16;
      const material = new THREE.MeshLambertMaterial({ map });
      material.onBeforeCompile = shader => {
        shader.uniforms.uHaze = this.haze;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vGround;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xy;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHaze;\nvarying vec2 vGround;')
          .replace('#include <map_fragment>', `#include <map_fragment>
${hole ? `if (max(abs(vGround.x), abs(vGround.y)) < ${hole.toFixed(3)}) discard;` : ''}
if (max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) < .012) discard;   // no data: the Atlantic
`)
          .replace('#include <opaque_fragment>', `#include <opaque_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, 1. - exp(-length(vViewPosition) / 20.));`);
      };
      material.customProgramCacheKey = () => `ksc-ground-${hole ? 'ring' : 'core'}`;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * half, 2 * half), material); mesh.rotation.x = -Math.PI / 2; mesh.receiveShadow = true;
      this.group.add(mesh); return mesh;
    };
    this.near = imagery('ksc-near.jpg', 3, 0); this.mid = imagery('ksc-mid.jpg', 20, 2.97); this.far = imagery('ksc-far.jpg', 60, 19.8);
    this.mid.position.y = -.0003; this.far.position.y = -.0006;
    // Beyond the photographs: the Florida mainland to the west, the Atlantic everywhere else, under the imagery.
    // Drawn first and without depth: a metre below the photographs is below the depth precision 30 km away.
    const land = new THREE.Mesh(new THREE.PlaneGeometry(180, 400), new THREE.MeshLambertMaterial({ color: 0x4a5236, depthWrite: false })); land.rotation.x = -Math.PI / 2; land.position.set(-150, -0.0008, 0); land.renderOrder = -2; this.group.add(land);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), water); sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.0012, 0); sea.renderOrder = -3; sea.onBeforeRender = (r, sc, cam, g, m) => { m.userData.depthWrite ??= m.depthWrite; m.depthWrite = false; }; sea.onAfterRender = (r, sc, cam, g, m) => { m.depthWrite = m.userData.depthWrite; }; this.group.add(sea);
    // Pad mound (elevated 12 m), flame trench running north-south, mobile launcher deck.
    const concrete = new THREE.MeshLambertMaterial({ color: 0xa9a59a }), dark = new THREE.MeshLambertMaterial({ color: 0x2e2d2b }), steel = new THREE.MeshLambertMaterial({ color: 0x7d8185 });
    const add = (geometry, material, x, y, z) => { const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; this.group.add(m); return m; };
    {
      const g = new THREE.CylinderGeometry(0.075, 0.2, 0.012, 4, 1).rotateY(Math.PI / 4).translate(0, 0.006, 0), pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 6 + .5, .5 - pos.getZ(i) / 6);
      const mound = new THREE.Mesh(g, this.near.material); mound.receiveShadow = true; this.group.add(mound);
    }
    add(new THREE.BoxGeometry(0.049, 0.0076, 0.041), steel, -0.006, 0.012 + 0.0038, 0);
    // Umbilical tower: red lattice, 116 m above the deck, with the hammerhead crane on top.
    const red = new THREE.MeshLambertMaterial({ color: 0xa33a2c }), unit = new THREE.BoxGeometry(1, 1, 1), members = [];
    const tx = -0.026, half = 0.0058, base = PAD_DECK, tall = 0.116;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) members.push([tx + sx * half, base + tall / 2, sz * half, 0.0009, tall, 0.0009]);
    for (let i = 0; i <= 19; i++) { const y = base + tall * i / 19; for (const s of [-1, 1]) { members.push([tx, y, s * half, half * 2, 0.0005, 0.0005]); members.push([tx + s * half, y, 0, 0.0005, 0.0005, half * 2]); } }
    const tower = new THREE.InstancedMesh(unit, red, members.length), m4 = new THREE.Matrix4();
    members.forEach((b, i) => tower.setMatrixAt(i, m4.compose(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Quaternion(), new THREE.Vector3(b[3], b[4], b[5]))));
    tower.castShadow = true; this.group.add(tower);
    add(new THREE.BoxGeometry(0.03, 0.003, 0.004), red, tx + 0.006, base + tall + 0.004, 0);
    // Nine swing arms; they swing clear at liftoff.
    this.arms = new THREE.Group(); this.arms.position.set(tx, 0, 0); this.group.add(this.arms);
    for (let i = 0; i < 9; i++) { const arm = new THREE.Mesh(unit, steel); arm.scale.set(0.02, 0.0016, 0.003); arm.position.set(0.0158, base + 0.014 + i * 0.0112, 0); arm.castShadow = true; this.arms.add(arm); }
    // Flame light: what lights the pad and the smoke at night.
    this.flame = new THREE.PointLight(0xffb070, 0, 3, 2); this.group.add(this.flame);
    this.smoke = this.makeSmoke(rnd); this.group.add(this.smoke);
  }
  makeSmoke(rnd) {
    const count = 900, seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) seed.set([(i + rnd()) / count, rnd() * Math.PI * 2, rnd(), rnd()], i * 4);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count), 1));
    geometry.setAttribute('aHeat', new THREE.BufferAttribute(new Float32Array(count), 1));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uScale: { value: 800 }, uLight: { value: new THREE.Color(0.9, 0.88, 0.85) }, uFlameTop: { value: 0 }, uFlame: { value: 0 } }, // flame: ~150 m below the nozzles
      // Light from the flame: the exhaust column (from the nozzles down into the trench) is a line source, so the
      // irradiance on a cloud falls as ~1/d near it and ~1/d² farther out; at night it is what lights the clouds
      // gold (Apollo 17's night launch). Only the clouds near the ground: higher up, the trail right under the flame is the
      // flame volume itself (spacecraft.js), and lit puffs there read as a string of beads.
      vertexShader: 'attribute float aSize; attribute float aAlpha; attribute float aHeat; varying float vAlpha; varying float vHeat; varying float vFlame; uniform float uScale, uFlameTop, uFlame; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = min(900., aSize * uScale / -mv.z); gl_Position = projectionMatrix * mv; vAlpha = aAlpha; vHeat = aHeat; vec3 q = vec3(0., clamp(position.y, max(0., uFlameTop - .15), uFlameTop), 0.); float d2 = dot(position - q, position - q); vFlame = uFlame * .0012 / (d2 + .0012) * (1. - smoothstep(.06, .2, position.y)); }',
      fragmentShader: 'uniform vec3 uLight; varying float vAlpha; varying float vHeat; varying float vFlame; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .1, d) * vAlpha; if (a < .004) discard; vec3 c = mix(uLight, vec3(1., .62, .3) * 1.5, vHeat * .8); gl_FragColor = vec4(pow(c, vec3(2.2)) + vec3(1., .5, .18) * vFlame, a); }'
    });
    const points = new THREE.Points(geometry, material); points.frustumCulled = false; points.userData.seed = seed; return points;
  }
  // t: stage fraction 0..1; altitude(k): rocket base altitude in km at stage fraction k; ignition 0..1; day 0..1.
  update(t, altitude, ignition, day, scale) {
    this.arms.rotation.y = Math.min(1, ignition * 1.4) * 1.25;
    this.flame.intensity = 0.02 * ignition * (1 - 0.6 * day); this.flame.position.set(0, PAD_DECK + altitude(t) - 0.004, 0);
    const smoke = this.smoke, seed = smoke.userData.seed, g = smoke.geometry, p = g.attributes.position, size = g.attributes.aSize, alpha = g.attributes.aAlpha, heat = g.attributes.aHeat;
    for (let i = 0; i < p.count; i++) {
      const born = seed[i * 4], a = seed[i * 4 + 1], r1 = seed[i * 4 + 2], r2 = seed[i * 4 + 3], age = (t - born) * 9;
      if (age <= 0) { alpha.setX(i, 0); continue; }
      const h = altitude(born);
      if (h < 0.03) {
        // Deflected by the trench: two clouds rolling out north and south, then billowing up.
        const out = 0.3 * (1 - Math.exp(-age * 0.9)) * (0.5 + r1), side = (i % 2 ? 1 : -1);
        p.setXYZ(i, Math.cos(a) * out * 0.42, 0.012 + 0.11 * (1 - Math.exp(-age * 0.55)) * r2, side * out + Math.sin(a) * out * 0.3);
        size.setX(i, 0.05 + 0.12 * Math.min(1, age * 0.5)); alpha.setX(i, 0.5 * Math.min(1, age * 3) * Math.exp(-age * 0.13)); heat.setX(i, Math.exp(-age * 3.5) * 0.8);
      } else {
        // Exhaust trail left along the climb.
        const w = 0.012 + 0.05 * Math.sqrt(age);
        p.setXYZ(i, Math.cos(a) * w * r1, PAD_DECK + h - 0.03 - 0.02 * age, Math.sin(a) * w * r1);
        size.setX(i, 0.045 + 0.1 * Math.sqrt(age)); alpha.setX(i, 0.5 * Math.exp(-age * 0.22)); heat.setX(i, Math.exp(-age * 5));
      }
    }
    p.needsUpdate = size.needsUpdate = alpha.needsUpdate = heat.needsUpdate = true;
    this.haze.value.setRGB(.55, .64, .78).multiplyScalar(.08 + .92 * day);
    smoke.material.uniforms.uScale.value = scale; smoke.material.uniforms.uLight.value.setScalar(0.12 + 0.8 * day);
    // Flame light on the clouds, linear radiance: ~2 next to the flame column, falling off over a few tens of metres.
    smoke.material.uniforms.uFlameTop.value = PAD_DECK + altitude(t); smoke.material.uniforms.uFlame.value = 2.2 * Math.min(1, ignition * 1.25);
  }
  dispose() { for (const m of [this.near, this.mid, this.far]) m.material.map?.dispose(); this.group.traverse(o => { o.geometry?.dispose(); if (o.material && o.material !== this.water) o.material.dispose?.(); }); }
}
