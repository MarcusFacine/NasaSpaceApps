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
    // Ground: 8 km of marsh, lagoons, the crawlerway and the pad apron, drawn once.
    const map = this.groundMap = canvasTexture(2048, (g, n) => {
      g.fillStyle = '#56603f'; g.fillRect(0, 0, n, n);
      for (let i = 0; i < 2600; i++) { const x = rnd() * n, y = rnd() * n, r = 6 + rnd() * 46; g.fillStyle = ['rgba(70,84,52,.5)', 'rgba(98,104,70,.45)', 'rgba(46,62,44,.5)', 'rgba(120,116,84,.3)'][i % 4]; g.beginPath(); g.ellipse(x, y, r, r * (0.4 + rnd() * 0.6), rnd() * 3, 0, 7); g.fill(); }
      for (let i = 0; i < 46; i++) { const x = rnd() * n, y = rnd() * n, r = 20 + rnd() * 90; g.fillStyle = 'rgba(28,48,60,.85)'; g.beginPath(); g.ellipse(x, y, r, r * (0.3 + rnd() * 0.5), rnd() * 3, 0, 7); g.fill(); }
      const c = n / 2, px = n / 8000; // pixels per metre
      g.fillStyle = '#b9ab8b'; g.fillRect(c - 3200 * px, c - 22 * px, 3200 * px, 16 * px); g.fillRect(c - 3200 * px, c + 6 * px, 3200 * px, 16 * px); // crawlerway, two tracks
      g.fillStyle = '#8f8a7c'; g.beginPath(); g.arc(c, c, 420 * px, 0, 7); g.fill();
      g.fillStyle = '#a9a69b'; g.fillRect(c - 190 * px, c - 190 * px, 380 * px, 380 * px);
      g.strokeStyle = '#3c3d3a'; g.lineWidth = 9 * px; g.beginPath(); g.arc(c, c, 520 * px, 0, 7); g.stroke();
      g.fillStyle = '#d8cfae'; g.fillRect(c + 900 * px, 0, 70 * px, n); // beach
      g.fillStyle = '#1c4259'; g.fillRect(c + 970 * px, 0, n, n); // Atlantic
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshLambertMaterial({ map })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.group.add(ground);
    const land = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshLambertMaterial({ color: 0x4f5a3c })); land.rotation.x = -Math.PI / 2; land.position.set(-76, -0.0006, 0); this.group.add(land);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), water); sea.rotation.x = -Math.PI / 2; sea.position.set(84, -0.0004, 0); this.group.add(sea);
    // Pad mound (elevated 12 m), flame trench running north-south, mobile launcher deck.
    const concrete = new THREE.MeshLambertMaterial({ color: 0xa9a59a }), dark = new THREE.MeshLambertMaterial({ color: 0x2e2d2b }), steel = new THREE.MeshLambertMaterial({ color: 0x7d8185 });
    const add = (geometry, material, x, y, z) => { const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; this.group.add(m); return m; };
    add(new THREE.CylinderGeometry(0.075, 0.2, 0.012, 4, 1), concrete, 0, 0.006, 0).rotation.y = Math.PI / 4;
    add(new THREE.BoxGeometry(0.018, 0.0125, 0.3), dark, 0, 0.0063, 0);
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
      transparent: true, depthWrite: false, uniforms: { uScale: { value: 800 }, uLight: { value: new THREE.Color(0.9, 0.88, 0.85) } },
      vertexShader: 'attribute float aSize; attribute float aAlpha; attribute float aHeat; varying float vAlpha; varying float vHeat; uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = min(900., aSize * uScale / -mv.z); gl_Position = projectionMatrix * mv; vAlpha = aAlpha; vHeat = aHeat; }',
      fragmentShader: 'uniform vec3 uLight; varying float vAlpha; varying float vHeat; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .1, d) * vAlpha; if (a < .004) discard; vec3 c = mix(uLight, vec3(1., .62, .3) * 1.5, vHeat * .8); gl_FragColor = vec4(pow(c, vec3(2.2)), a); }'
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
    smoke.material.uniforms.uScale.value = scale; smoke.material.uniforms.uLight.value.setScalar(0.12 + 0.8 * day);
  }
  dispose() { this.groundMap.dispose(); this.group.traverse(o => { o.geometry?.dispose(); if (o.material && o.material !== this.water) o.material.dispose?.(); }); }
}
