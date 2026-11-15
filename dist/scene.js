import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RADIUS_KM, siteBasis, unit } from './model.js';
import { number } from './i18n.js';
// Short distances read in metres: a ridge 250 m away is not "0 km".
const distance = km => (km < 1 ? `${number(Math.round(km * 100) * 10)} m` : km < 10 ? `${number(km, 1)} km` : `${number(Math.round(km))} km`);
import { loadStarCatalog, createStarField, setRotationRows, combine } from './stars.js';
import { cloudMaterial, lunarMaterial, regolithNormalMap, detailedTerrainGeometry, contextTerrainGeometry, innerTerrainGeometry } from './lunar-surface.js';

const asset = path => new URL(path, import.meta.url).href;
const v3 = a => new THREE.Vector3(...a);
const bodyToScene = a => new THREE.Vector3(a[0], a[2], -a[1]);
export const SCENE_COLORS = { sun: 0xffe600, earth: 0xff5c9a, blocked: 0x8a8a82 };
const BODY_DISTANCE = 1400, PATH_RADIUS = 1250, HORIZON_RADIUS = 1150, STAR_RADIUS = 1800;
const lowPower = () => matchMedia('(max-width: 820px)').matches || (navigator.hardwareConcurrency || 8) <= 4;

function discTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.55, 'rgba(255,255,255,.9)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function glowSprite(stops, scale) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([at, color]) => r.addColorStop(at, color));
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  sprite.scale.set(scale, scale, 1); return sprite;
}

// Straight sight line from the observer along a direction, checked against the same terrain
// the horizon uses. Returns the first point where the relief rises above the line.
function trace(terrain, dir, h0) {
  const horiz = Math.hypot(dir.x, dir.z);
  const reach = terrain.wide ? terrain.wide.extent / 2 - 5 : 50;
  if (horiz < 1e-6) return { blocked: false, distance: reach };
  const sx = dir.x / horiz, sz = dir.z / horiz, slope = dir.y / horiz;
  for (let d = 0.25; d <= reach; d += d < 50 ? 0.25 : 1) {
    const ground = terrain.heightAt(sx * d, sz * d);
    if (ground > h0 + d * slope) return { blocked: true, distance: d, point: new THREE.Vector3(sx * d, ground, sz * d) };
  }
  return { blocked: false, distance: reach };
}

class SightRay {
  constructor(color, parent) {
    this.color = color;
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false }));
    this.shade = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: SCENE_COLORS.blocked, dashSize: 0.9, gapSize: 0.7, transparent: true, opacity: 0.85, toneMapped: false }));
    this.hit = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    this.halo = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 40), new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
    this.halo.renderOrder = 5;
    parent.add(this.beam, this.shade, this.hit, this.halo);
    this.state = null;
  }
  update(origin, direction, terrain, heightKm, length = 60) {
    const result = trace(terrain, direction, heightKm);
    const end = result.blocked ? result.point.clone() : origin.clone().addScaledVector(direction, length);
    const span = end.clone().sub(origin), len = span.length();
    this.beam.position.copy(origin).addScaledVector(span, 0.5);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize());
    this.length = len;
    this.hit.visible = this.halo.visible = this.shade.visible = result.blocked;
    if (result.blocked) {
      this.hit.position.copy(end); this.halo.position.copy(end);
      const beyond = Math.max(result.distance + 4, Math.min(length, result.distance * 1.6));
      this.shade.geometry.dispose();
      this.shade.geometry = new THREE.BufferGeometry().setFromPoints([end, origin.clone().addScaledVector(direction, beyond / Math.hypot(direction.x, direction.z))]);
      this.shade.computeLineDistances();
    }
    this.state = result;
    return result;
  }
  thickness(radius, camera) {
    this.beam.scale.set(radius, this.length, radius);
    this.hit.scale.setScalar(radius * 2.6);
    this.halo.scale.setScalar(radius * 2.6);
    this.halo.quaternion.copy(camera.quaternion);
    this.shade.material.dashSize = radius * 14; this.shade.material.gapSize = radius * 10;
  }
  set visible(v) { this.beam.visible = v; if (!v) { this.hit.visible = this.halo.visible = this.shade.visible = false; } else if (this.state) { this.hit.visible = this.halo.visible = this.shade.visible = this.state.blocked; } }
}

export class LunarScene {
  constructor(canvas, container, sites, onError, { t = (k) => k, onSite = null } = {}) {
    this.container = container; this.sites = sites; this.t = t; this.view = 'terrain'; this.dirty = true; this.disposed = false;
    this.lowPower = lowPower(); this.readingLight = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lowPower ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.0005, 6000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false; this.controls.addEventListener('change', () => this.invalidate());

    // Sunlight: one hard source, no sky. Shadows reach the context tile on capable machines.
    const reach = this.lowPower ? 75 : 125;
    this.sunlight = new THREE.DirectionalLight(0xfff4e0, 3.1); this.sunlight.castShadow = true;
    this.sunlight.shadow.mapSize.set(this.lowPower ? 2048 : 4096, this.lowPower ? 2048 : 4096);
    Object.assign(this.sunlight.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 1100 });
    this.sunlight.shadow.normalBias = 0.09; this.sunlight.shadow.bias = -0.0003;
    this.scene.add(this.sunlight, this.sunlight.target);
    // Reading light (off by default): earthlight from Earth's direction plus a faint sky fill.
    // It exists only to read relief in shadow; it is not physical and the UI says so.
    this.earthlight = new THREE.DirectionalLight(0x9fc4ff, 0); this.scene.add(this.earthlight, this.earthlight.target);
    this.fill = new THREE.HemisphereLight(0xb9c7d8, 0x000000, 0); this.scene.add(this.fill);

    this.localGroup = new THREE.Group(); this.globeGroup = new THREE.Group(); this.overlay = new THREE.Group();
    this.scene.add(this.localGroup, this.globeGroup); this.localGroup.add(this.overlay);
    this.globeGroup.visible = false;

    const loader = new THREE.TextureLoader();
    this.moonTexture = loader.load(asset('./assets/moon-color.jpg'), () => this.invalidate(), undefined, () => onError(t('error.moonTexture')));
    this.moonTexture.colorSpace = THREE.SRGBColorSpace; this.moonTexture.wrapS = THREE.RepeatWrapping;
    this.moonTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const earthTexture = loader.load(asset('./assets/earth-color.jpg'), () => this.invalidate(), undefined, () => onError(t('error.earthTexture')));
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    this.regolith = regolithNormalMap(this.lowPower ? 256 : 512);
    this.psrUniform = { value: 0 };
    this.terrainMaterial = lunarMaterial({ normalMap: this.regolith, normalScale: 0.42, psr: this.psrUniform });
    this.innerMaterial = lunarMaterial({ normalMap: this.regolith, normalScale: 0.5, psr: this.psrUniform });
    this.contextMaterial = lunarMaterial({ normalMap: null });

    // Earth: real angular size and phase (lit by the same sunlight), oriented by Greenwich sidereal
    // time so the side facing the Moon is the real one; clouds, and city lights only on the night side.
    const earthLights = loader.load(asset('./assets/earth-lights.png'), () => this.invalidate());
    earthLights.colorSpace = THREE.SRGBColorSpace;
    const earthClouds = loader.load(asset('./assets/earth-clouds.png'), () => this.invalidate());
    this.sunView = { value: new THREE.Vector3(0, 0, 1) };
    const earthMaterial = new THREE.MeshStandardMaterial({ map: earthTexture, roughness: 0.85, metalness: 0, emissive: 0xffc98a, emissiveMap: earthLights, emissiveIntensity: 1.6 });
    earthMaterial.onBeforeCompile = shader => {
      shader.uniforms.uSunView = this.sunView;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uSunView;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance *= smoothstep(.06, -.22, dot(normalize(vNormal), uSunView));`);
    };
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), earthMaterial);
    this.earth.add(new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 64), cloudMaterial(earthClouds)));
    this.earthGlow = glowSprite([[0, 'rgba(150,200,255,0)'], [0.36, 'rgba(150,200,255,0)'], [0.42, 'rgba(150,200,255,.55)'], [0.62, 'rgba(120,170,255,.12)'], [1, 'rgba(120,170,255,0)']], 3.2);
    this.earth.add(this.earthGlow);
    // Sun: disc at true angular size, a bright core and a wide soft bloom.
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfffbf0, toneMapped: false }));
    this.sun.add(glowSprite([[0, 'rgba(255,250,235,1)'], [0.08, 'rgba(255,240,200,.9)'], [0.22, 'rgba(255,225,150,.28)'], [1, 'rgba(255,215,120,0)']], 9));
    this.sun.add(glowSprite([[0, 'rgba(255,236,180,.22)'], [0.4, 'rgba(255,225,150,.06)'], [1, 'rgba(255,215,120,0)']], 40));
    this.localGroup.add(this.earth, this.sun);

    this.moon = new THREE.Mesh(new THREE.SphereGeometry(12, 192, 128), lunarMaterial({ vertexColors: false, map: this.moonTexture, color: 0xf2efe8 }));
    this.globeGroup.add(this.moon);
    this.makeGraticule();
    this.globeMarkers = sites.map(site => {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      marker.position.copy(bodyToScene(siteBasis(site).up).multiplyScalar(12.03)); marker.userData.siteId = site.id;
      this.globeGroup.add(marker); return marker;
    });
    this.siteLabels = sites.map((site, i) => {
      const el = document.createElement('div'); el.className = 'globe-site-label'; el.textContent = String(i + 1);
      el.setAttribute('aria-hidden', 'true'); container.append(el); return el;
    });
    // Compared sites, seen from the explored one: a pin on the relief, a label with the distance and a
    // faint line along the ground. All five points lie within 190 km of each other.
    this.onSite = onSite;
    this.sitePins = sites.map((site, i) => {
      const el = document.createElement('button'); el.type = 'button'; el.className = 'site-pin';
      el.innerHTML = `<b>${i + 1}</b><span></span><i></i><em aria-hidden="true"></em>`; el.addEventListener('click', () => this.onSite?.(site.id)); container.append(el);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      const link = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, toneMapped: false }));
      pin.visible = link.visible = false; this.overlay.add(pin, link);
      return { site, el, pin, link, base: new THREE.Vector3(), top: new THREE.Vector3(), km: 0, shown: false };
    });
    this.blockLabels = ['sun', 'earth'].map(body => {
      const el = document.createElement('div'); el.className = `block-label block-${body}`; el.setAttribute('aria-hidden', 'true');
      container.append(el); return el;
    });

    this.makeObserver();
    this.rays = { sun: new SightRay(SCENE_COLORS.sun, this.overlay), earth: new SightRay(SCENE_COLORS.earth, this.overlay) };
    this.paths = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, map: discTexture(), transparent: true, depthWrite: false, toneMapped: false }));
    this.paths.frustumCulled = false; this.localGroup.add(this.paths);
    this.horizonLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false, toneMapped: false }));
    this.horizonLine.renderOrder = 4; this.localGroup.add(this.horizonLine);

    loadStarCatalog().then(data => {
      if (!data || this.disposed) return;
      this.stars = createStarField(data, STAR_RADIUS);
      this.stars.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
      this.scene.add(this.stars); this.orientStars(); this.invalidate();
    });

    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container);
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.contextLost = true; onError(t('error.contextLost')); });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.invalidate(); });
    // In the surface view the wheel works like a lens: it changes the field of view.
    canvas.addEventListener('wheel', e => { if (this.view !== 'surface') return; e.preventDefault(); this.setFov(this.camera.fov * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    canvas.addEventListener('keydown', e => {
      if (!this.terrain) return;
      if (e.key === 'Home') { this.resetCamera(); e.preventDefault(); }
      if (e.key.startsWith('Arrow')) {
        const offset = this.camera.position.clone().sub(this.controls.target);
        const angle = e.key === 'ArrowLeft' ? 0.08 : e.key === 'ArrowRight' ? -0.08 : 0;
        if (angle) offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        else offset.multiplyScalar(e.key === 'ArrowUp' ? 0.9 : 1.1);
        this.camera.position.copy(this.controls.target).add(offset); this.controls.update(); e.preventDefault(); this.invalidate();
      }
    });
    this.render = () => {
      if (this.disposed) return;
      if (this.dirty && !this.suspended && !document.hidden && !this.contextLost) {
        this.controls.update(); this.updateThickness();
        this.sunView.value.copy(this.sunlight.position).normalize().transformDirection(this.camera.matrixWorldInverse);
        this.renderer.render(this.scene, this.camera); this.updateLabels(); this.dirty = false;
      }
      this.frame = requestAnimationFrame(this.render);
    };
    this.resize(); this.render();
  }

  makeObserver() {
    this.observer = new THREE.Group();
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 2, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.renderOrder = 5;
    this.observerPin = pin; this.observerRing = ring;
    this.observer.add(pin, ring); this.overlay.add(this.observer);
  }
  makeGraticule() {
    const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 });
    for (const lat of [-80, -85]) {
      const points = [];
      for (let lon = 0; lon <= 360; lon += 3) points.push(bodyToScene(siteBasis({ lat, lon }).up).multiplyScalar(12.015));
      this.globeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
    }
  }

  setTerrain(terrain) {
    if (this.terrain?.site.id === terrain.site.id && this.terrain.wide === terrain.wide && this.terrain.inner === terrain.inner) return;
    this.terrain = terrain;
    for (const mesh of [this.terrainMesh, this.contextMesh]) if (mesh) { this.localGroup.remove(mesh); mesh.geometry.dispose(); }
    this.terrainMesh = new THREE.Mesh(detailedTerrainGeometry(terrain, { stride: this.lowPower ? 2 : 1 }), this.terrainMaterial);
    this.terrainMesh.castShadow = this.terrainMesh.receiveShadow = true;
    this.localGroup.add(this.terrainMesh);
    if (this.innerMesh) { this.localGroup.remove(this.innerMesh); this.innerMesh.geometry.dispose(); this.innerMesh = null; }
    const inner = innerTerrainGeometry(terrain, { stride: this.lowPower ? 2 : 1 });
    if (inner) { this.innerMesh = new THREE.Mesh(inner, this.innerMaterial); this.innerMesh.castShadow = this.innerMesh.receiveShadow = true; this.localGroup.add(this.innerMesh); }
    const context = contextTerrainGeometry(terrain);
    if (context) {
      this.contextMesh = new THREE.Mesh(context, this.contextMaterial);
      this.contextMesh.castShadow = !this.lowPower; this.contextMesh.receiveShadow = true;
      this.localGroup.add(this.contextMesh);
    } else this.contextMesh = null;
    this.horizonKey = '';
    // Rays and horizon need the terrain: refresh them now if directions already arrived.
    if (this.result) this.update(this.result, this.date, this.heightM, this.selected);
    this.resetCamera(); this.invalidate();
  }

  setReadingLight(on) { this.readingLight = on; if (this.result) this.applyLights(); this.invalidate(); }
  setPsr(on) { this.psrUniform.value = on ? 1 : 0; this.invalidate(); }
  applyLights() {
    const r = this.result, globe = this.view === 'globe';
    if (globe) this.sunlight.position.copy(bodyToScene(unit(r.eph.sun)).multiplyScalar(450));
    else this.sunlight.position.copy(v3(r.sun.direction).multiplyScalar(450));
    this.sunlight.castShadow = !globe;
    // During an eclipse the Earth covers part or all of the Sun: the direct light falls with the covered share.
    this.sunlight.intensity = 3.1 * (1 - (r.sun.eclipse || 0));
    this.earthlight.position.copy(v3(r.earth.direction).multiplyScalar(450));
    this.earthlight.intensity = this.readingLight && !globe ? 0.55 : 0;
    this.fill.intensity = this.readingLight ? 0.35 : globe ? 0.04 : 0;
    this.sunlight.shadow.needsUpdate = true;
  }

  // result: evaluate() for the primary site. Sun and Earth sit far away along their directions.
  update(result, date, heightM, selected) {
    this.result = result; this.heightM = heightM; this.date = date; this.selected = selected;
    this.earth.position.copy(v3(result.earth.direction).multiplyScalar(BODY_DISTANCE));
    this.earth.scale.setScalar(BODY_DISTANCE * 6378.137 / result.earth.distanceKm);
    this.sun.position.copy(v3(result.sun.direction).multiplyScalar(BODY_DISTANCE));
    this.sun.scale.setScalar(BODY_DISTANCE * 695700 / result.sun.distanceKm);
    this.orientEarth(result, date);
    this.applyLights();
    this.globeMarkers.forEach(marker => { marker.visible = selected.includes(marker.userData.siteId); marker.scale.setScalar(marker.userData.siteId === result.siteId ? 1.8 : 1); });
    if (this.terrain) {
      const h = heightM / 1000, origin = new THREE.Vector3(0, h, 0);
      this.observer.position.set(0, 0, 0);
      this.rays.sun.update(origin, v3(result.sun.direction), this.terrain, h);
      this.rays.earth.update(origin, v3(result.earth.direction), this.terrain, h);
      this.updateHorizon(heightM);
    }
    this.placeSites(); this.orientStars(); this.applyView(); this.invalidate();
  }

  // Tangent-plane position of every other compared site, on the relief of the explored one.
  placeSites() {
    if (!this.terrain) return;
    const here = siteBasis(this.terrain.site), dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const key = `${this.terrain.site.id}|${(this.selected || []).join(',')}|${this.t('site.shackleton')}`;
    if (key === this.sitesKey) return; this.sitesKey = key;
    for (const p of this.sitePins) {
      p.shown = p.site.id !== this.terrain.site.id && (this.selected || []).includes(p.site.id);
      if (!p.shown) continue;
      const up = siteBasis(p.site).up, c = dot3(up, here.up), x = RADIUS_KM * dot3(up, here.east) / c, z = -RADIUS_KM * dot3(up, here.north) / c;
      p.km = RADIUS_KM * Math.acos(Math.min(1, c)); p.base.set(x, this.terrain.heightAt(x, z), z);
      const points = Array.from({ length: 65 }, (_, i) => { const k = i / 64; return new THREE.Vector3(x * k, this.terrain.heightAt(x * k, z * k) + 0.12, z * k); });
      p.link.geometry.dispose(); p.link.geometry = new THREE.BufferGeometry().setFromPoints(points);
      p.el.children[1].textContent = this.t(`site.${p.site.id}`); p.el.children[2].textContent = `${number(Math.round(p.km))} km`;
      p.el.setAttribute('aria-label', `${this.t(`site.${p.site.id}`)}, ${number(Math.round(p.km))} km`);
    }
  }

  // Earth-fixed -> J2000 by Greenwich sidereal time (precession ignored, ~0.4° in 2026),
  // then J2000 -> local scene axes (east, up, -north); the mesh maps lon 0 to +x and north to +y.
  orientEarth(result, date) {
    const astronomy = window.Astronomy; if (!astronomy || !this.terrain) return;
    const frame = result.eph.frame, b = siteBasis(this.terrain.site);
    const rx = combine(frame, b.east), ry = combine(frame, b.up), rz = combine(frame, b.north).map(x => -x);
    const toScene = new THREE.Matrix4().set(rx[0], rx[1], rx[2], 0, ry[0], ry[1], ry[2], 0, rz[0], rz[1], rz[2], 0, 0, 0, 0, 1);
    const spin = new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(astronomy.SiderealTime(date) * 15));
    const mesh = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
    this.earth.quaternion.setFromRotationMatrix(toScene.multiply(spin).multiply(mesh));
  }

  // paths: { sun: [{ direction, visible }], earth: [...] } for the coming hours.
  setPaths(paths) {
    const all = [...paths.sun.map(p => ['sun', p]), ...paths.earth.map(p => ['earth', p])];
    const position = new Float32Array(all.length * 3), color = new Float32Array(all.length * 3);
    const sun = new THREE.Color(SCENE_COLORS.sun), earth = new THREE.Color(SCENE_COLORS.earth), blocked = new THREE.Color(0x55554f);
    all.forEach(([body, p], i) => {
      position.set(v3(p.direction).multiplyScalar(PATH_RADIUS).toArray(), i * 3);
      const c = p.visible ? (body === 'sun' ? sun : earth) : blocked;
      color.set([c.r, c.g, c.b], i * 3);
    });
    this.paths.geometry.dispose();
    this.paths.geometry = new THREE.BufferGeometry();
    this.paths.geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    this.paths.geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    this.invalidate();
  }

  updateHorizon(heightM) {
    const key = `${this.terrain.site.id}|${heightM}`;
    if (key === this.horizonKey) return; this.horizonKey = key;
    const values = this.terrain.horizon(heightM), points = [];
    for (let i = 0; i < values.length; i++) {
      const az = THREE.MathUtils.degToRad(i / 2), el = THREE.MathUtils.degToRad(values[i]);
      points.push(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(HORIZON_RADIUS).add(new THREE.Vector3(0, heightM / 1000, 0)));
    }
    this.horizonLine.geometry.dispose();
    this.horizonLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
  }

  orientStars() {
    if (!this.stars || !this.result || !this.terrain) return;
    const frame = this.result.eph.frame;
    if (this.view === 'globe') setRotationRows(this.stars, frame.x, frame.z, frame.y.map(x => -x));
    else {
      const b = siteBasis(this.terrain.site);
      setRotationRows(this.stars, combine(frame, b.east), combine(frame, b.up), combine(frame, b.north).map(x => -x));
    }
  }

  applyView() {
    const local = this.view !== 'globe';
    this.localGroup.visible = local; this.globeGroup.visible = !local;
    this.rays.sun.visible = this.rays.earth.visible = this.view === 'terrain';
    this.observer.visible = this.view === 'terrain';
    this.horizonLine.visible = this.view === 'surface';
    this.paths.visible = local && !this.telephoto;
    for (const p of this.sitePins) { p.pin.visible = local && p.shown && !this.telephoto; p.link.visible = this.view === 'terrain' && p.shown; }
    if (this.stars) this.stars.material.uniforms.uOpacity.value = this.view === 'terrain' ? 0.55 : 0.9;
  }

  setView(view) {
    this.view = view; this.applyView();
    if (this.result) { this.applyLights(); this.orientStars(); }
    this.resetCamera();
  }

  resetCamera() {
    if (!this.terrain) return;
    const surface = this.view === 'surface', globe = this.view === 'globe';
    this.controls.enablePan = this.view === 'terrain';
    this.controls.minDistance = globe ? 13 : surface ? 0.00005 : 2;
    this.controls.maxDistance = globe ? 60 : surface ? 0.0001 : 160;
    this.controls.minPolarAngle = surface ? 0.08 : 0.02;
    this.controls.maxPolarAngle = globe ? Math.PI - 0.005 : surface ? Math.PI - 0.08 : Math.PI * 0.485;
    this.camera.up.set(0, 1, 0); this.controls.rotateSpeed = 1; this.controls.enableZoom = !surface; this.telephoto = false; this.paths.visible = this.view !== 'globe';
    if (globe) {
      this.controls.target.set(0, 0, 0);
      const u = bodyToScene(siteBasis(this.terrain.site).up); u.x += 0.2; u.z += 0.3;
      this.camera.position.copy(u.normalize().multiplyScalar(32)); this.camera.fov = 40;
    } else if (surface) {
      this.camera.fov = 60;
      const direction = this.result?.sun.direction || [0, 0.02, -1];
      this.controls.target.set(0, this.heightM / 1000, 0);
      const flat = new THREE.Vector3(direction[0], 0.06, direction[2]).normalize();
      this.camera.position.copy(this.controls.target).sub(flat.multiplyScalar(0.00008));
    } else {
      // Behind the observer, slightly off the sunline: grazing light reads the relief best.
      this.camera.fov = 42;
      const d = this.result?.sun.direction || [0.7, 0.02, 0.7];
      const toward = new THREE.Vector3(d[0], 0, d[2]).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.32);
      this.controls.target.set(toward.x * 6, 0, toward.z * 6);
      this.camera.position.set(-toward.x * 38, 9.5, -toward.z * 38);
    }
    this.camera.updateProjectionMatrix(); this.controls.update(); this.invalidate();
  }

  focus(body) {
    if (!this.result) return;
    if (this.view === 'globe') this.setView('terrain');
    const direction = v3(this.result[body].direction);
    this.controls.target.set(0, this.heightM / 1000, 0);
    if (this.view === 'surface') {
      // Telephoto: Earth spans ~1.9° from the Moon; a ~3° field fills the view with its real phase.
      this.camera.position.copy(this.controls.target).sub(direction.multiplyScalar(0.00008));
      this.setFov(body === 'earth' ? 3 : 14);
    }
    else {
      const flat = new THREE.Vector3(direction.x, 0, direction.z).normalize();
      this.camera.position.set(-flat.x * 30, 7, -flat.z * 30);
    }
    this.controls.update(); this.invalidate();
  }

  setFov(fov) {
    this.camera.fov = THREE.MathUtils.clamp(fov, 1.5, 75); this.telephoto = this.camera.fov < 20; this.applyView();
    this.controls.rotateSpeed = Math.min(1, this.camera.fov / 60); this.camera.updateProjectionMatrix(); this.invalidate();
  }

  updateThickness() {
    // Site pins keep a constant apparent size, whatever their distance.
    if (this.view !== 'globe') for (const p of this.sitePins) {
      if (!p.shown) continue;
      const r = Math.max(0.006, this.camera.position.distanceTo(p.base) * 0.0016 * (this.camera.fov / 42)), h = r * 30;
      p.pin.scale.set(r, h, r); p.pin.position.copy(p.base).setY(p.base.y + h / 2); p.top.copy(p.base).setY(p.base.y + h);
    }
    if (this.view !== 'terrain') return;
    const r = Math.max(0.008, this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0)) * 0.0021);
    this.rays.sun.thickness(r, this.camera); this.rays.earth.thickness(r, this.camera);
    this.observerPin.scale.set(r * 0.8, r * 22, r * 0.8); this.observerPin.position.y = r * 11;
    this.observerRing.scale.setScalar(r * 2.4);
    this.paths.material.size = this.lowPower ? 3 : 3.6;
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect(); if (!width || !height) return;
    this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.invalidate();
  }

  project(position) {
    const p = position.clone().project(this.camera), w = this.container.clientWidth, h = this.container.clientHeight;
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, visible: p.z < 1 && p.z > -1 && Math.abs(p.x) < 0.96 && Math.abs(p.y) < 0.92 };
  }
  updateLabels() {
    const local = this.view !== 'globe';
    for (const body of ['sun', 'earth']) {
      const label = document.getElementById(`${body}Label`); if (!label) continue;
      if (!local || !this.result || this.telephoto) { label.style.opacity = '0'; continue; }
      const p = this.project(this[body].position);
      label.style.opacity = p.visible ? '1' : '0'; label.style.transform = `translate(${p.x + 14}px,${p.y - 14}px)`;
    }
    ['sun', 'earth'].forEach((body, i) => {
      const el = this.blockLabels[i], state = this.rays[body].state;
      if (this.view !== 'terrain' || !state?.blocked) { el.style.opacity = '0'; return; }
      const p = this.project(state.point);
      el.textContent = this.t(`scene.blocked.${body}`, { d: distance(state.distance) });
      el.style.opacity = p.visible ? '1' : '0'; el.style.transform = `translate(${p.x + 12}px,${p.y + 10}px)`;
    });
    // Site labels never leave the picture: outside the free area of the scene they stick to its edge
    // and an arrow points the way.
    if (local && !this.telephoto && this.sitePins.some(p => p.shown)) {
      const box = this.container.getBoundingClientRect(), w = box.width, h = box.height;
      const rect = sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.top < box.bottom && r.bottom > box.top && r.left < box.right ? r : null; };
      const answer = rect('.answer'), deck = rect('.console'), title = rect('.stage-title');
      const right = (answer ? answer.left - box.left : w) - 12, bottom = (deck ? deck.top - box.top - 62 : h) - 12;
      for (const p of this.sitePins) {
        if (!p.shown) { p.el.classList.remove('shown'); p.el.style.opacity = '0'; continue; }
        const view = p.top.clone().applyMatrix4(this.camera.matrixWorldInverse), ndc = p.top.clone().project(this.camera);
        let x = (ndc.x * 0.5 + 0.5) * w, y = (-ndc.y * 0.5 + 0.5) * h;
        if (view.z > 0) { const k = 4 / Math.max(1e-6, Math.hypot(ndc.x, ndc.y)); x = (-ndc.x * k * 0.5 + 0.5) * w; y = (ndc.y * k * 0.5 + 0.5) * h; }
        const ew = p.el.offsetWidth || 170, eh = 28;
        let lx = Math.min(Math.max(x - 14, 12), right - ew), ly = Math.min(Math.max(y - 32, 12), bottom - eh);
        if (title && lx < title.right - box.left + 8 && ly < title.bottom - box.top + 8) ly = Math.min(title.bottom - box.top + 8, bottom - eh);
        const off = Math.abs(lx - (x - 14)) > 2 || Math.abs(ly - (y - 32)) > 2;
        p.el.classList.toggle('off', off); p.el.classList.add('shown'); p.el.style.opacity = '1';
        p.el.style.transform = `translate(${lx}px,${ly}px)`;
        if (off) p.el.lastElementChild.style.transform = `rotate(${Math.atan2(y - (ly + eh / 2), x - (lx + ew / 2))}rad)`;
      }
    } else for (const p of this.sitePins) { p.el.classList.remove('shown'); p.el.style.opacity = '0'; }
    this.siteLabels.forEach((el, i) => {
      const marker = this.globeMarkers[i];
      if (local || !marker.visible) { el.style.opacity = '0'; return; }
      const world = marker.getWorldPosition(new THREE.Vector3());
      const facing = world.clone().normalize().dot(this.camera.position.clone().normalize()) > 0.05;
      const p = this.project(world);
      el.style.opacity = p.visible && facing ? '1' : '0'; el.style.transform = `translate(${p.x + 8}px,${p.y - 22}px)`;
    });
  }
  invalidate() { this.dirty = true; }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.controls.dispose(); this.renderer.dispose();
    [...this.siteLabels, ...this.blockLabels, ...this.sitePins.map(p => p.el)].forEach(el => el.remove());
  }
}
