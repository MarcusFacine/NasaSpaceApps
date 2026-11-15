import * as THREE from 'three';

// Bright-star sky from the HYG v4.1 catalogue (CC BY-SA 4.0), magnitude <= 6.
// Positions are J2000 equatorial unit vectors; each scene supplies the rotation
// from J2000 into its own frame. The Moon has no atmosphere: stars do not twinkle.
let catalog = null;
export function loadStarCatalog() {
  catalog ??= fetch(new URL('./data/stars.json', import.meta.url)).then(r => (r.ok ? r.json() : null)).catch(() => null);
  return catalog;
}

const BV_STOPS = [[-0.4, [0.62, 0.72, 1]], [0, [0.8, 0.86, 1]], [0.4, [1, 0.98, 0.95]], [0.8, [1, 0.9, 0.74]], [1.3, [1, 0.8, 0.58]], [2, [1, 0.68, 0.42]]];
function bvColor(bv) {
  if (bv <= BV_STOPS[0][0]) return BV_STOPS[0][1];
  for (let i = 1; i < BV_STOPS.length; i++) {
    const [b1, c1] = BV_STOPS[i];
    if (bv <= b1) {
      const [b0, c0] = BV_STOPS[i - 1], t = (bv - b0) / (b1 - b0);
      return c0.map((c, k) => c + (c1[k] - c) * t);
    }
  }
  return BV_STOPS.at(-1)[1];
}

export function createStarField(data, radius = 900) {
  const stars = data.stars, n = stars.length;
  const position = new Float32Array(n * 3), color = new Float32Array(n * 3), size = new Float32Array(n);
  stars.forEach(([ra, dec, mag, bv], i) => {
    const a = THREE.MathUtils.degToRad(ra), d = THREE.MathUtils.degToRad(dec);
    position.set([Math.cos(d) * Math.cos(a) * radius, Math.cos(d) * Math.sin(a) * radius, Math.sin(d) * radius], i * 3);
    // Brightness falls by 2.512 per magnitude; a floor keeps faint stars as a soft field.
    const flux = Math.min(1, Math.max(0.14, Math.pow(2.512, -(mag + 0.5) / 2.2)));
    color.set(bvColor(bv).map(c => c * flux), i * 3);
    size[i] = Math.min(4.6, Math.max(1.1, 3.9 - mag * 0.52));
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 }, uOpacity: { value: 1 } },
    vertexShader: `attribute float aSize;attribute vec3 color;uniform float uPixelRatio;varying vec3 vColor;
      void main(){vColor=color;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=aSize*uPixelRatio;}`,
    fragmentShader: `uniform float uOpacity;varying vec3 vColor;
      void main(){vec2 p=gl_PointCoord-.5;float d=length(p);float a=smoothstep(.5,.08,d);if(a<.01)discard;gl_FragColor=vec4(vColor*a*uOpacity,1.);}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
  });
  const points = new THREE.Points(geometry, material);
  points.matrixAutoUpdate = false; points.frustumCulled = false; points.renderOrder = -10;
  return points;
}

// Rows are the scene axes written as J2000 vectors.
export function setRotationRows(points, rx, ry, rz) {
  points.matrix.set(rx[0], rx[1], rx[2], 0, ry[0], ry[1], ry[2], 0, rz[0], rz[1], rz[2], 0, 0, 0, 0, 1);
  points.matrixWorldNeedsUpdate = true;
}

// J2000 -> body-fixed rows (prime, y, pole) combined with a body-fixed basis vector.
export const combine = (frame, v) => [0, 1, 2].map(j => v[0] * frame.x[j] + v[1] * frame.y[j] + v[2] * frame.z[j]);
