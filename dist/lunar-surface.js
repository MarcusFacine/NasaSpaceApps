import * as THREE from 'three';

// Display photometry: Hapke-style unresolved facet shadowing (23 degree mean slope), shadow hiding
// and coherent backscatter. McEwen's lunar-Lambert term retains the existing flat-ground exposure.
// Roughness masks opposite-facing grazing facets; shared shadow paths cancel near opposition.
// Approximation, not a fitted Hapke inversion: Chang'e-3 PCAM (doi:10.1051/0004-6361/202143012)
// resolves separate shadow-hiding / coherent-backscatter peaks; the latter must remain narrower.
export const REGOLITH_ROUGHNESS_DEG = 23, REGOLITH_SHOE_WIDTH = 0.06, REGOLITH_SHOE_STRENGTH = 0.65;
export const REGOLITH_CBOE_WIDTH = 0.004, REGOLITH_CBOE_STRENGTH = 0.18;
export const CRATER_FRESH_FRACTION = 0.022, CRATER_DEGRADED_START = 0.008, CRATER_DEGRADED_END = 0.075;
const PHOTOMETRY_GLSL = `
float lunarPhotometry(vec3 n,vec3 l,vec3 v){
  float ni=clamp(dot(n,l),0.,1.),ne=clamp(dot(n,v),.001,1.);
  float phase=acos(clamp(dot(l,v),-1.,1.)),halfPhase=tan(min(phase*.5,1.55));
  float k=mix(1.,2./max(ni+ne,.08),clamp(1.-.45*phase,.2,1.));
  vec3 li=l-n*ni,ve=v-n*ne;
  float si=sqrt(max(1.-ni*ni,0.)),se=sqrt(max(1.-ne*ne,0.));
  float az=clamp(dot(li,ve)/max(si*se,1e-5),-1.,1.);
  float facets=${Math.tan(REGOLITH_ROUGHNESS_DEG * Math.PI / 180).toFixed(8)}*min(si/max(ni,.018),se/max(ne,.018));
  float rough=1./(1.+.28*facets*(1.-az));
  float shoe=${REGOLITH_SHOE_STRENGTH.toFixed(4)}/(1.+halfPhase/${REGOLITH_SHOE_WIDTH.toFixed(4)});
  float cb=halfPhase/${REGOLITH_CBOE_WIDTH.toFixed(4)};
  float surge=1.+shoe+${REGOLITH_CBOE_STRENGTH.toFixed(4)}/((1.+cb)*(1.+cb));
  return min(k,3.2)*rough*surge;
}
#ifndef REGOLITH
float regolithSunCast(vec3 l){return 1.;}
#endif`;
const LUNAR_DIFFUSE = `reflectedLight.directDiffuse += irradiance*regolithSunCast(directLight.direction)*lunarPhotometry(geometryNormal,directLight.direction,geometryViewDir)*BRDF_Lambert( material.diffuseColor );`;

// Regolith detail: one periodic tile (dist/assets/regolith/regolith.webp, made by scripts/make-regolith.py) of surface
// slopes (RG) and height (B): self-affine relief, small degraded craters, clods and pebbles. The ground reads it at
// four scales, each turned by its own angle so the repeats never line up: 2.5 m (pebbles 0.4-5 cm), 18 m, 130 m and
// 950 m. Hardware mipmaps average the slopes away with distance, so nothing sparkles; the Hapke roughness of
// lunarPhotometry carries what the pixel no longer resolves. On the ground the two finest scales also cast their own
// shadows: a short march toward the Sun over the height channel (a 1 cm clod throws a 20 cm shadow at a 3° Sun),
// softened by the 0.53° solar disc. Rocks use the same tile on their own faces, without shadows.
export const REGOLITH = Object.freeze({
  slopeRange: 3, heightRange: 0.0306,           // tile units, from make-regolith.py
  groundTilesKm: [0.0025, 0.0183, 0.134, 0.95], groundGain: [.85, .6, .4, .25], groundAngles: [0, 1.13, 2.41, 3.67],
  rockTiles: [1.3, 7.1], rockGain: [.7, .45], rockAngles: [.4, 1.9],
  albedo: .13, shadowSteps: [.004, .01, .02, .036, .06, .1],
});
const placeholder = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); placeholder.needsUpdate = true;
export const REGOLITH_UNIFORMS = { uRegolith: { value: placeholder }, uRegolithSun: { value: new THREE.Vector3(0, 1, 0) } };
const regolithWaiting = new Set();
let regolithRequested = false;
// The tile loads once, on first use; materials draw flat until then. onLoad: called when it arrives (redraw).
export function loadRegolith(onLoad = null, anisotropy = 8) {
  if (REGOLITH_UNIFORMS.uRegolith.value !== placeholder) return;
  if (onLoad) regolithWaiting.add(onLoad);
  if (regolithRequested) return; regolithRequested = true;
  new THREE.TextureLoader().load(new URL('./assets/regolith/regolith.webp', import.meta.url).href, texture => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = anisotropy; texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.needsUpdate = true;
    REGOLITH_UNIFORMS.uRegolith.value = texture; for (const fn of regolithWaiting) fn(); regolithWaiting.clear();
  });
}
const f4 = v => v.toFixed(5);
// GLSL for one mode: 'ground' (local frame in km, Sun shadows) or 'rock' (unit rock geometry).
function regolithGLSL(mode) {
  const ground = mode === 'ground', tiles = ground ? REGOLITH.groundTilesKm : REGOLITH.rockTiles, gains = ground ? REGOLITH.groundGain : REGOLITH.rockGain, angles = ground ? REGOLITH.groundAngles : REGOLITH.rockAngles;
  const layer = (i) => {
    const c = Math.cos(angles[i]), sn = Math.sin(angles[i]), shadow = ground && i < 2;
    return `{
    mat2 R=mat2(${f4(c)},${f4(sn)},${f4(-sn)},${f4(c)});vec2 uv=R*gp/${f4(tiles[i])}+vec2(${f4(i * .37)},${f4(i * .71)});
    vec4 t=texture2D(uRegolith,uv);vec2 g=(t.rg*(255./127.)-128./127.)*${f4(REGOLITH.slopeRange)};
    slope+=${f4(gains[i])}*(transpose(R)*g);rel+=${f4(gains[i])}*(t.b-.5);
    ${shadow ? `// The pixel footprint in texels fades the layer's shadows once its pebbles fall below a pixel.
    float fade=1.-smoothstep(.6,2.,fp/${f4(tiles[i] / 1024)});
    if(fade>0.&&sunUp){
      vec2 sd=R*sunDir;float vis=1.;
      ${REGOLITH.shadowSteps.map(d => `{float over=(texture2D(uRegolith,uv+sd*${f4(d)}).b-t.b)*${f4(REGOLITH.heightRange * gains[i])}-${f4(d)}*tanE;float pen=${f4(d * .0093 + .0004)};vis=min(vis,1.-smoothstep(-pen,pen,over));}`).join('\n      ')}
      shade*=mix(1.,vis,fade);
    }` : ''}
  }`;
  };
  return `{
  vec2 gp=vRegolithPos.xz,slope=vec2(0.);float rel=0.,shade=1.;
  float fp=max(max(length(dFdx(gp)),length(dFdy(gp))),1e-9);
  ${ground ? `vec3 sunL=normalize(uRegolithSun);float sunFlat=length(sunL.xz);vec2 sunDir=sunL.xz/max(sunFlat,1e-6);
  float tanE=sunL.y/max(sunFlat,1e-4);bool sunUp=sunL.y>-.01;` : ''}
  ${tiles.map((_, i) => layer(i)).join('\n  ')}
  vec3 gn=normalMatrix*vec3(slope.x,0.,slope.y);gn/=max(length(normalMatrix[0]),1e-10);
  gn-=normal*dot(gn,normal);vec3 dn=normal-gn;normal=dn*inversesqrt(max(dot(dn,dn),1e-12));
  diffuseColor.rgb*=clamp(1.+${f4(REGOLITH.albedo)}*rel*2.,.75,1.25);
  ${ground ? 'regolithShadow=shade;' : ''}
}`;
}
const REGOLITH_COMMON = `uniform sampler2D uRegolith;
uniform vec3 uRegolithSun;
varying vec3 vRegolithPos;
float regolithShadow=1.;
// Only the Sun (the light along uRegolithSun) is shaded by the clods.
float regolithSunCast(vec3 l){return dot(l,normalize((viewMatrix*vec4(uRegolithSun,0.)).xyz))>.9999?regolithShadow:1.;}`;

// ---------------------------------------------------------------------------------------------------
// Opt-in additions for the mission (all off by default: the explorer's Moon is unchanged).
//
// Lunar space. Every mesh of the Moon (globe, LOLA patch, local tiles, landing site) can map its object
// space into one common frame: Moon-fixed, km, three.js axes (body x, y, z -> x, z, -y), the frame the
// mission globe uses. Procedural craters live on that frame, so the same crater sits at the same place
// on the globe from orbit, on the LOLA patch during the descent and on the ground: nothing swims.
// To keep float32 precision at metre scale, the translation is split into whole 64 km lattice cells
// (cells, integers) and a remainder kept in the matrix.
export const LATTICE_KM = 64;
export function lunarSpace(matrix = new THREE.Matrix4()) {
  const space = { matrix: { value: new THREE.Matrix4() }, cells: { value: new THREE.Vector3() } };
  space.set = m => {
    const t = new THREE.Vector3().setFromMatrixPosition(m), cells = t.clone().divideScalar(LATTICE_KM).round();
    space.cells.value.copy(cells); space.matrix.value.copy(m).setPosition(t.sub(cells.multiplyScalar(LATTICE_KM)));
    return space;
  };
  return space.set(matrix);
}
// The mission globe: object units of 1000 km, object axes = Moon-fixed axes.
export const globeSpace = (unitKm = 1000) => lunarSpace(new THREE.Matrix4().makeScale(unitKm, unitKm, unitKm));
// A site's local frame (km; x east, y up, z south; y = 0 at groundKm from the centre), as the mission's
// local group and LOLA patch use it. basis: siteBasis(site) (Moon-fixed arrays). groundKm: the same value
// the mission uses for the patch, RADIUS_KM + elevationKm − terrain.height(0, 0).
export function siteSpace(basis, groundKm) {
  const v = a => new THREE.Vector3(a[0], a[2], -a[1]), up = v(basis.up);
  return lunarSpace(new THREE.Matrix4().makeBasis(v(basis.east), up, v(basis.north).negate()).setPosition(up.multiplyScalar(groundKm)));
}

// Earthshine. Seen from the Moon the Earth shows the complementary phase: its phase angle αE (angle
// Sun–Earth–Moon) is 180° minus the angle between the Sun and the Earth seen from the Moon, and its lit
// fraction is (1 + cos αE) / 2. Illuminance it sends to the Moon, relative to sunlight:
//   E_earth / E_sun = p · (R_E / d)² · Φ(αE),  Φ(α) = (sin α + (π − α) cos α) / π (Lambert sphere)
// with p = 0.367 (geometric albedo of the Earth), R_E = 6371 km, d = Earth–Moon distance: ≈ 1.0e-4 at
// full Earth (≈ 13 lx against 1.3e5 lx), the value Danjon's and Goode's earthshine measurements imply.
// On this scene's scale (sunlight irradiance 3.2) full Earth is ≈ 3.2e-4: invisible next to sunlit
// ground, as in Apollo frames exposed for daylight. boost is an artistic licence for readability (the
// eye adapts, an exposure meter opens up); the caller must state it.
export const EARTH_GEOMETRIC_ALBEDO = 0.367;
// Colour of earthlight relative to the scene's sunlight: the Earth reflects blue better than red
// (Rayleigh sky, oceans); measured earthshine spectra give roughly +10 % blue, −5 % red. Linear RGB.
export const EARTHSHINE_COLOR = new THREE.Color().setRGB(0.93, 1.0, 1.12, THREE.LinearSRGBColorSpace);
export const earthPhaseFunction = a => (Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI;
export const earthIlluminatedFraction = phaseAngle => (1 + Math.cos(phaseAngle)) / 2;
export function earthshineIrradiance(phaseAngle, distanceKm = 384400, boost = 1, sunIrradiance = 3.2) {
  const a = Math.min(Math.PI, Math.max(0, phaseAngle));
  return sunIrradiance * EARTH_GEOMETRIC_ALBEDO * (6371 / distanceKm) ** 2 * earthPhaseFunction(a) * boost;
}
// Shared uniforms; direction: unit vector from the Moon towards the Earth in lunar-space axes (the
// mission globe's object axes). intensity: irradiance on the sunlight scale (earthshineIrradiance).
export function earthshineUniforms() {
  return { direction: { value: new THREE.Vector3(0, 0, 1) }, color: { value: EARTHSHINE_COLOR.clone() }, intensity: { value: 0 } };
}

// Procedural crater detail. Octave L has square cells of 2^L km on the three axis planes of lunar space
// (a cube map around the Moon: each point uses the face of its dominant axis). Each cell holds one crater,
// its centre placed at random where the whole crater (ejecta included) stays inside the cell, so a point
// only looks at its own cell: one table read per octave (integrated GPUs pay for every octave at every
// pixel, so the per-octave cost is what matters). Distances are measured on the tangent plane of the
// surface (the projected offset is lifted along the face axis), so craters stay round on the sphere and
// on slopes. Near a cube edge both faces are searched and each crater is drawn by the face of its own
// centre, so no seam cuts a crater. With one crater per cell and the cell halving each octave, the
// cumulative density follows N(>D) ∝ D^-2, the equilibrium slope of small lunar craters (Gault 1970;
// Xiao & Werner 2015); inside an octave the rim radius follows the same power law (0.06 to 0.15 cell).
// A quarter of the cells stay empty, so the spacing is not too even. Ages are uniform: a few per cent are
// fresh (simple bowl, depth/D ≈ 0.2, rim height ≈ 0.036 D, Pike 1977; ejecta thickness ∝ r^-3, McGetchin
// et al. 1973; brighter, immature ejecta), most are degraded by diffusion into shallow hollows with low,
// broad rims (depth/D 0.005–0.15, most of them shallow; Fassett & Thomson 2014). Each
// crater adds an exact slope (bump normal), its own shadow (the ray towards the Sun tested against the rim
// it must clear, with the penumbra of the 0.53° solar disc) and, when fresh, a brighter albedo. Octaves
// fade by the pixel footprint (no shimmer) and above baseKm, where the texture or mesh already carries
// the relief. Display only.
// lattices: 2 doubles the craters (a second lattice offset by half a cell) for ~+1.8 ms on a full-screen
// globe on the Intel iGPU; the presets use 1 to keep space shots above 45 fps. Only the globe and the
// orbital ring may use 2: the ground meshes must stay at 1, like the landing-site geometry they meet.
export const DETAIL_GLOBE = { coarseKm: 32, fineKm: 0.125, baseKm: 2.7, lattices: 1 };   // 4096 px LROC/LOLA maps: 2.7 km/px
export const DETAIL_PATCH = { coarseKm: 32, fineKm: 0.125, baseKm: 1.6, lattices: 1 };   // orbital patch, 480 m DEM on a 1.56 km grid
export const DETAIL_CONTEXT = { coarseKm: 16, fineKm: 0.0625, baseKm: 1.6 };
export const DETAIL_TILE = { coarseKm: 2, fineKm: 0.0156, baseKm: 0.13 };   // 100 km tile, 130 m grid
export const DETAIL_INNER = { coarseKm: 0.5, fineKm: 0.0039, baseKm: 0.04 }; // 20 km tile, 40 m grid
// Landing site: its craters above geometryKm are real geometry (craterField); the material adds their shadows
// (a grazing Sun defeats the shadow map on flat ground) and draws the smaller craters in full. macroNormal: the
// mesh carries the uncratered LOLA normal in a 'lunarNormal' attribute, the reference plane of every crater.
export const DETAIL_GROUND = { coarseKm: 0.5, fineKm: 0.00098, baseKm: 0, geometryKm: 0.02, macroNormal: true };
function detailLevels({ coarseKm = 16, fineKm = 0.0625, geometryKm = 0, lattices = 1 } = {}) {
  const hi = Math.min(6, Math.round(Math.log2(coarseKm))), lo = Math.min(hi, Math.round(Math.log2(fineKm)));
  return { hi, count: hi - lo + 1, geo: geometryKm > 0 ? Math.round(Math.log2(geometryKm)) : 99, lattices: Math.max(1, Math.min(2, lattices | 0)) };
}
// uniform vec4: relief strength, albedo strength, shadow strength, baseKm (0 = none). Tunable at runtime
// through material.userData.lunarDetail.value.
const detailVector = ({ strength = 1, albedo = 1, shadows = 1, baseKm = 0 } = {}) => new THREE.Vector4(strength, albedo, shadows, baseKm);

// Crater table: 512 × 512 float RGBA, one crater per entry: centre u, v inside its cell (cell units,
// placed so the crater with its ejecta fits in the cell), rim radius r (cell units), and depth class +
// age (integer part 0..15 -> degraded depth, fraction -> age). Made once from xorshift32 with a fixed seed,
// read with texelFetch by the shader and from the same array by the CPU: shader and landing-site geometry
// agree exactly. An octave's lattice repeats after 512 cells; octaves and faces read the table at
// different offsets.
const TABLE = 512, mod512 = x => x - TABLE * Math.floor(x / TABLE);
// Smoothstep of its own, independent of the helpers further down.
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const crispness = age => sstep(CRATER_DEGRADED_START, CRATER_DEGRADED_END, age), reachOf = (r, age) => r * (2.3 - 0.4 * crispness(age)) * 1.12;
// Built on first use only (the explorer, which uses none of this, never pays for it).
let TABLE_DATA = null;
const tableData = () => TABLE_DATA || (TABLE_DATA = (() => {
  const d = new Float32Array(TABLE * TABLE * 4); let s = 0x2545F491;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 8) / 16777216; };
  for (let i = 0; i < TABLE * TABLE; i++) {
    // A quarter of the cells stay empty (centre moved out of reach): gaps break the even spacing.
    const r = 0.06 / Math.sqrt(1 - 0.84 * rnd()), age = rnd(), reach = reachOf(r, age), depth = Math.floor(rnd() * 16), empty = rnd() < 0.25;
    d.set([Math.fround(empty ? 9 : reach + rnd() * (1 - 2 * reach)), Math.fround(reach + rnd() * (1 - 2 * reach)), Math.fround(r), Math.fround(depth + age)], i * 4);
  }
  return d;
})());
let craterTexture = null;
export function craterTable() {
  if (!craterTexture) {
    craterTexture = new THREE.DataTexture(tableData(), TABLE, TABLE, THREE.RGBAFormat, THREE.FloatType);
    craterTexture.minFilter = craterTexture.magFilter = THREE.NearestFilter; craterTexture.generateMipmaps = false; craterTexture.needsUpdate = true;
  }
  return craterTexture;
}
// Faces: 0 = x (plane y,z), 1 = y (plane x,z), 2 = z (plane x,y).
const dominant = (x, y, z) => { const a = Math.abs(x), b = Math.abs(y), c = Math.abs(z); return a >= b && a >= c ? 0 : b >= c ? 1 : 2; };
const plane = (x, y, z, f) => f === 0 ? [y, z] : f === 1 ? [x, z] : [x, y];
// Table offset of an octave on a face (keeps octaves and faces independent).
const tableOffset = (L, face, negative) => [mod512((L + 20) * 97 + face * 211 + (negative ? 53 : 0)), mod512((L + 20) * 61 + face * 137 + (negative ? 29 : 0))];

// One crater, shared by GLSL and JS (same numbers). rho: distance from the centre in rim radii; heights
// in rim radii. Fresh: parabolic bowl from the floor (−0.33) to the rim crest (+0.072) at rho = 1, then
// ejecta 0.072·rho^-3. Degraded: −deep·(rho²−1)·e^(−1.5 rho²), a hollow with a low, broad rim at
// rho ≈ 1.29. wa (0 fresh .. 1 degraded) blends them; both taper to zero over [re − 0.8, re].
const CRATER_GLSL = `
vec2 lunarPlane(vec3 p,int f){return f==0?p.yz:f==1?p.xz:p.xy;}
// Irregular second/third harmonics vary the rim without drawing repeated perfect ellipses.
float lunarContour(vec2 q,float r2,float seed){
  return max(0.,r2+.12*sin(seed*7.17)*(q.x*q.x-q.y*q.y)+.08*cos(seed*11.19)*q.x*(q.x*q.x-3.*q.y*q.y)/max(sqrt(max(r2,0.)),.02));
}
// p2 = rho². Returns the height h and g = (dh/drho)/rho (no square root on the common, degraded path).
void lunarCrater(float p2,float wa,float deep,float re,out float h,out float g){
  float ts=re-.8,k=1./(re*re-ts*ts),u=clamp((p2-ts*ts)*k,0.,1.),t=1.-u*u*(3.-2.*u),gt=-12.*u*(1.-u)*k;
  float e=exp(-1.5*p2),ho=deep*(p2-1.)*e;
  h=ho*t;g=deep*e*(5.-3.*p2)*t+ho*gt;
  if(wa<1.){
    float hf,gf;
    if(p2<1.){hf=-.33+.402*p2;gf=.804;}
    else{float r3=1./(p2*sqrt(p2));hf=.072*r3*t;gf=.072*r3*(gt-3.*t/p2);}
    h=mix(hf,h,wa);g=mix(gf,g,wa);
  }
}`;
function lunarCrater(rho, wa, deep, re) {
  const p2 = rho * rho, ts = re - 0.8, u = Math.min(1, Math.max(0, (p2 - ts * ts) / (re * re - ts * ts))), t = 1 - u * u * (3 - 2 * u);
  const hf = p2 < 1 ? -0.33 + 0.402 * p2 : 0.072 / (p2 * rho) * t;
  const ho = deep * (p2 - 1) * Math.exp(-1.5 * p2) * t;
  return hf + (ho - hf) * wa;
}
function lunarContour(x, y, r2, seed) {
  return Math.max(0, r2 + .12 * Math.sin(seed * 7.17) * (x * x - y * y) + .08 * Math.cos(seed * 11.19) * x * (x * x - 3 * y * y) / Math.max(Math.sqrt(Math.max(r2, 0)), .02));
}
const freshness = age => 1 - smooth(0, CRATER_FRESH_FRACTION, age);

// Fragment code of the crater field. Needs lunarSpace uniforms/varyings, normalMatrix and uCraterTable.
const DETAIL_GLSL = (hi, count, geo, lattices) => `{
  vec3 lp=vLunarPos,up=normalize(vLunarUp);
  // Pixel footprint in km (screen derivatives of the lunar-space position).
  float fp=max(max(length(dFdx(lp)),length(dFdy(lp))),1e-7);
  mat3 toView=normalMatrix*transpose(mat3(uLunarSpace));toView*=1./max(length(toView[0]),1e-30);
  vec3 sunD=up;float sunOn=0.;
  #if NUM_DIR_LIGHTS > 0
  lunarSunView=directionalLights[0].direction;sunD=normalize(transpose(toView)*lunarSunView);sunOn=1.;
  #endif
  float su=dot(sunD,up);vec3 sh=sunD-su*up;float shl=length(sh);vec3 sdir=sh/max(shl,1e-6);float tanE=su/max(shl,1e-3);
  bool casting=sunOn>0.&&su>0.&&uLunarDetail.z>0.;
  // Sun below the local horizon of the mesh: a slope facing away from a low Sun shades itself and
  // everything on it (crater walls turned towards the Sun included). Relief rising above the mean surface
  // keeps the light about a degree longer (a 1 km rim sees the Sun 1.9° past the terminator).
  float horizon=sunOn>0.?mix(1.,smoothstep(-.018,.004,su),uLunarDetail.z):1.;
  // Cube faces: the dominant axis of the Moon-centred position, the next one, and the distance (km) to their edge.
  vec3 T=lp+uLunarCells*${LATTICE_KM}.,aT=abs(T);int fa,fb;float a1,a2;
  if(aT.x>=aT.y&&aT.x>=aT.z){fa=0;a1=aT.x;fb=aT.y>=aT.z?1:2;a2=max(aT.y,aT.z);}
  else if(aT.y>=aT.z){fa=1;a1=aT.y;fb=aT.x>=aT.z?0:2;a2=max(aT.x,aT.z);}
  else{fa=2;a1=aT.z;fb=aT.x>=aT.y?0:1;a2=max(aT.x,aT.y);}
  float seamKm=(a1-a2)*.7071;
  vec3 grad=vec3(0.);float shade=1.,bright=0.;
  for(int f=0;f<2;f++){
    int face=f==0?fa:fb;
    // Plane coordinates and the lift onto the tangent plane, once per face.
    float tf=face==0?T.x:face==1?T.y:T.z,nf=face==0?up.x:face==1?up.y:up.z;nf=(nf<0.?-1.:1.)*max(abs(nf),.2);
    vec2 P=lunarPlane(lp,face),K=-lunarPlane(up,face)/nf,C=lunarPlane(uLunarCells,face),off=vec2(float(face)*211.,float(face)*137.)+(tf<0.?vec2(53.,29.):vec2(0.));
    for(int i=0;i<${count};i++){
      int L=${hi}-i;float cell=exp2(float(L));
      bool band=seamKm<.5*cell;if(f==1&&!band)continue;
      float w=smoothstep(12.,26.,cell/fp);
      if(uLunarDetail.w>0.)w*=1.-smoothstep(10.,24.,cell/uLunarDetail.w);
      if(w<.004)continue;
      vec2 sm=mod(C*exp2(float(${Math.log2(LATTICE_KM)}-L)),512.)+off+vec2(float(L+20)*97.,float(L+20)*61.);
      for(int lat=0;lat<${lattices};lat++){
      // Lattices beyond the first are offset by half a cell and read the table elsewhere: denser, less even fields.
      vec2 g=P/cell+float(lat)*.5,cl=floor(g);
      vec4 c=texelFetch(uCraterTable,ivec2(mod(cl+sm+vec2(float(lat)*263.,float(lat)*389.),512.)),0);
      // Offset from the crater centre, lifted from the face plane onto the tangent plane (km).
      vec2 qp=(g-cl-c.xy)*cell;
      vec3 t=face==0?vec3(dot(K,qp),qp):face==1?vec3(qp.x,dot(K,qp),qp.y):vec3(qp,dot(K,qp));
      float age=fract(c.w),wa=smoothstep(${CRATER_DEGRADED_START.toFixed(4)},${CRATER_DEGRADED_END.toFixed(4)},age),re=2.3-.4*wa,irk=1./(c.z*cell),p20=dot(t,t)*irk*irk;
      vec2 contour=qp*irk;float p2=lunarContour(contour,p20,c.w);
      if(p2>re*re)continue;
      if(band){vec3 A=abs(T-t);if((A.x>=A.y&&A.x>=A.z?0:A.y>=A.z?1:2)!=face)continue;}
      float k=floor(c.w),deep=.012+.00065*k*k,ch,cg;
      lunarCrater(p2,wa,deep,re,ch,cg);
      bool geo=L>${geo};   // crater already in the mesh: shadow only
      if(!geo)grad+=(w*cg*irk)*t;
      // Fresh craters: immature, brighter interior and ejecta.
      if(age<${CRATER_FRESH_FRACTION.toFixed(4)}&&!geo)bright+=w*(1.-smoothstep(0.,${CRATER_FRESH_FRACTION.toFixed(4)},age))*(p2<1.?.6+.3*p2:.9/(p2*sqrt(sqrt(p2)))*(1.-smoothstep((re-.8)*(re-.8),re*re,p2)));
      // Horizon samples on the irregular bowl/rim, with the 0.2665 degree solar half-angle.
      float rc=1.+.29*wa;
      if(casting&&c.z*cell>fp){
        float b=dot(t,sdir)*irk,te=-b+sqrt(max(b*b-p20+rc*rc,0.)),ridge=-1e3;
        for(int ray=0;ray<3;ray++){
          float d=max(te*(.55+.225*float(ray)),.025),hh,hg;
          lunarCrater(lunarContour(contour+lunarPlane(sdir,face)*d,max(p20+2.*b*d+d*d,0.),c.w),wa,deep,re,hh,hg);
          ridge=max(ridge,(hh-ch)/d);
        }
        float pen=.00465+fp*irk/max(te,.1)*.65;
        float visible=smoothstep(ridge-pen,ridge+pen,tanE);
        // Pixel integration softens the unresolved rim; the profile determines the lit interior.
        shade*=1.-w*uLunarDetail.z*(1.-visible);
      }
      }
    }
    if(seamKm>.5*exp2(float(${hi})))break;
  }
  vec3 nn=normal-uLunarDetail.x*(toView*grad);normal=nn*inversesqrt(max(dot(nn,nn),1e-12));
  diffuseColor.rgb*=1.+uLunarDetail.y*.32*min(bright,1.5);
  lunarSunShadow=clamp(shade*horizon,0.,1.);
}`;

// The crater of octave L that reaches the lunar-space point p (km) on a surface of normal u, if any:
// fn({ r (km), wa, re, age, deep }, t (offset from its centre on the tangent plane, km), rho).
// Allocation-free: the landing site calls it for every vertex and octave.
const CRATER = { r: 0, wa: 0, re: 0, age: 0, deep: 0 }, OFFSET = [0, 0, 0], LOG_LATTICE = Math.log2(LATTICE_KM);
function eachCrater(px, py, pz, ux, uy, uz, L, cells, fn) {
  const cell = 2 ** L, k = 2 ** (LOG_LATTICE - L), T0 = px + cells.x * LATTICE_KM, T1 = py + cells.y * LATTICE_KM, T2 = pz + cells.z * LATTICE_KM;
  const A0 = Math.abs(T0), A1 = Math.abs(T1), A2 = Math.abs(T2), fa = A0 >= A1 && A0 >= A2 ? 0 : A1 >= A2 ? 1 : 2;
  const fb = fa === 0 ? (A1 >= A2 ? 1 : 2) : fa === 1 ? (A0 >= A2 ? 0 : 2) : (A0 >= A1 ? 0 : 1);
  const band = ((fa === 0 ? A0 : fa === 1 ? A1 : A2) - (fb === 0 ? A0 : fb === 1 ? A1 : A2)) * 0.7071 <= 0.5 * cell;
  for (let f = 0; f < (band ? 2 : 1); f++) {
    const face = f ? fb : fa;
    let pu, pv, au, av, cu0, cv0, n, tf;
    if (face === 0) { pu = py; pv = pz; au = uy; av = uz; cu0 = cells.y; cv0 = cells.z; n = ux; tf = T0; }
    else if (face === 1) { pu = px; pv = pz; au = ux; av = uz; cu0 = cells.x; cv0 = cells.z; n = uy; tf = T1; }
    else { pu = px; pv = py; au = ux; av = uy; cu0 = cells.x; cv0 = cells.y; n = uz; tf = T2; }
    const nf = (n < 0 ? -1 : 1) * Math.max(Math.abs(n), 0.2), neg = tf < 0;
    const ou = (L + 20) * 97 + face * 211 + (neg ? 53 : 0), ov = (L + 20) * 61 + face * 137 + (neg ? 29 : 0);
    const gu = pu / cell, gv = pv / cell, cu = Math.floor(gu), cv = Math.floor(gv);
    const i = (mod512(cv + mod512(cv0 * k) + ov) * TABLE + mod512(cu + mod512(cu0 * k) + ou)) * 4, d = TABLE_DATA || tableData();
    const qu = (gu - cu - d[i]) * cell, qv = (gv - cv - d[i + 1]) * cell, qn = -(au * qu + av * qv) / nf;
    if (face === 0) { OFFSET[0] = qn; OFFSET[1] = qu; OFFSET[2] = qv; } else if (face === 1) { OFFSET[0] = qu; OFFSET[1] = qn; OFFSET[2] = qv; } else { OFFSET[0] = qu; OFFSET[1] = qv; OFFSET[2] = qn; }
    const w = d[i + 3], age = w - Math.floor(w), wa = crispness(age), re = 2.3 - 0.4 * wa, rk = d[i + 2] * cell;
    const q2 = lunarContour(qu / rk, qv / rk, (OFFSET[0] ** 2 + OFFSET[1] ** 2 + OFFSET[2] ** 2) / (rk * rk), w); if (q2 > re * re) continue;
    if (band && dominant(T0 - OFFSET[0], T1 - OFFSET[1], T2 - OFFSET[2]) !== face) continue;
    CRATER.r = rk; CRATER.wa = wa; CRATER.re = re; CRATER.age = age; CRATER.deep = 0.012 + 0.00065 * Math.floor(w) ** 2;
    fn(CRATER, OFFSET, Math.sqrt(q2));
  }
}
const lunarPoint = (e, x, y, z) => [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
const lunarNormal = (e, x, y, z) => { const n = [e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z], l = Math.hypot(...n) || 1; return n.map(c => c / l); };

// CPU version of the same crater field (height in km along the normal, albedo boost) for geometry: the
// landing site carries the coarser octaves as real relief. space: lunarSpace(); x, y, z and the normal
// nx, ny, nz in that space's object frame (km).
export function craterField(space, { coarseKm = 0.25, fineKm = 0.004, strength = 1 } = {}) {
  const { hi, count } = detailLevels({ coarseKm, fineKm }), e = space.matrix.value.elements, cells = space.cells.value;
  let height = 0, bright = 0;
  const add = (c, t, rho) => {
    height += lunarCrater(rho, c.wa, c.deep, c.re) * c.r * strength;
    if (c.age < CRATER_FRESH_FRACTION) bright += freshness(c.age) * (rho < 1 ? 0.6 + 0.3 * rho * rho : 0.9 / (rho * rho * Math.sqrt(rho)) * (1 - smooth((c.re - 0.8) ** 2, c.re * c.re, rho * rho)));
  };
  const out = { height: 0, bright: 0 };
  return (x, y, z, nx, ny, nz) => {
    const px = e[0] * x + e[4] * y + e[8] * z + e[12], py = e[1] * x + e[5] * y + e[9] * z + e[13], pz = e[2] * x + e[6] * y + e[10] * z + e[14];
    let ux = e[0] * nx + e[4] * ny + e[8] * nz, uy = e[1] * nx + e[5] * ny + e[9] * nz, uz = e[2] * nx + e[6] * ny + e[10] * nz; const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    height = 0; bright = 0;
    for (let i = 0; i < count; i++) eachCrater(px, py, pz, ux, uy, uz, hi - i, cells, add);
    out.height = height; out.bright = Math.min(bright, 1.5) * 0.32; return out;
  };
}
// Crater records of the same field inside a local square (for rocks): centre (local km), rim radius (km),
// age (0 fresh .. 1). height(x, z): local surface height, to follow the ground.
export function craterList(space, half, { coarseKm = 0.25, fineKm = 0.008, up = [0, 1, 0], height = () => 0 } = {}) {
  const { hi, count } = detailLevels({ coarseKm, fineKm }), e = space.matrix.value.elements, cells = space.cells.value, out = [];
  const inv = new THREE.Matrix4().copy(space.matrix.value).invert(), [ux, uy, uz] = lunarNormal(e, ...up), p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const L = hi - i, cell = 2 ** L, seen = new Set();
    // Walk the square at a fifth of a cell: every crater is met from some sample inside its reach.
    for (let x = -half; x <= half; x += cell / 5) for (let z = -half; z <= half; z += cell / 5) {
      const [px, py, pz] = lunarPoint(e, x, height(x, z), z);
      eachCrater(px, py, pz, ux, uy, uz, L, cells, (c, t) => {
        p.set(px - t[0], py - t[1], pz - t[2]); const key = `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)},${Math.round(p.z * 1e5)}`; if (seen.has(key)) return; seen.add(key);
        p.applyMatrix4(inv); if (Math.abs(p.x) <= half && Math.abs(p.z) <= half) out.push({ x: p.x, z: p.z, r: c.r, age: c.age });
      });
    }
  }
  return out;
}

// psr: optional shared uniform { value: 0..1 } that makes permanently shadowed ground glow faintly.
export const PSR_COLOR = new THREE.Color(0x8a7dff);
// normalY: +1 for image normal maps (north up), −1 for the generated tiles. hole: { dir, cos } uniforms that
// cut a spherical cap out of a globe (object space), where a finer mesh takes over. transparent: per-vertex alpha.
// Opt-in (mission): space: lunarSpace() of the mesh (object -> lunar space); earthshine: earthshineUniforms();
// detail: one of the DETAIL_* presets, or { coarseKm, fineKm (octave range), baseKm (resolution of the texture
// or mesh: larger craters fade out), lattices (1|2), geometryKm (craters above it are in the mesh: shadows
// only), macroNormal (use the 'lunarNormal' attribute), strength, albedo, shadows (runtime: material.userData
// .lunarDetail.value = (strength, albedo, shadows, baseKm)) }. Needs space, else the object frame in km.
// grain: true (ground: local x/z in km, four scales from 2.5 m to 950 m, clod shadows toward REGOLITH_UNIFORMS
// .uRegolithSun) or 'rock' (unit rock geometry, no shadows). The tile loads on first use (loadRegolith).
export function lunarMaterial({ vertexColors = true, map = null, normalMap = null, normalScale = 0.5, normalY = -1, color = 0xffffff, psr = null, hole = null, transparent = false, space = null, earthshine = null, detail = null, grain = false } = {}) {
  const material = new THREE.MeshLambertMaterial({ color, vertexColors, map, normalMap, normalScale: new THREE.Vector2(normalScale, normalY * normalScale), transparent });
  const lunar = space || earthshine || detail || grain ? space || lunarSpace() : null, levels = detail ? detailLevels(detail) : null;
  if (detail) material.userData.lunarDetail = { value: detailVector(detail) };
  const grainMode = grain === 'rock' ? 'rock' : 'ground';
  if (grain) { material.defines = { ...material.defines, REGOLITH: '' }; loadRegolith(); }
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${PHOTOMETRY_GLSL}`);
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
    if (lunar) {
      shader.uniforms.uLunarSpace = lunar.matrix; shader.uniforms.uLunarCells = lunar.cells;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform mat4 uLunarSpace;
uniform vec3 uLunarCells;
#ifndef USE_NORMALMAP_OBJECTSPACE
uniform mat3 normalMatrix;
#endif`);
    }
    if (detail) {
      shader.uniforms.uLunarDetail = material.userData.lunarDetail; shader.uniforms.uCraterTable = { value: craterTable() };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform mat4 uLunarSpace;
${detail.macroNormal ? 'attribute vec3 lunarNormal;' : ''}
varying vec3 vLunarPos;
varying vec3 vLunarUp;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vLunarPos = (uLunarSpace * vec4(transformed, 1.)).xyz;
vLunarUp = mat3(uLunarSpace) * ${detail.macroNormal ? 'lunarNormal' : 'objectNormal'};`);
      // The crater shadow applies to the Sun only (directional light 0); every other light passes.
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform vec4 uLunarDetail;
varying vec3 vLunarPos;
varying vec3 vLunarUp;
float lunarSunShadow = 1.;
vec3 lunarSunView = vec3(0.);
float lunarCast(vec3 l) { return dot(l, lunarSunView) > .99999 ? lunarSunShadow : 1.; }
uniform sampler2D uCraterTable;
${CRATER_GLSL}`).replace('irradiance*lunarPhotometry(geometryNormal,directLight.direction,geometryViewDir)', 'irradiance*lunarCast(directLight.direction)*lunarPhotometry(geometryNormal,directLight.direction,geometryViewDir)')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${DETAIL_GLSL(levels.hi, levels.count, levels.geo, levels.lattices)}`);
    }
    if (grain) {
      shader.uniforms.uRegolith = REGOLITH_UNIFORMS.uRegolith; shader.uniforms.uRegolithSun = REGOLITH_UNIFORMS.uRegolithSun;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRegolithPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegolithPos = transformed;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${REGOLITH_COMMON}`)
        .replace('#include <emissivemap_fragment>', `${regolithGLSL(grainMode)}\n#include <emissivemap_fragment>`);
    }
    if (earthshine) {
      // Earthlight with the same lunar-Lambert photometry as sunlight; no shadows (the Earth's disc is
      // 2° wide and at the poles it grazes the horizon: a known simplification).
      shader.uniforms.uEarthDir = earthshine.direction; shader.uniforms.uEarthColor = earthshine.color; shader.uniforms.uEarthIntensity = earthshine.intensity;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uEarthDir;
uniform vec3 uEarthColor;
uniform float uEarthIntensity;`).replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
if (uEarthIntensity > 0.) {
  vec3 esD = normalMatrix * (transpose(mat3(uLunarSpace)) * uEarthDir), esL = esD * inversesqrt(max(dot(esD, esD), 1e-30));
  float esNL = saturate(dot(normal, esL));
  reflectedLight.directDiffuse += uEarthColor * (uEarthIntensity * esNL * lunarPhotometry(normal, esL, geometryViewDir)) * BRDF_Lambert(material.diffuseColor);
}`);
    }
  };
  const extra = `${grain ? `-reg${grainMode}` : ''}${earthshine ? '-es' : ''}${detail ? `-d${levels.hi}.${levels.count}.${levels.geo}.${levels.lattices}${detail.macroNormal ? 'm' : ''}` : ''}${lunar && !detail && !earthshine ? '-space' : ''}`;
  material.customProgramCacheKey = () => `lunar-regolith-5-${psr ? 'psr' : 'plain'}-${hole ? 'hole' : 'whole'}${extra}`;
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
  return 0.62 + 0.08 * Math.min(1, slope * 2.2) + (patch - 0.5) * 0.025;
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
