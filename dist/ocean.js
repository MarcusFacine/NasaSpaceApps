// The open ocean of the recovery area (and the Atlantic beside the launch pad), its sky and a trade-wind cumulus deck.
//
// Sea surface: a Tessendorf (2001) FFT ocean evaluated on the GPU every frame. The waves follow the Elfouhaily et al.
// (1997) unified directional spectrum for the wind (gravity and capillary ranges, fully developed sea) plus a narrow
// swell, with the deep-water dispersion of gravity-capillary waves. Four periodic tiles split the spectrum by scale:
// two 500-700 m tiles of different sizes share the dominant waves (each with half of their energy: the sum has the same
// statistics and no visible repetition), then 79 m and 12 m tiles down to 24 cm. Everything shorter is not drawn as
// geometry or normals but enters the BRDF as slope variance, and so does whatever a pixel averages of the resolved
// waves (LEAN mapping: mip-mapped first and second moments of the slopes). This is the "seamless transition from
// geometry to BRDF" of Bruneton, Neyret & Holzschuch 2010: at a few metres the glitter is individual facets, at the
// horizon it is the Cox & Munk (1954) sun glint. The total slope variance is held to Cox & Munk's for the wind.
// Light: Fresnel reflection of the physical sky (the sky-view tables of earth-render.js, Hillaire 2020, seen from sea
// level), the Sun's glint with Smith masking-shadowing, the water-leaving radiance of clear oligotrophic water
// (remote-sensing reflectance of Morel & Maritorena 2001), whitecaps where the surface converges (Jacobian of the
// choppy displacement) at the coverage of Monahan & O'Muircheartaigh 1980, and aerial perspective to a true curved
// horizon. Units: scene km (1 unit = 1 km, sea level y = 0); waves in metres. Radiance scale of the mission: solar
// irradiance 3.2, a white Lambert surface facing the Sun reads ~1.
import * as THREE from 'three';
import { EARTH_RADIUS } from './mission-model.js';

const G = 9.81, KM = 370, CM = .23;                    // gravity; wavenumber (rad/m) and speed (m/s) of the capillary minimum
const N = 128, LOG_N = 7, LOOP = 1024;                 // tile resolution; time loop of the dispersion (s, see spectrum pass)
// Tiles: size (m), band of wavenumbers (rad/m) and share of the spectral energy.
const TILES = [{ L: 731, lo: 0, hi: .45, share: .5 }, { L: 523, lo: 0, hi: .45, share: .5 }, { L: 79.2, lo: .45, hi: 3.6, share: 1 }, { L: 12.4, lo: 3.6, hi: 26, share: 1 }];
const K_MAX = TILES[TILES.length - 1].hi;
const SUN_RADIUS = .004652, MOON_RADIUS = .0045;     // angular radii (rad)
// Remote-sensing reflectance Rrs = Lw/Ed (1/sr) of clear subtropical Pacific water (Chl ~0.05-0.1 mg/m3), read for the
// sRGB channels from the Case-1 model of Morel & Maritorena (2001): ~0.010 in the blue, ~0.0035 in the green, ~0.0007 in
// the red. It is what makes the open ocean dark navy rather than black (checked against NASA S72-55834 / S72-36293:
// sea sRGB ~(3, 20, 57) and (12, 37, 56) seen from the recovery aircraft; this model gives ~(3, 18, 48)).
const RRS = [.0007, .0035, .010];
const MOON_FULL = 2.5e-6, NIGHT_EXPOSURE = 3e4;      // full-Moon / solar irradiance; night exposure (licence, as earth-render.js)
const CLOUD = { base: .65, sigma: 60, g: .85 };      // trade cumulus: base (km), extinction (1/km: LWC ~0.5 g/m3, r_eff ~9 um), asymmetry

// ---------------------------------------------------------------------------------------------------------------
// Spectrum (CPU, once).
const dispersion = k => Math.sqrt(G * k * (1 + (k / KM) ** 2));
// Elfouhaily et al. 1997, fully developed (inverse wave age 0.84): omnidirectional S(k) (m^3) and the spreading Delta(k).
function elfouhaily(k, U10, Omega = .84) {
  const c = dispersion(k) / k, kp = G * (Omega / U10) ** 2, cp = dispersion(kp) / kp;
  const z0 = 3.7e-5 * U10 * U10 / G * Math.pow(U10 / cp, .9), us = .41 * U10 / Math.log(10 / z0);
  const Lpm = Math.exp(-1.25 * (kp / k) ** 2), gamma = Omega < 1 ? 1.7 : 1.7 + 6 * Math.log10(Omega);
  const sigma = .08 * (1 + 4 / Omega ** 3), Gam = Math.exp(-((Math.sqrt(k / kp) - 1) ** 2) / (2 * sigma * sigma));
  const Fp = Lpm * Math.pow(gamma, Gam) * Math.exp(-Omega / Math.sqrt(10) * (Math.sqrt(k / kp) - 1));
  const Bl = .5 * .006 * Math.pow(Omega, .55) * (cp / c) * Fp;
  const am = .01 * (us < CM ? 1 + Math.log(us / CM) : 1 + 3 * Math.log(us / CM));
  const Bh = .5 * am * (CM / c) * Math.exp(-.25 * (k / KM - 1) ** 2) * Lpm;
  const Delta = Math.tanh(Math.log(2) / 4 + 4 * Math.pow(c / cp, 2.5) + .13 * us / CM * Math.pow(CM / c, 2.5));
  return [(Bl + Bh) / k ** 3, Delta];
}
// Swell: Gaussian in frequency (sigma 6% of the peak) and direction (sigma 0.2 rad), significant height Hs (m), period T (s).
function swellSpectrum(k, Hs, T) {
  if (!(Hs > 0)) return 0;
  const w = Math.sqrt(G * k), wp = 2 * Math.PI / T, s = .06 * wp;
  return (Hs * Hs / 16) * Math.exp(-.5 * ((w - wp) / s) ** 2) / (Math.sqrt(2 * Math.PI) * s) * G / (2 * w);
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const normalPair = r => { const u = Math.max(r(), 1e-12), v = r(), m = Math.sqrt(-2 * Math.log(u)); return [m * Math.cos(2 * Math.PI * v), m * Math.sin(2 * Math.PI * v)]; };
// Inverse of the standard normal upper tail: z with P(Z > z) = p (bisection; once).
function normalTail(p) { let lo = 0, hi = 8; for (let i = 0; i < 60; i++) { const z = (lo + hi) / 2, q = .5 * erfc(z / Math.SQRT2); if (q > p) lo = z; else hi = z; } return (lo + hi) / 2; }
function erfc(x) { const t = 1 / (1 + .5 * Math.abs(x)), y = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (.37409196 + t * (.09678418 + t * (-.18628806 + t * (.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-.82215223 + t * .17087277))))))))); return x >= 0 ? y : 2 - y; }

// Initial amplitudes h0(k) of every tile, in the wind frame (x downwind, z crosswind). h0 = sqrt(P dk^2)(a + ib)/sqrt(2)
// with P = half the one-sided directional spectrum: with the Hermitian partner the realised variance is the spectrum's.
function buildSpectrum({ wind, swell, seed }) {
  const r = rng(seed), data = new Float32Array(N * N * TILES.length * 4), modes = [], tileVar = TILES.map(() => [0, 0]);
  const sw = swell && swell.height > 0 ? { ...swell, dir: swell.dir } : null;
  let divVar = 0;
  TILES.forEach((tile, c) => {
    const dk = 2 * Math.PI / tile.L, amp = new Float32Array(N * N * 2);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const n = i < N / 2 ? i : i - N, m = j < N / 2 ? j : j - N;
      if (i === N / 2 || j === N / 2) continue;                       // Nyquist row and column have no partner
      const kx = n * dk, kz = m * dk, k = Math.hypot(kx, kz);
      if (k < Math.max(tile.lo, 1e-9) || k >= tile.hi) continue;
      let P = 0;
      if (kx > 0) { const [S, D] = elfouhaily(k, wind), cos2 = (kx * kx - kz * kz) / (k * k); P += S / k * (1 + D * cos2) / (2 * Math.PI); }
      if (sw) { let d = Math.atan2(kz, kx) - sw.dir; d = Math.atan2(Math.sin(d), Math.cos(d)); P += .5 * swellSpectrum(k, sw.height, sw.period) / k * Math.exp(-.5 * (d / .2) ** 2) / (Math.sqrt(2 * Math.PI) * .2); }
      if (!(P > 0)) continue;
      const a = Math.sqrt(P * tile.share) * dk / Math.SQRT2, [g1, g2] = normalPair(r), o = (j * N + i) * 2;
      amp[o] = a * g1; amp[o + 1] = a * g2;
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = (j * N + i) * 2, p = ((c * N + j) * N + i) * 4, mi = (N - i) % N, mj = (N - j) % N, om = (mj * N + mi) * 2;
      data[p] = amp[o]; data[p + 1] = amp[o + 1]; data[p + 2] = amp[om]; data[p + 3] = amp[om + 1];
      const e = amp[o] * amp[o] + amp[o + 1] * amp[o + 1]; if (!e) continue;
      const n = i < N / 2 ? i : i - N, m = j < N / 2 ? j : j - N, kx = n * 2 * Math.PI / tile.L, kz = m * 2 * Math.PI / tile.L, k = Math.hypot(kx, kz);
      if (c < 3) divVar += 2 * k * k * e;   // variance of the horizontal convergence (per unit choppiness): what breaks
      tileVar[c][0] += 2 * kx * kx * e; tileVar[c][1] += 2 * kz * kz * e;
      if (c < 2) modes.push([kx, kz, amp[o], amp[o + 1], e]);
    }
  });
  // The strongest travelling waves of the two big tiles, for the CPU heave of floating objects.
  modes.sort((a, b) => b[4] - a[4]);
  return { data, divVar, tileVar, modes: modes.slice(0, 160) };
}
// Slope variances (along and across the wind) of the spectrum between k0 and k1.
function slopeVariance(wind, k0, k1) {
  let x = 0, z = 0; const n = 600;
  for (let i = 0; i < n; i++) { const a = k0 * Math.pow(k1 / k0, i / n), b = k0 * Math.pow(k1 / k0, (i + 1) / n), k = Math.sqrt(a * b), [S, D] = elfouhaily(k, wind); x += k * k * S * (.5 + D / 4) * (b - a); z += k * k * S * (.5 - D / 4) * (b - a); }
  return [x, z];
}

// Tileable value noise, 4 independent octave sets in RGBA (gusts, foam texture, cloud detail).
function noiseTexture(size = 256) {
  const hash = (x, y, s) => { let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const noise = (x, y, p, s) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, w = k => ((k % p) + p) % p, sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf); const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s), c = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s); return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let ch = 0; ch < 4; ch++) {
    let v = 0, a = .5, base = [4, 8, 16, 32][ch]; for (let o = 0; o < 4; o++) { const p = base << o; v += a * noise(x / size * p, y / size * p, p, ch * 7 + o + 1); a *= .5; }
    data[(y * size + x) * 4 + ch] = Math.min(255, v / .9375 * 255);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}

// ---------------------------------------------------------------------------------------------------------------
// GPU FFT: the four tiles stacked in a 128 x 512 atlas, two complex fields per RGBA texel, two textures (MRT).
const FFT_VERTEX = 'in vec3 position; void main(){ gl_Position = vec4(position.xy, 0., 1.); }';
const FFT_HEAD = `precision highp float; precision highp int; precision highp sampler2D;
const float TAU = 6.28318530718, NF = ${N}.;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
`;
// h(k,t) = h0(k) e^{-iwt} + conj(h0(-k)) e^{iwt}, then the eight real fields as four complex spectra:
// (h + i Dx), (Dz + i dh/dx), (dh/dz + i dDx/dx), (dDz/dz + i dDx/dz). D = i (k/|k|) h, chop applied (displaced crests
// x - chop*A sin: compressed, as Gerstner waves). Dispersion: w quantised to multiples of 2pi/LOOP so that the phase can
// be taken as fract(n * t/LOOP) with t/LOOP < 1 (float precision stays at 1e-4 rad for any clock time; frequencies move
// by <= 0.003 rad/s).
const SPECTRUM_PASS = `${FFT_HEAD}
uniform sampler2D uH0; uniform float uTau, uChop; uniform vec4 uL;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy); int tile = px.y / ${N};
  float L = tile == 0 ? uL.x : tile == 1 ? uL.y : tile == 2 ? uL.z : uL.w;
  vec2 m = vec2(float(px.x), float(px.y - tile * ${N})); m -= NF * step(NF * .5, m);
  vec2 k = TAU * m / L; float kl = length(k);
  vec4 h0 = texelFetch(uH0, px, 0);
  float w = sqrt(9.81 * kl * (1. + kl * kl / 136900.)), n = floor(w * ${LOOP}. / TAU + .5), ph = TAU * fract(n * uTau);
  vec2 e = vec2(cos(ph), sin(ph));
  vec2 h = cmul(h0.xy, vec2(e.x, -e.y)) + cmul(vec2(h0.z, -h0.w), e), ih = vec2(-h.y, h.x);
  float inv = kl > 0. ? 1. / kl : 0.;
  vec2 Dx = uChop * k.x * inv * ih, Dz = uChop * k.y * inv * ih, Sx = k.x * ih, Sz = k.y * ih;
  vec2 Jxx = -uChop * k.x * k.x * inv * h, Jzz = -uChop * k.y * k.y * inv * h, Jxz = -uChop * k.x * k.y * inv * h;
  o0 = vec4(h.x - Dx.y, h.y + Dx.x, Dz.x - Sx.y, Dz.y + Sx.x);
  o1 = vec4(Sz.x - Jxx.y, Sz.y + Jxx.x, Jzz.x - Jxz.y, Jzz.y + Jxz.x);
}`;
// Stockham radix-2 pass of the inverse DFT (natural order in and out, no bit reversal), along rows or tile columns.
const BUTTERFLY_PASS = `${FFT_HEAD}
uniform sampler2D uA, uB; uniform float uS;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
#ifdef VERTICAL
  int idx = px.y % ${N}, base = px.y - idx;
#else
  int idx = px.x;
#endif
  float index = float(idx), even = floor(index / uS) * uS * .5 + mod(index, uS * .5), arg = TAU * mod(index, uS) / uS;
  vec2 tw = vec2(cos(arg), sin(arg));
#ifdef VERTICAL
  ivec2 pe = ivec2(px.x, base + int(even)), po = ivec2(px.x, base + int(even) + ${N / 2});
#else
  ivec2 pe = ivec2(int(even), px.y), po = ivec2(int(even) + ${N / 2}, px.y);
#endif
  vec4 a = texelFetch(uA, pe, 0), b = texelFetch(uA, po, 0), c = texelFetch(uB, pe, 0), d = texelFetch(uB, po, 0);
  o0 = vec4(a.xy + cmul(tw, b.xy), a.zw + cmul(tw, b.zw));
  o1 = vec4(c.xy + cmul(tw, d.xy), c.zw + cmul(tw, d.zw));
}`;
// Per tile: displacement (Dx, h, Dz, convergence dDx/dx + dDz/dz) and slope moments (sx, sz, sx^2, sz^2), mip-mapped.
const FINAL_PASS = `${FFT_HEAD}
uniform sampler2D uA, uB; uniform int uTile;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy) + ivec2(0, uTile * ${N});
  vec4 a = texelFetch(uA, px, 0), b = texelFetch(uB, px, 0);
  o0 = vec4(a.y, a.x, a.z, b.y + b.z);
  o1 = vec4(a.w, b.x, a.w * a.w, b.x * b.x);
}`;

// ---------------------------------------------------------------------------------------------------------------
// Shared GLSL: sky-view lookups (the layout of earth-render.js), the sea BRDF, aerial perspective.
const SKY_GLSL = (vw, vh) => /* glsl */`
#define O_PI 3.14159265359
const float V_W = ${vw}., V_H = ${vh}.;
// Sky-view table of earth-render.js (Hillaire 2020): rows by nadir angle (packed towards the horizon), columns by
// azimuth from the Sun; left half in-scattered radiance, right half transmittance. One table per observer.
float oNadir(vec3 d, vec3 up) { return atan(length(cross(d, up)), -dot(d, up)); }
void oView(sampler2D lut, vec3 up, vec3 sunH, vec3 sunP, vec2 ang, vec3 d, bool ground, out vec3 L, out vec3 T) {
  float eh = ang.x, e = oNadir(d, up), px = dot(d, sunH), py = abs(dot(d, sunP)), phi = px * px + py * py < 1e-14 ? 0. : atan(py, px);
  float y = clamp((e - eh) / max(ang.y - eh, 1e-9), 0., 1.), xs = ang.y < 3.14 ? .5 - sin(asin(1. - 2. * y) / 3.) : sqrt(y);
  float v = ground ? clamp(.5 + .5 * sqrt(clamp(1. - e / eh, 0., 1.)), .5 + .5 / V_H, 1. - .5 / V_H) : clamp(.5 - .5 * xs, .5 / V_H, .5 - .5 / V_H);
  float u = (phi / O_PI * (V_W - 1.) + .5) / (2. * V_W);
  L = textureLod(lut, vec2(u, v), 0.).rgb; T = textureLod(lut, vec2(u + .5, v), 0.).rgb;
}
uniform sampler2D uCamLUT, uRefLUT, uMoonLUT;
uniform vec3 uCamUp, uCamSunH, uCamSunP, uRefUp, uRefSunH, uRefSunP, uMoonUp, uMoonSunH, uMoonSunP;
uniform vec2 uCamAng, uRefAng, uMoonAng;
uniform float uMoonGain;
// Sky radiance seen from sea level along d (local frame): sunlit sky plus, at night, the moonlit sky (same physics, the
// Moon as the source, at the night exposure).
vec3 skyFromSea(vec3 d) {
  vec3 L, T; oView(uRefLUT, uRefUp, uRefSunH, uRefSunP, uRefAng, d, false, L, T);
  if (uMoonGain > 0.) { vec3 Lm, Tm; oView(uMoonLUT, uMoonUp, uMoonSunH, uMoonSunP, uMoonAng, d, false, Lm, Tm); L += Lm * uMoonGain; }
  return L;
}
// Light scattered into the path from the camera along d over the first s km, and its transmittance. Reference: the
// table's row just above the horizon at the same azimuth (a long, nearly level path: its in-scatter L_h and
// transmittance T_h), scaled by the optical depth of the actual path: Lin = L_h (1 - e^-tau) / (1 - T_h). For long paths
// to the sea (exact = true, > 20 km) the table's ground rows, which end exactly on the curved sea, take over.
// (The ground rows are not used for short paths: for a camera a few metres up, rounding in the ray-sphere
// intersection of earth-render's table can lose the near hit and integrate through the planet.)
vec3 oExt(float h) { h = max(h, 0.); return vec3(5.802e-3, 13.558e-3, 33.1e-3) * exp(-h / 8.) + vec3(4.4e-3) * exp(-h / 1.2); }
void aerial(vec3 d, float s, float hCam, float hEnd, bool exact, out vec3 Lin, out vec3 Tr) {
  vec3 dh = normalize(vec3(d.x, .0087, d.z) + vec3(1e-6, 0., 0.)), L, T;
  oView(uCamLUT, uCamUp, uCamSunH, uCamSunP, uCamAng, dh, false, L, T);
  if (uMoonGain > 0.) { vec3 Lm, Tm; oView(uMoonLUT, uMoonUp, uMoonSunH, uMoonSunP, uMoonAng, dh, false, Lm, Tm); L += Lm * uMoonGain; }
  vec3 tau = s * .5 * (oExt(hCam) + oExt(hEnd)); Tr = exp(-tau);
  Lin = L * (1. - Tr) / max(1. - T, vec3(1e-3));
  if (exact && s > 20. && oNadir(d, uCamUp) < uCamAng.x) {
    vec3 Lg, Tg; oView(uCamLUT, uCamUp, uCamSunH, uCamSunP, uCamAng, d, true, Lg, Tg);
    if (uMoonGain > 0.) { vec3 Lm, Tm; oView(uMoonLUT, uMoonUp, uMoonSunH, uMoonSunP, uMoonAng, d, true, Lm, Tm); Lg += Lm * uMoonGain; }
    float k = smoothstep(20., 60., s); Lin = mix(Lin, Lg, k); Tr = mix(Tr, Tg, k);
  }
}
`;
const BRDF_GLSL = /* glsl */`
// Fresnel averaged over the slope distribution around the mean normal (Bruneton et al. 2010, fit to exact).
float meanFresnel(float cosV, float sigmaV) { return pow(max(1. - cosV, 0.), 5. * exp(-2.69 * sigmaV)) / (1. + 22.7 * pow(sigmaV, 1.5)); }
float erfcA(float x) { return 2. * exp(-x * x) / (2.319 * x + sqrt(4. + 1.52 * x * x)); }
// Smith masking for Gaussian slopes of variance s2 in the plane of the ray.
float smithLambda(float c, float s2) { c = clamp(c, 1e-4, .9999); float v = c / sqrt((1. - c * c) * 2. * s2); return max(0., (exp(-v * v) - v * 1.7724539 * erfcA(v)) / (2. * v * 1.7724539)); }
// Radiance reflected towards V from a distant source of unit irradiance in L, by facets with Gaussian slopes
// (variances s2 along Tx, Ty) around the mean normal N: F p(slopes) / (4 cosV cos^4 H (1 + Lambda_L + Lambda_V)).
float glint(vec3 L, vec3 V, vec3 N, vec3 Tx, vec3 Ty, vec2 s2) {
  float zL = dot(L, N), zV = dot(V, N);
  if (zV <= 0. || zL <= -.2) return 0.;
  vec3 Hs = L + V; float hl = length(Hs); if (hl < 1e-4) return 0.; vec3 H = Hs / hl;
  float zH = dot(H, N); if (zH <= 1e-3) return 0.;
  float zx = dot(H, Tx) / zH, zy = dot(H, Ty) / zH, p = exp(-.5 * (zx * zx / s2.x + zy * zy / s2.y)) / (2. * O_PI * sqrt(s2.x * s2.y));
  vec2 v2 = vec2(dot(V, Tx), dot(V, Ty)), l2 = vec2(dot(L, Tx), dot(L, Ty)); v2 *= v2; l2 *= l2;
  float sV = dot(v2, s2) / max(v2.x + v2.y, 1e-9), sL = dot(l2, s2) / max(l2.x + l2.y, 1e-9);
  float F = .02 + .98 * pow(max(1. - dot(V, H), 0.), 5.);
  return F * p / ((1. + smithLambda(max(zL, .01), sL) + smithLambda(zV, sV)) * max(zV, .01) * zH * zH * zH * zH * 4.);
}
`;

// Water, vertex: a polar grid around the camera (rings 8% apart, 0.5 m to the horizon), displaced by the three larger
// tiles and lowered by the Earth's curvature (r^2 / 2R), so the horizon dips and lies where the sky tables put it.
// FLAT: any flat mesh (the launch pad's Atlantic): same shading, no displacement.
const WATER_VERTEX = /* glsl */`
uniform vec4 uGrid;       // centre x, z (km), max radius (km), camera height (km)
uniform vec2 uWind;       // downwind unit vector (world x, z)
uniform vec4 uL;
uniform vec2 uOff0, uOff1, uOff2, uOff3;
uniform sampler2D uDisp0, uDisp1, uDisp2;
uniform float uRing;
varying vec3 vWorld; varying vec2 vP;
vec2 toWind(vec2 p) { return vec2(p.x * uWind.x + p.y * uWind.y, -p.x * uWind.y + p.y * uWind.x); }
vec2 fromWind(vec2 p) { return p.x * uWind + p.y * vec2(-uWind.y, uWind.x); }
void main() {
#ifdef FLAT
  vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz; vP = toWind((w.xz - uGrid.xy) * 1000.);
#else
  vec2 local = position.xz; float r = length(local);
  if (r > uGrid.z) { local *= uGrid.z / r; r = uGrid.z; }
  vec2 pm = toWind(local * 1000.); vP = pm;
  float dist = length(vec2(r, uGrid.w)), spacing = max(dist * uRing * 1000., .05), fade = 1. - smoothstep(1.5, 6., dist);
  vec3 d = vec3(0.);
  if (fade > 0.) {
    d += textureLod(uDisp0, pm / uL.x + uOff0, max(log2(spacing * ${N}. / uL.x), 0.)).xyz;
    d += textureLod(uDisp1, pm / uL.y + uOff1, max(log2(spacing * ${N}. / uL.y), 0.)).xyz;
    d += textureLod(uDisp2, pm / uL.z + uOff2, max(log2(spacing * ${N}. / uL.z), 0.)).xyz;
    d *= fade;
  }
  vec2 dw = fromWind(d.xz) * .001;
  vWorld = vec3(uGrid.x + local.x + dw.x, d.y * .001 - r * r / ${(2 * EARTH_RADIUS).toFixed(3)}, uGrid.y + local.y + dw.y);
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
}`;

const WATER_FRAGMENT = vw => /* glsl */`
${vw}
${BRDF_GLSL}
uniform vec4 uGrid; uniform vec2 uWind; uniform vec4 uL; uniform vec2 uOff0, uOff1, uOff2, uOff3;
uniform sampler2D uDisp0, uDisp1, uDisp2, uSlope0, uSlope1, uSlope2, uSlope3, uNoise, uShadow;
uniform vec2 uSigmaRes;            // unresolved slope variance (down, cross wind)
uniform vec4 uTileVar;             // total slope variance of tiles 2 and 3 (down, cross wind)
uniform vec3 uFoam;                // convergence threshold, softness, albedo
uniform float uFoamMean;           // mean visible whitecap coverage
uniform vec3 uSunDir, uSunE, uMoonDir, uMoonE, uEdSky, uRrs;
uniform vec4 uShadowBox;           // x0, z0 (km), size (km), on
uniform float uDebug;
uniform vec4 uCraft, uDye;         // floating object: x, z, radius (km), foam 0..1; dye marker: x, z, radius, amount
uniform vec2 uSplash;              // white water of the impact: radius (m), strength
varying vec3 vWorld; varying vec2 vP;
vec2 fromWind(vec2 p) { return p.x * uWind + p.y * vec2(-uWind.y, uWind.x); }
void main() {
  vec3 toCam = cameraPosition - vWorld; float dist = length(toCam); vec3 V = toCam / max(dist, 1e-9);
  // Slopes: the resolved waves (mean of what this pixel covers) and their unresolved spread (LEAN moments).
  vec2 u0 = vP / uL.x + uOff0, u1 = vP / uL.y + uOff1, u2 = vP / uL.z + uOff2, u3 = vP / uL.w + uOff3;
  // Far away a tile is smaller than the pixel: its mean slope is zero and its variance the tile's total (same result
  // as the top mip level, without the fetch).
  vec4 s0 = texture2D(uSlope0, u0), s1 = texture2D(uSlope1, u1);
  vec4 s2 = dist < 100. ? texture2D(uSlope2, u2) : vec4(0., 0., uTileVar.xy), s3 = dist < 25. ? texture2D(uSlope3, u3) : vec4(0., 0., uTileVar.zw);
  // Gusts: the short waves (and Cox-Munk's mean square slope) follow the local wind, which varies over kilometres (+-30%).
  vec2 wk = vWorld.xz; float gust = .7 + .6 * (.6 * texture2D(uNoise, wk / 9.).r + .4 * texture2D(uNoise, wk / 3.1 + .37).g), gs = sqrt(gust);
  vec2 slope = s0.xy + s1.xy + (s2.xy + s3.xy) * gs;
  vec2 var = max(s0.zw - s0.xy * s0.xy, 0.) + max(s1.zw - s1.xy * s1.xy, 0.) + (max(s2.zw - s2.xy * s2.xy, 0.) + max(s3.zw - s3.xy * s3.xy, 0.) + uSigmaRes) * gust + 1e-5;
  // Mean normal in the local frame (wind axes), tilted with the curved sea (local vertical at the sea point).
  vec2 cx = (vWorld.xz - cameraPosition.xz) / ${EARTH_RADIUS.toFixed(3)};
  vec3 up = normalize(vec3(cx.x, 1., cx.y)), Tx0 = vec3(uWind.x, 0., uWind.y), Ty0 = vec3(-uWind.y, 0., uWind.x);
  vec2 sw = fromWind(slope);
  vec3 N = normalize(vec3(-sw.x, 1., -sw.y) + vec3(cx.x, 0., cx.y));
  vec3 Tx = normalize(Tx0 - N * dot(Tx0, N)), Ty = cross(N, Tx) * -1.;
  float cosV = max(dot(V, N), 0.);
  vec2 v2 = vec2(dot(V, Tx), dot(V, Ty)); v2 *= v2; float sigV = sqrt(dot(v2, var) / max(v2.x + v2.y, 1e-9));
  float F = meanFresnel(cosV, sigV);
  // Sky: the reflected direction, in the frame of the sea point (its own horizon), looked up from sea level.
  vec3 R = reflect(-V, N); vec3 Rl = R - up * dot(R, up) + vec3(0., dot(R, up), 0.); Rl.y = max(Rl.y, 0.); Rl = normalize(Rl + vec3(0., 1e-4, 0.));
  vec3 sky = skyFromSea(Rl);
  // Cloud shadow (transmittance of the deck towards the Sun at this point).
  float shade = 1.;
  if (uShadowBox.w > 0.) { vec2 su = (vWorld.xz - uShadowBox.xy) / uShadowBox.z; if (all(greaterThan(su, vec2(0.))) && all(lessThan(su, vec2(1.)))) shade = texture2D(uShadow, su).r; }
  vec3 sun = uSunE * shade * glint(uSunDir, V, N, Tx, Ty, var);
  if (uMoonE.b > 0.) sun += uMoonE * glint(uMoonDir, V, N, Tx, Ty, var);
  // Light coming up out of the water: Rrs times the downwelling irradiance, transmitted through the surface.
  vec3 Ed = uEdSky + uSunE * shade * max(uSunDir.y, 0.) * (1. - meanFresnel(max(uSunDir.y, 0.), sigV)) + uMoonE * max(uMoonDir.y, 0.);
  vec3 Lw = uRrs * Ed * (1. - F) / .98;
  vec3 col = F * sky + sun + Lw;
  // Whitecaps: where the choppy surface converges past the threshold that gives Monahan's coverage for this wind.
  float foam = 0.;
  if (dist < 6.) {
    float conv = texture2D(uDisp0, u0).a + texture2D(uDisp1, u1).a + texture2D(uDisp2, u2).a, bub = texture2D(uNoise, vP / 3.7).b;
    foam = smoothstep(uFoam.x, uFoam.x + uFoam.y, -conv * (.75 + .5 * bub)) * smoothstep(6., 3., dist);
  }
  foam = max(foam, uFoamMean * smoothstep(3., 6., dist));   // beyond, whitecaps are sub-pixel: their mean coverage
  // Around a floating object: its own churned water (foam ring) and the fluorescein sea-dye marker of Apollo recovery.
  vec2 dc = (vWorld.xz - uCraft.xy) * 1000.; float rc = length(dc), rk = uCraft.z * 1000.;
  // (waves slapping the hull: a ragged ring of white water ~1 m wide, densest at the waterline)
  if (uCraft.w > 0.) foam = max(foam, uCraft.w * smoothstep(rk * 1.55, rk * 1., rc) * smoothstep(.35, .75, texture2D(uNoise, dc / 1.7).a + .25 * smoothstep(rk * 1.3, rk, rc)));
  if (uSplash.y > 0.) foam = max(foam, uSplash.y * smoothstep(uSplash.x, uSplash.x * .55, rc + 2.5 * (texture2D(uNoise, dc / 4.1).r - .5)) * (.6 + .4 * texture2D(uNoise, dc / 1.3).a));
  if (uDye.w > 0.) {
    // Spread by the surface current downwind into a tongue with streaks (wind frame: x downwind).
    vec2 dd = (vWorld.xz - uDye.xy) * 1000.; vec2 dw = vec2(dd.x * uWind.x + dd.y * uWind.y, -dd.x * uWind.y + dd.y * uWind.x);
    vec2 e = vec2((dw.x - uDye.z * 300.) / 2.2, dw.y) / (uDye.z * 1000.);
    float patchy = .6 * texture2D(uNoise, dw * vec2(.012, .05)).r + .4 * texture2D(uNoise, dw * vec2(.05, .16) + .3).g;
    float dye = uDye.w * smoothstep(1., .3, length(e) + .55 * (patchy - .5)) * (.55 + .45 * patchy);
    // Fluorescein in sea water absorbs the blue and re-emits near 520 nm: a pale yellow-green slick over the blue.
    col = mix(col, F * sky + sun + vec3(.02, .055, .018) * Ed * (1. - F), dye);
  }
  col = mix(col, uFoam.z * Ed / O_PI, clamp(foam, 0., 1.));
  // Aerial perspective to the camera (the curved sea ends exactly where the sky table's ground rows end).
  vec3 Lin, Tr;
#ifdef FLAT
  aerial(-V, dist, cameraPosition.y, max(vWorld.y, 0.), false, Lin, Tr);
#else
  aerial(-V, dist, cameraPosition.y, max(vWorld.y, 0.), true, Lin, Tr);
#endif
  col = col * Tr + Lin;
  if (uDebug > .5) col = uDebug < 1.5 ? sun : uDebug < 2.5 ? F * sky : uDebug < 3.5 ? Lw * 10. : uDebug < 4.5 ? Tr : uDebug < 5.5 ? Lin : uDebug < 6.5 ? vec3(var * 10., 0.) : uDebug < 7.5 ? uSunE * glint(uSunDir, V, vec3(0., 1., 0.), Tx0, Ty0, vec2(.02, .015)) : uDebug < 8.5 ? vec3(dot(V, N) < 0. ? 1. : 0., dot(normalize(uSunDir + V), N) * .5, 0.) : vec3(smithLambda(max(dot(uSunDir, N), .01), .02), smithLambda(dot(V, N), .02), 0.) * .3;
  gl_FragColor = vec4(clamp(col, 0., 6e4), 1.);
}`;

// Sky dome of the sea scenes: the earth-render sky seen from the camera, the solar and lunar discs, and below the
// horizon (past the end of the sea mesh) the same sea BRDF on the statistics alone.
const SKY_FRAGMENT = vw => /* glsl */`
${vw}
${BRDF_GLSL}
uniform vec3 uSunDir, uSunDisc, uMoonDir, uMoonDisc, uEdSky, uRrs, uSunE;
uniform vec2 uSigmaTot; uniform vec2 uWind;
varying vec3 vWorld;
void main() {
  vec3 d = normalize(vWorld - cameraPosition), L, T;
  bool ground = oNadir(d, uCamUp) < uCamAng.x;
  oView(uCamLUT, uCamUp, uCamSunH, uCamSunP, uCamAng, d, ground, L, T);
  if (uMoonGain > 0.) { vec3 Lm, Tm; oView(uMoonLUT, uMoonUp, uMoonSunH, uMoonSunP, uMoonAng, d, ground, Lm, Tm); L += Lm * uMoonGain; }
  if (ground) {
    // Grazing sea near the horizon: incidence from the law of sines on the sphere, mean normal = local vertical.
    float R0 = ${EARTH_RADIUS.toFixed(3)}, r = R0 + max(cameraPosition.y, 0.), si = clamp(r / R0 * sin(oNadir(d, uCamUp)), 0., 1.), c = sqrt(1. - si * si);
    vec3 h = normalize(vec3(d.x, 0., d.z) + vec3(1e-6, 0., 0.)), V = normalize(-h * si + vec3(0., c, 0.)), N = vec3(0., 1., 0.);
    vec3 Tx = vec3(uWind.x, 0., uWind.y), Ty = vec3(-uWind.y, 0., uWind.x);
    vec2 v2 = vec2(dot(V, Tx), dot(V, Ty)); v2 *= v2; float sv = sqrt(dot(v2, uSigmaTot) / max(v2.x + v2.y, 1e-9)), F = meanFresnel(c, sv);
    vec3 sea = F * skyFromSea(normalize(h * si + vec3(0., c, 0.))) + uSunE * glint(uSunDir, V, N, Tx, Ty, uSigmaTot) + uRrs * uEdSky * (1. - F);
    L += T * sea;
  } else {
    // Discs: limb-darkened Sun (u = 0.6), Moon with its phase; radiance capped (see uSunDisc in update).
    float cs = dot(d, uSunDir), a = acos(clamp(cs, -1., 1.));
    if (a < ${SUN_RADIUS * 1.6}) { float x = clamp(a / ${SUN_RADIUS}, 0., 1.); L += uSunDisc * (1. - .6 * (1. - sqrt(max(1. - x * x, 0.)))) * smoothstep(1.06, .94, a / ${SUN_RADIUS}); }
    float am = acos(clamp(dot(d, uMoonDir), -1., 1.));
    if (uMoonDisc.b > 0. && am < ${MOON_RADIUS * 1.3}) {
      vec3 ax = normalize(cross(uMoonDir, vec3(0., 1., 0.)) + vec3(1e-6, 0., 0.)), ay = cross(ax, uMoonDir);
      vec2 q = vec2(dot(d, ax), dot(d, ay)) / ${MOON_RADIUS}; float q2 = dot(q, q);
      vec3 n = q.x * ax + q.y * ay - sqrt(max(1. - q2, 0.)) * uMoonDir;   // point on the lunar sphere facing us
      L += uMoonDisc * smoothstep(1.04, .96, sqrt(q2)) * smoothstep(-.05, .1, dot(n, uSunDir)) * (.85 + .15 * sqrt(max(1. - q2, 0.)));
    }
  }
  gl_FragColor = vec4(clamp(L, 0., 6e4), 1.);
}`;
const WORLD_VERTEX = 'varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';

// Polar grid (km): centre vertex then rings r0 q^i.
function polarGrid(rings = 170, around = 256, r0 = .0005, rMax = 260) {
  const q = Math.pow(rMax / r0, 1 / (rings - 1)), pos = new Float32Array((1 + rings * around) * 3), index = [];
  for (let i = 0; i < rings; i++) { const r = r0 * Math.pow(q, i); for (let j = 0; j < around; j++) { const a = j / around * Math.PI * 2, o = (1 + i * around + j) * 3; pos[o] = r * Math.cos(a); pos[o + 2] = r * Math.sin(a); } }
  for (let j = 0; j < around; j++) index.push(0, 1 + (j + 1) % around, 1 + j);
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < around; j++) {
    const a = 1 + i * around + j, b = 1 + i * around + (j + 1) % around, c = a + around, d = b + around;
    index.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rMax); return { geometry: g, step: q - 1 };
}

/**
 * createOcean(renderer, { earth, wind = 7, windFrom = 70, swell = { height: 1, period: 11, from: 160 }, chop = 1.1,
 *   clouds = true, cloudCover = .16, seed = 7 })
 *   earth: the createEarthRenderer(...) object (its sky tables, sun transmittance and sky irradiance are reused).
 *   wind: 10 m wind speed (m/s); windFrom: direction it blows from (deg, clockwise from north; trade winds ~60-80).
 *   swell: significant height (m), peak period (s) and the direction it comes from (deg). Scene frame: km, sea level
 *   y = 0, north -Z, east +X (as skyAt). Default: Beaufort 4 trade-wind sea, Hs ~1.3 m, plus 1 m of 11 s swell.
 * Returns:
 *   group: THREE.Group, the sea of the recovery scene (camera-following curved grid + impact spray).
 *   water: the sea mesh; material: its ShaderMaterial; flatMaterial: the same shading for any flat mesh (the pad's sea).
 *   sky: the sky dome mesh (radius 90 km, BackSide, renderOrder -10); clouds: the cumulus mesh (null if clouds: false).
 *   update(nowMs, camera, sunDirLocal, { moonDirLocal, moonPhaseDeg }): every frame the sea or the pad is drawn.
 *   surfaceAt(x, z, target?) -> { height (km), normal }: the sea under a floating object.
 *   keyLight(sunDirLocal, { moonDirLocal, moonPhaseDeg, x, altitudeKm, z }, target?) -> { dir, color, intensity }.
 *   sunVisibility(x, y, z) -> 0..1: transmittance of the clouds towards the Sun.
 *   setCraft(x, z, radiusKm, foam, dye, dyeRadiusKm): foam around the floating capsule, optional sea-dye marker.
 *   splash(nowMs, x, z): the impact (spray, white water). exposure: suggested toneMappingExposure (read after update).
 *   fogColor, fogFar: horizon haze for the scene fog. dispose().
 */
export function createOcean(renderer, { earth, wind = 7, windFrom = 70, swell = { height: 1, period: 11, from: 160 }, chop = 1.1, clouds = true, cloudCover = .16, seed = 7 } = {}) {
  if (!earth) throw new Error('createOcean: earth (createEarthRenderer object) is required');
  const deg = Math.PI / 180;
  // Downwind unit vector in the scene's xz (north = -z, east = +x): the wind blows towards windFrom + 180.
  const downwind = new THREE.Vector2(-Math.sin(windFrom * deg), Math.cos(windFrom * deg));
  const toWind = (x, z) => [x * downwind.x + z * downwind.y, -x * downwind.y + z * downwind.x];
  let swellCfg = null;
  if (swell && swell.height > 0) { const t = new THREE.Vector2(-Math.sin(swell.from * deg), Math.cos(swell.from * deg)), [a, b] = toWind(t.x, t.y); swellCfg = { height: swell.height, period: swell.period, dir: Math.atan2(b, a) }; }
  const spec = buildSpectrum({ wind, swell: swellCfg, seed });
  // Slope variance: Cox & Munk (1954, clean sea): along 3.16e-3 U, across 0.003 + 1.92e-3 U. The tiles resolve the part
  // up to K_MAX; the rest goes to the BRDF (never less than the spectrum's own tail beyond K_MAX).
  const resolved = slopeVariance(wind, .01, K_MAX), tail = slopeVariance(wind, K_MAX, 4000), coxMunk = [3.16e-3 * wind, .003 + 1.92e-3 * wind];
  const sigmaRes = new THREE.Vector2(Math.max(coxMunk[0] - resolved[0], .5 * tail[0]), Math.max(coxMunk[1] - resolved[1], .5 * tail[1]));
  const sigmaTot = new THREE.Vector2(resolved[0] + sigmaRes.x, resolved[1] + sigmaRes.y);
  // Whitecap coverage W = 3.84e-6 U^3.41 (Monahan & O'Muircheartaigh 1980): the convergence of the choppy field is
  // Gaussian with variance chop^2 * divVar, so breaking (convergence below -t) covers W for t = z(W) * sigma.
  const coverage = Math.min(.2, 3.84e-6 * Math.pow(wind, 3.41)), sigmaDiv = chop * Math.sqrt(spec.divVar), foamT = normalTail(Math.max(coverage, 1e-6)) * sigmaDiv;

  // --- FFT targets and passes ---------------------------------------------------------------------------------------
  const h0 = new THREE.DataTexture(spec.data, N, N * TILES.length, THREE.RGBAFormat, THREE.FloatType); h0.minFilter = h0.magFilter = THREE.NearestFilter; h0.needsUpdate = true;
  // Half floats: heights of the big tiles and slopes of all keep ~1e-3 relative precision (plenty), at half the bandwidth.
  const fftTarget = () => new THREE.WebGLRenderTarget(N, N * TILES.length, { count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  const ping = fftTarget(), pong = fftTarget();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const outputs = TILES.map(() => { const t = new THREE.WebGLRenderTarget(N, N, { count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false, generateMipmaps: true, anisotropy: maxAniso }); t.textures.forEach(x => { x.anisotropy = maxAniso; x.wrapS = x.wrapT = THREE.RepeatWrapping; }); return t; });
  const raw = (fragmentShader, uniforms, defines = {}) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FFT_VERTEX, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  const specMat = raw(SPECTRUM_PASS, { uH0: { value: h0 }, uTau: { value: 0 }, uChop: { value: chop }, uL: { value: new THREE.Vector4(...TILES.map(t => t.L)) } });
  const flyH = raw(BUTTERFLY_PASS, { uA: { value: null }, uB: { value: null }, uS: { value: 2 } }), flyV = raw(BUTTERFLY_PASS, { uA: { value: null }, uB: { value: null }, uS: { value: 2 } }, { VERTICAL: '' });
  const finalMat = raw(FINAL_PASS, { uA: { value: null }, uB: { value: null }, uTile: { value: 0 } });
  const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; quadScene.add(quad);
  const pass = (material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); };
  function simulate(seconds) {
    const prev = renderer.getRenderTarget(), auto = renderer.autoClear; renderer.autoClear = false;
    specMat.uniforms.uTau.value = (((seconds % LOOP) + LOOP) % LOOP) / LOOP; pass(specMat, ping);
    let src = ping, dst = pong;
    for (const fly of [flyH, flyV]) for (let s = 2; s <= N; s *= 2) { fly.uniforms.uA.value = src.textures[0]; fly.uniforms.uB.value = src.textures[1]; fly.uniforms.uS.value = s; pass(fly, dst); [src, dst] = [dst, src]; }
    finalMat.uniforms.uA.value = src.textures[0]; finalMat.uniforms.uB.value = src.textures[1];
    outputs.forEach((t, i) => { finalMat.uniforms.uTile.value = i; pass(finalMat, t); });
    renderer.setRenderTarget(prev); renderer.autoClear = auto;
  }

  // --- Sky tables: from the camera, from sea level (reflections), and for the Moon at night ------------------------
  const camDome = earth.skyDome({ kmPerUnit: 1 }), seaDome = earth.skyDome({ kmPerUnit: 1 }), moonDome = earth.skyDome({ kmPerUnit: 1 });
  const vw = camDome.view.target.width / 2, vh = camDome.view.target.height, skyGlsl = SKY_GLSL(vw, vh);
  const lut = (dome, p) => ({ [`u${p}LUT`]: dome.view.lookup.uViewLUT, [`u${p}Up`]: dome.view.lookup.uViewUp, [`u${p}SunH`]: dome.view.lookup.uViewSunH, [`u${p}SunP`]: dome.view.lookup.uViewSunP, [`u${p}Ang`]: dome.view.lookup.uViewAngles });
  const seaLevel = new THREE.Object3D(); seaLevel.position.set(0, .0015, 0); seaLevel.updateMatrixWorld();
  const noise = noiseTexture();
  const shadowTarget = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const U = {
    ...lut(camDome, 'Cam'), ...lut(seaDome, 'Ref'), ...lut(moonDome, 'Moon'), uMoonGain: { value: 0 },
    uGrid: { value: new THREE.Vector4(0, 0, 200, .01) }, uWind: { value: downwind.clone() }, uL: { value: new THREE.Vector4(...TILES.map(t => t.L)) },
    uOff0: { value: new THREE.Vector2() }, uOff1: { value: new THREE.Vector2() }, uOff2: { value: new THREE.Vector2() }, uOff3: { value: new THREE.Vector2() },
    uDisp0: { value: outputs[0].textures[0] }, uDisp1: { value: outputs[1].textures[0] }, uDisp2: { value: outputs[2].textures[0] },
    uSlope0: { value: outputs[0].textures[1] }, uSlope1: { value: outputs[1].textures[1] }, uSlope2: { value: outputs[2].textures[1] }, uSlope3: { value: outputs[3].textures[1] },
    uNoise: { value: noise }, uShadow: { value: shadowTarget.texture }, uShadowBox: { value: new THREE.Vector4(0, 0, 1, 0) },
    uSigmaRes: { value: sigmaRes }, uTileVar: { value: new THREE.Vector4(...spec.tileVar[2], ...spec.tileVar[3]) }, uFoamMean: { value: coverage * .6 }, uSigmaTot: { value: sigmaTot }, uFoam: { value: new THREE.Vector3(foamT, .8 * sigmaDiv, .5) }, uRing: { value: .08 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunE: { value: new THREE.Color() }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonE: { value: new THREE.Color(0, 0, 0) },
    uEdSky: { value: new THREE.Color() }, uRrs: { value: new THREE.Color(...RRS) }, uSunDisc: { value: new THREE.Color() }, uMoonDisc: { value: new THREE.Color(0, 0, 0) },
    uDebug: { value: 0 }, uSplash: { value: new THREE.Vector2(0, 0) }, uCraft: { value: new THREE.Vector4(0, 0, .002, 0) }, uDye: { value: new THREE.Vector4(0, 0, .02, 0) },
  };
  const waterMaterial = flat => new THREE.ShaderMaterial({ uniforms: U, vertexShader: WATER_VERTEX, fragmentShader: WATER_FRAGMENT(skyGlsl), defines: flat ? { FLAT: '' } : {}, fog: false });
  const material = waterMaterial(false), flatMaterial = waterMaterial(true);
  const grid = polarGrid(); U.uRing.value = grid.step;
  const water = new THREE.Mesh(grid.geometry, material); water.frustumCulled = false; water.name = 'ocean';
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 64, 32), new THREE.ShaderMaterial({ uniforms: U, vertexShader: WORLD_VERTEX, fragmentShader: SKY_FRAGMENT(skyGlsl), side: THREE.BackSide, depthWrite: false, fog: false }));
  sky.frustumCulled = false; sky.renderOrder = -10; sky.name = 'ocean-sky';
  const group = new THREE.Group(); group.name = 'ocean-group'; group.add(water);

  // --- Heave of floating objects (CPU): the strongest modes of the big tiles, same phases as the GPU -----------------
  const modes = spec.modes.map(([kx, kz, re, im]) => { const k = Math.hypot(kx, kz), w = Math.sqrt(G * k * (1 + (k / KM) ** 2)); return { kx, kz, re, im, n: Math.floor(w * LOOP / (2 * Math.PI) + .5), kn: [kx / k, kz / k] }; });
  let tau = 0;
  function field(px, pz) {
    let h = 0, dx = 0, dz = 0, sx = 0, sz = 0;
    for (const m of modes) {
      const ph = m.kx * px + m.kz * pz - 2 * Math.PI * ((m.n * tau) % 1), c = Math.cos(ph), s = Math.sin(ph);
      const re = 2 * (m.re * c - m.im * s), im = 2 * (m.re * s + m.im * c); // 2 Re / 2 Im of A e^{i ph}
      h += re; dx -= chop * m.kn[0] * im; dz -= chop * m.kn[1] * im; sx -= m.kx * im; sz -= m.kz * im;
    }
    return { h, dx, dz, sx, sz };
  }
  // Height (km) and normal of the sea surface at world (x, z) km: the undisplaced point found by fixed-point iteration.
  function surfaceAt(x, z, target = { height: 0, normal: new THREE.Vector3(0, 1, 0) }) {
    const [wx, wz] = toWind(x * 1000, z * 1000); let px = wx, pz = wz, f;
    for (let i = 0; i < 3; i++) { f = field(px, pz); px = wx - f.dx; pz = wz - f.dz; }
    const sx = f.sx * downwind.x - f.sz * downwind.y, sz = f.sx * downwind.y + f.sz * downwind.x;
    target.height = f.h * .001; target.normal.set(-sx, 1, -sz).normalize(); return target;
  }

  // --- Trade-wind cumulus -------------------------------------------------------------------------------------------
  const deck = clouds ? createCloudDeck({ U, renderer, cover: cloudCover, seed, downwind, shadowTarget, skyGlsl }) : null;
  const spray = createSpray(); group.add(spray.points);

  const camPos = new THREE.Vector3(), sunCol = new THREE.Color(), tmp = new THREE.Color(), lastSun = new THREE.Vector3();
  let exposure = 1, lastHaze = -1, craftFoam = 0;
  const ocean = {
    stats: { tileVar: spec.tileVar, sigmaRes: sigmaRes.toArray(), sigmaTot: sigmaTot.toArray(), resolved, tail, coxMunk, coverage, sigmaDiv, foamT, hsWind: 4 * Math.sqrt(spec.data.reduce((a, v, i) => a + ((i & 3) < 2 ? v * v : 0), 0) * 2) },
    domes: { cam: camDome, sea: seaDome, moon: moonDome },   // sky-view tables (debugging)
    group, water, material, flatMaterial, sky, clouds: deck ? deck.mesh : null, uniforms: U, surfaceAt, fogColor: new THREE.Color(), fogFar: 100,
    get exposure() { return exposure; },
    // Transmittance of the cumulus deck towards the Sun from a point (km): dim the Sun on a capsule under a cloud.
    sunVisibility: (x, y, z) => deck ? deck.sunVisibility(x, y, z, U.uSunDir.value) : 1,
    // The key light of the sea scenes for the lit objects (capsule, chutes, pad): the Sun through the air at altitudeKm
    // and through any cloud in the way; at night the Moon (phase law, at the night exposure, as the sea and sky).
    // Returns { dir, color (max channel 1), intensity } for a DirectionalLight on the mission's scale (Sun 3.2).
    keyLight(sunDirLocal, { moonDirLocal = null, moonPhaseDeg = 90, x = 0, altitudeKm = 0, z = 0 } = {}, target = { dir: new THREE.Vector3(), color: new THREE.Color(), intensity: 0 }) {
      const E = earth.uniforms.uSunE.value, sc = earth.uniforms.uSunColor.value, sun = target.dir.copy(sunDirLocal).normalize();
      earth.sunTransmittance(altitudeKm, sun.y, target.color).multiply(sc);
      let k = E * Math.max(target.color.r, target.color.g, target.color.b) * (deck ? deck.sunVisibility(x, altitudeKm, z, sun) : 1);
      if (k < .02 && moonDirLocal && moonDirLocal.y > 0) {
        const a = moonPhaseDeg, e = E * MOON_FULL * Math.pow(10, -.4 * (.026 * a + 4e-9 * a ** 4)) * NIGHT_EXPOSURE * THREE.MathUtils.smoothstep(-sunDirLocal.y, .02, .2);
        target.dir.copy(moonDirLocal).normalize(); earth.sunTransmittance(altitudeKm, target.dir.y, target.color).multiply(sc); target.color.g *= .93; target.color.b *= .84;
        k = e * Math.max(target.color.r, target.color.g, target.color.b);
      }
      const m = Math.max(target.color.r, target.color.g, target.color.b); if (m > 1e-6) target.color.multiplyScalar(1 / m); target.intensity = k; return target;
    },
    // Floating object (the command module, 3.9 m across): foam it churns, and the sea-dye marker patch (dye 0..1 grows
    // the patch from nothing to dyeRadiusKm; Apollo's fluorescein marker spread to a few tens of metres).
    setCraft(x = 0, z = 0, radiusKm = .00195, foam = 0, dye = 0, dyeRadiusKm = .016) { craftFoam = foam; U.uCraft.value.set(x, z, radiusKm, foam); U.uDye.value.set(x, z, Math.max(.002, dyeRadiusKm * Math.sqrt(Math.max(dye, 0))), dye > 0 ? Math.min(1, dye * 2) * .85 : 0); },
    // The capsule hits the water (~9 m/s under three mains): a crown of spray, mist and spreading white water.
    // Call once at the moment of contact, with the same clock as update, and the point of impact (km).
    splash(nowMs, x = 0, z = 0) { spray.trigger(nowMs / 1000, x, z); U.uCraft.value.x = x; U.uCraft.value.y = z; },
    /**
     * update(nowMs, camera, sunDirLocal, { moonDirLocal = null, moonPhaseDeg = 90 } = {})
     * Every frame the sea or the pad is drawn, before rendering: runs the FFT, follows the camera with the grid, redraws
     * the sky tables when the Sun or the camera height change, lights and sorts the clouds.
     */
    update(nowMs, camera, sunDirLocal, { moonDirLocal = null, moonPhaseDeg = 90 } = {}) {
      const t = nowMs / 1000; tau = (((t % LOOP) + LOOP) % LOOP) / LOOP;
      simulate(t);
      camera.getWorldPosition(camPos);
      const sun = U.uSunDir.value.copy(sunDirLocal).normalize();
      // Grid centred under the camera (0.5 m steps), reaching the horizon or the far plane.
      const cx = Math.round(camPos.x * 2000) / 2000, cz = Math.round(camPos.z * 2000) / 2000, hCam = Math.max(camPos.y, .0005);
      const horizon = Math.sqrt(2 * EARTH_RADIUS * hCam + hCam * hCam);
      U.uGrid.value.set(cx, cz, Math.min(horizon * 1.02 + .2, (camera.far || 200) * .97), hCam);
      const [wx, wz] = toWind(cx * 1000, cz * 1000);
      TILES.forEach((tile, i) => U[`uOff${i}`].value.set(((wx / tile.L + .5 / N) % 1 + 1) % 1, ((wz / tile.L + .5 / N) % 1 + 1) % 1)); // texel i holds the field at i L/N
      // Sky tables: from the camera (sky, aerial perspective), from sea level (what the sea reflects).
      camDome.update(camera, sun); seaDome.update(seaLevel, sun);
      // Sunlight at sea level (colour of the low Sun, zero below the horizon), sky irradiance on the sea.
      const sc = earth.uniforms.uSunColor.value, E = earth.uniforms.uSunE.value;
      earth.sunTransmittance(0, sun.y, sunCol); U.uSunE.value.copy(sunCol).multiply(sc).multiplyScalar(E);
      earth.skyIrradiance(sun.y, U.uEdSky.value);
      // Solar disc: true radiance E/(pi r^2) ~ 4.7e4 x transmittance, capped at 900 (film clips it; the bloom carries
      // the glare). LICENCE: the cap.
      U.uSunDisc.value.copy(U.uSunE.value).multiplyScalar(1 / (Math.PI * SUN_RADIUS * SUN_RADIUS));
      { const m = Math.max(U.uSunDisc.value.r, U.uSunDisc.value.g, U.uSunDisc.value.b); if (m > 900) U.uSunDisc.value.multiplyScalar(900 / m); }
      // Moon (night): irradiance from its phase (Allen 1976 / Krisciunas & Schaefer 1991), shown at the night exposure of
      // earth-render.js (LICENCE: ~3e4 x; a full Moon then lights the sea like a dim dusk).
      const night = sun.y < -.1;
      if (moonDirLocal && moonDirLocal.y > -.05) {
        const a = moonPhaseDeg, e = E * MOON_FULL * Math.pow(10, -.4 * (.026 * a + 4e-9 * a ** 4)) * NIGHT_EXPOSURE * THREE.MathUtils.smoothstep(-sun.y, .02, .2);
        const md = U.uMoonDir.value.copy(moonDirLocal).normalize();
        earth.sunTransmittance(0, md.y, tmp); U.uMoonE.value.setRGB(e, e * .93, e * .84).multiply(tmp).multiply(sc);
        U.uMoonGain.value = e / E; if (night) moonDome.update(camera, md);
        // Disc: the lit part has the surface brightness of the full Moon (the phase only shrinks the lit area).
        U.uMoonDisc.value.copy(U.uMoonE.value).multiplyScalar(1 / (Math.PI * MOON_RADIUS * MOON_RADIUS) / Math.max(.05, Math.pow(10, -.4 * (.026 * a + 4e-9 * a ** 4))));
        { const m = Math.max(U.uMoonDisc.value.r, U.uMoonDisc.value.g, U.uMoonDisc.value.b); if (m > 300) U.uMoonDisc.value.multiplyScalar(300 / m); }
        U.uEdSky.value.add(tmp.copy(U.uMoonE.value).multiplyScalar(.08));
      } else { U.uMoonE.value.setRGB(0, 0, 0); U.uMoonGain.value = 0; U.uMoonDisc.value.setRGB(0, 0, 0); }
      if (!night && U.uMoonGain.value > 0) U.uMoonGain.value = 0;
      // Haze colour for the scene's fog (capsule, chutes): the horizon in-scatter of the camera's table.
      if (lastSun.distanceToSquared(sun) > 1e-6 || Math.abs(hCam - lastHaze) > .1 + .1 * hCam) { earth.hazeColor(hCam, sun, null, ocean.fogColor); ocean.fogFar = Math.min(150, 2.5 / earth.extinction(0)); lastHaze = hCam; } // ~1-2 ms: only when it changes
      if (deck) deck.update(t, camera, camPos, sun, earth, U, lastSun.distanceToSquared(sun) > 1e-6);
      spray.update(t, camera, renderer, U, craftFoam);
      lastSun.copy(sun);
      // Suggested exposure, as a camera meter would set it over a sea-dominated frame: full daylight 1.45 (calibrated on
      // the recovery photographs above); it opens up through twilight (square root: a meter does not fully compensate,
      // dusk must read as dusk), capped at 2.4. Night: 1.6, the night exposure is already in the moonlight (licence).
      const ed = U.uEdSky.value.g + U.uSunE.value.g * Math.max(sun.y, 0), dayK = THREE.MathUtils.smoothstep(sun.y, -.1, .02);
      exposure = THREE.MathUtils.lerp(1.6, THREE.MathUtils.clamp(1.45 * Math.sqrt(3 / Math.max(ed, 1e-3)), 1.2, 2.4), dayK);
    },
    dispose() {
      [ping, pong, ...outputs, shadowTarget].forEach(t => t.dispose()); h0.dispose(); noise.dispose();
      [specMat, flyH, flyV, finalMat, material, flatMaterial, sky.material].forEach(m => m.dispose()); quad.geometry.dispose(); grid.geometry.dispose(); sky.geometry.dispose();
      camDome.dispose(); seaDome.dispose(); moonDome.dispose(); deck?.dispose(); spray.dispose();
    },
  };
  return ocean;
}

// ---------------------------------------------------------------------------------------------------------------
// Trade-wind cumulus: each cloud a cluster of camera-facing sprites (Wang 2003, "Realistic and fast cloud rendering"),
// each sprite a "cauliflower" of ~34 bulbs with its own depth and normals (generated once), shaded from the cloud's
// envelope (a dome on a flat base at the lifting condensation level). Sunlight reaching a point through the cloud
// falls as the two-stream diffuse transmission 1 / (1 + 3/4 (1 - g) tau) (Bohren 1987); skylight from above, sea light
// from below, a forward-scattering rim when the Sun is behind; then the aerial perspective of the same sky tables.
// Their shadows on the sea are the same transmittance projected along the Sun (no shadow map of the scene).
const CLOUD_VERTEX = (vw) => /* glsl */`
${vw}
// Per sprite, three texels of uPuffData (static; only the draw order aIndex is re-sent when sorting):
// sprite centre offset from the cloud centre (km) and radius; cloud centre x, z (km), envelope radius a, height H;
// atlas tile (0..3), roll (0..1), vertical / horizontal extent.
attribute float aIndex;
uniform sampler2D uPuffData;
uniform vec3 uDrift; uniform float uSpan;
varying vec2 vQ; varying vec3 vCentre, vCloudC, vRadii, vX, vY, vZ; varying float vR, vRy, vRoll, vTile, vFade;
varying vec3 vLin, vTr;
vec4 puffTexel(int i) { return texelFetch(uPuffData, ivec2(i % 1024, i / 1024), 0); }
void main() {
  int i = int(aIndex + .5) * 3; vec4 aPuff = puffTexel(i), aCloud = puffTexel(i + 1), aSeed = puffTexel(i + 2);
  vec2 c = mod(aCloud.xy + uDrift.xy + uSpan, 2. * uSpan) - uSpan;
  vec3 C = vec3(c.x, ${CLOUD.base.toFixed(3)}, c.y), P = C + aPuff.xyz;
  // Curvature: everything sinks by r^2/2R from the camera, so far clouds sit low and go hull-down past the horizon.
  vec2 rel = P.xz - cameraPosition.xz; vec3 Pv = P - vec3(0., dot(rel, rel) / ${(2 * EARTH_RADIUS).toFixed(3)}, 0.);
  vec3 toCam = cameraPosition - Pv; float dist = length(toCam);
  vec3 zv = toCam / dist, xv = normalize(cross(vec3(0., 1., 0.), zv) + vec3(1e-6, 0., 0.)), yv = cross(zv, xv);
  // Flat cumulus: seen from the side the sprite is as tall as the cloud, seen from above as wide.
  float r = aPuff.w, ry = r * mix(aSeed.z, 1., abs(zv.y));
  vQ = position.xy; vTile = aSeed.x; vRoll = aSeed.y; vCentre = P; vCloudC = C; vRadii = vec3(aCloud.z, aCloud.w, aCloud.z); vR = r; vRy = ry;
  vX = xv; vY = yv; vZ = zv;
  vFade = smoothstep(uSpan, uSpan * .85, length(c)) * smoothstep(.08, .5, dist);
  aerial(-zv, dist, cameraPosition.y, P.y, false, vLin, vTr);
  gl_Position = projectionMatrix * viewMatrix * vec4(Pv + position.x * xv * r + position.y * yv * ry, 1.);
}`;
const CLOUD_FRAGMENT = (vw) => /* glsl */`
${vw}
uniform sampler2D uPuffs;
uniform vec3 uLightDir, uCloudSun, uSkyUp, uSeaUp;
varying vec2 vQ; varying vec3 vCentre, vCloudC, vRadii, vX, vY, vZ; varying float vR, vRy, vRoll, vTile, vFade;
varying vec3 vLin, vTr;
// Chord from p along d to the exit of the cloud envelope (ellipsoid), km.
float chord(vec3 p, vec3 d) {
  vec3 o = (p - vCloudC) / vRadii, v = d / vRadii; float b = dot(o, v), a = dot(v, v), c = dot(o, o) - 1., h = b * b - a * c;
  if (h <= 0.) return 0.; return max((-b + sqrt(h)) / a, 0.);
}
float hg(float c, float g) { return (1. - g * g) / (4. * O_PI * pow(max(1. + g * g - 2. * g * c, 1e-4), 1.5)); }
void main() {
  // Sprite frame rolled by a random angle (the atlas holds only 4 shapes); upright when seen from the side.
  float cr = cos(vRoll * .8 - .4), sr = sin(vRoll * .8 - .4); vec2 q = mat2(cr, sr, -sr, cr) * vQ;
  if (dot(q, q) > 1.) discard;
  float tile = floor(vTile + .5);
  vec4 tx = texture2D(uPuffs, (q * .5 + .5) * .5 + vec2(mod(tile, 2.), floor(tile / 2.)) * .5);
  float cov = tx.a; if (cov < .01) discard;
  // Bulb normal and depth from the atlas (rolled back into the sprite frame), then the front surface point X.
  vec2 nq = tx.rg * 2. - 1.; nq = mat2(cr, -sr, sr, cr) * nq; float nz = sqrt(max(1. - dot(nq, nq), 0.));
  vec3 nb = normalize(nq.x * vX + nq.y * vY + nz * vZ), X = vCentre + vQ.x * vX * vR + vQ.y * vY * vRy + vZ * tx.b * vR;
  // Flat base at the condensation level (40 m soft edge).
  float below = X.y - ${CLOUD.base.toFixed(3)}, alpha = cov * smoothstep(0., .04, below) * vFade;
  if (alpha < .004) discard;
  vec3 Ne = normalize((X - vCloudC) / (vRadii * vRadii));
  float tauSun = ${CLOUD.sigma}. * chord(X, uLightDir), tauTop = ${CLOUD.sigma}. * max(vCloudC.y + vRadii.y - X.y, 0.);
  float diffuseT = 1. / (1. + .75 * (1. - ${CLOUD.g}) * tauSun), skyT = 1. / (1. + .75 * (1. - ${CLOUD.g}) * tauTop * .4);
  // The bulbs: their sunward faces take the beam that reached them, the crevices only the diffuse part.
  float bulb = .55 + .45 * smoothstep(-.35, .65, dot(nb, uLightDir));
  vec3 col = uCloudSun * (.8 / O_PI) * diffuseT * bulb;
  vec3 N = normalize(Ne + nb);
  col += .8 / O_PI * (uSkyUp * (.5 + .5 * N.y) * skyT + uSeaUp * (.5 - .5 * N.y)) * (.75 + .25 * nz);
  // Forward-scattering rim (silver lining) on the thin edges between the Sun and the camera.
  col += uCloudSun * hg(dot(-vZ, uLightDir), .6) * (1. - cov) * 1.5 * diffuseT;
  col = col * vTr + vLin;
  gl_FragColor = vec4(col * alpha, alpha);
}`;
// Atlas of 4 cumulus sprites (2 x 2): RG bulb normal (sprite frame), B front depth (radii), A coverage.
function puffAtlas(seed, size = 256) {
  const r = rng(seed), S = 2 * size, data = new Uint8Array(S * S * 4);
  const hash = (x, y) => { let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; };
  for (let t = 0; t < 4; t++) {
    const bulbs = [];
    for (let i = 0; i < 34; i++) {
      // Bigger bulbs low and central, small turrets higher and on the flanks (sprite y is up when seen from the side).
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * .55, x = Math.cos(a) * d, y = Math.sin(a) * d * .8 + .05;
      bulbs.push([x, y, (r() - .5) * .3, (.16 + .26 * r()) * (1 - .45 * d) * (1 - .25 * Math.max(0, y))]);
    }
    const depth = new Float32Array(size * size), cov = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const u = (i + .5) / size * 2 - 1, v = (j + .5) / size * 2 - 1; let z = -2, edge = 0;
      for (const [x, y, cz, rad] of bulbs) { const d2 = (u - x) ** 2 + (v - y) ** 2; if (d2 < rad * rad) z = Math.max(z, cz + Math.sqrt(rad * rad - d2)); edge = Math.max(edge, 1 - Math.sqrt(d2) / rad); }
      // Fine cauliflower relief and ragged edges: fBm on the surface and on the coverage.
      let n = 0, amp = .5; for (let o = 0; o < 4; o++) { n += amp * vnoise(u * 6 * (1 << o) + t * 17, v * 6 * (1 << o) + t * 31); amp *= .5; }
      depth[j * size + i] = z > -2 ? z + .06 * (n - .5) : -2;
      cov[j * size + i] = THREE.MathUtils.smoothstep(edge + .18 * (n - .5), 0, .12) * (1 - THREE.MathUtils.smoothstep(Math.hypot(u, v), .8, 1));
    }
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const k = j * size + i, z = depth[k], at = (a, b) => { const w = depth[Math.min(size - 1, Math.max(0, b)) * size + Math.min(size - 1, Math.max(0, a))]; return w > -2 ? w : z - .05; };
      let nx = 0, ny = 0; if (z > -2) { nx = -(at(i + 1, j) - at(i - 1, j)) * size / 4; ny = -(at(i, j + 1) - at(i, j - 1)) * size / 4; }
      const l = Math.hypot(nx, ny, 1), o = (((t >> 1) * size + j) * S + (t & 1) * size + i) * 4;
      data[o] = (nx / l * .5 + .5) * 255; data[o + 1] = (ny / l * .5 + .5) * 255; data[o + 2] = Math.max(0, Math.min(1, z > -2 ? z : 0)) * 255; data[o + 3] = cov[k] * 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat); tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true; return tex;
}
function createCloudDeck({ U, renderer, cover, seed, downwind, shadowTarget, skyGlsl }) {
  const r = rng(seed * 31 + 5), span = 110, puffs = [], cloudsList = [];
  // Sizes: number density ~ D^-2 between 0.3 and 2.4 km (trade cumulus), base 0.65 km, height 0.5-1 x the width,
  // tops capped by the trade inversion (~2.2 km). Loose clusters; a clear area of 6 km around the recovery point.
  const area = 4 * span * span, target = cover * area; let covered = 0, guard = 0;
  // Trade cumulus gather in loose bands along the wind ("cloud streets") with clear lanes between them.
  const cluster = Array.from({ length: 90 }, () => [(r() * 2 - 1) * span, (r() * 2 - 1) * span, 3 + r() * 9]);
  while (covered < target && guard++ < 80000) {
    const D = 1 / (1 / .3 - r() * (1 / .3 - 1 / 2.4)), a = D / 2;
    let x, z; if (r() < .7) { const c = cluster[Math.floor(r() * cluster.length)], ang = r() * Math.PI * 2, rr = c[2] * Math.sqrt(r()), u = Math.cos(ang) * rr * 2.4, v = Math.sin(ang) * rr * .5; x = c[0] + u * downwind.x - v * downwind.y; z = c[1] + u * downwind.y + v * downwind.x; } else { x = (r() * 2 - 1) * span; z = (r() * 2 - 1) * span; }
    x = ((x + span) % (2 * span) + 2 * span) % (2 * span) - span; z = ((z + span) % (2 * span) + 2 * span) % (2 * span) - span;
    if (Math.hypot(x, z) < 6 + a) continue;
    // Small ones are humilis (flat, ~half as tall as wide), the larger mediocris (as tall as wide).
    const H = Math.min(2.2 - CLOUD.base, D < .6 ? D * (.35 + .25 * r()) : D * (.5 + .5 * r())), count = D < .6 ? 1 : D < 1.2 ? 3 : 5, id = cloudsList.length;
    cloudsList.push([x, z, a, H]); covered += Math.PI * a * a;
    for (let i = 0; i < count; i++) {
      const ang = r() * Math.PI * 2, u = count === 1 ? .35 : i / (count - 1), rad = count === 1 ? 0 : (1 - u) * .45 + .1 * r();
      const pr = count === 1 ? a * 1.1 : a * (.62 - .18 * u) * (.85 + .3 * r()), flat = count === 1 ? Math.min(1, H * 1.25 / pr) : 1;
      const y = count === 1 ? pr * flat * .5 : Math.min(H - pr * .4, Math.max(pr * .45, (.25 + .55 * u) * H));
      const p = [Math.cos(ang) * rad * a, y, Math.sin(ang) * rad * a, pr, Math.floor(r() * 4), r(), flat]; p.cloud = id; puffs.push(p);
    }
  }
  const n = puffs.length, geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3)); geo.setIndex([0, 1, 2, 0, 2, 3]);
  const rows = Math.ceil(n * 3 / 1024), table = new Float32Array(1024 * rows * 4);
  puffs.forEach((p, i) => { const c = cloudsList[p.cloud]; table.set([p[0], p[1], p[2], p[3]], i * 12); table.set(c, i * 12 + 4); table.set([p[4], p[5], p[6], 0], i * 12 + 8); });
  const puffData = new THREE.DataTexture(table, 1024, rows, THREE.RGBAFormat, THREE.FloatType); puffData.minFilter = puffData.magFilter = THREE.NearestFilter; puffData.needsUpdate = true;
  const drawOrder = new Float32Array(n), iIndex = new THREE.InstancedBufferAttribute(drawOrder, 1); iIndex.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aIndex', iIndex); geo.instanceCount = n;
  const byCloud = cloudsList.map(() => []), ppos = new Float32Array(n * 3); puffs.forEach((p, i) => { byCloud[p.cloud].push(i); ppos.set([p[0], p[1], p[2]], i * 3); });
  const atlas = puffAtlas(seed + 11);
  const CU = { uPuffData: { value: puffData }, uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uDrift: { value: new THREE.Vector3() }, uSpan: { value: span }, uCloudSun: { value: new THREE.Color() }, uSkyUp: { value: new THREE.Color() }, uSeaUp: { value: new THREE.Color() }, uPuffs: { value: atlas } };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...CU }, vertexShader: CLOUD_VERTEX(skyGlsl), fragmentShader: CLOUD_FRAGMENT(skyGlsl), transparent: true, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.name = 'cumulus';
  // Back to front: clouds by distance (keys = whole metres x 65536 + cloud, sorted natively), then the few sprites of
  // each cloud. Re-sorted when the camera or the drift moved; only the order (one float per sprite) is re-sent.
  const nc = cloudsList.length, keys = new Float64Array(nc), last = new THREE.Vector3(1e9, 0, 0), lastDrift = new THREE.Vector2(1e9, 0), pd = new Float32Array(8), pi = new Int32Array(8), cpos = new Float32Array(2 * cloudsList.length);
  const wrap = (v, s) => ((v + s) % (2 * s) + 2 * s) % (2 * s) - s;
  function sort(cam, drift) {
    for (let i = 0; i < nc; i++) { const c = cloudsList[i], wx = wrap(c[0] + drift.x, span), wz = wrap(c[1] + drift.y, span), x = wx - cam.x, z = wz - cam.z, y = CLOUD.base + c[3] * .5 - cam.y; cpos[2 * i] = wx; cpos[2 * i + 1] = wz; keys[i] = Math.floor(Math.sqrt(x * x + y * y + z * z) * 1000) * 65536 + i; }
    keys.sort();
    let k = 0;
    for (let j = nc - 1; j >= 0; j--) {
      const ci = keys[j] % 65536, list = byCloud[ci], cx = cpos[2 * ci], cz = cpos[2 * ci + 1], m = list.length;
      for (let q = 0; q < m; q++) { const u = list[q] * 3, dx = cx + ppos[u] - cam.x, dy = CLOUD.base + ppos[u + 1] - cam.y, dz = cz + ppos[u + 2] - cam.z; pd[q] = dx * dx + dy * dy + dz * dz; pi[q] = list[q]; }
      for (let q = 1; q < m; q++) for (let r = q; r > 0 && pd[r - 1] < pd[r]; r--) { const a = pd[r]; pd[r] = pd[r - 1]; pd[r - 1] = a; const b = pi[r]; pi[r] = pi[r - 1]; pi[r - 1] = b; }
      for (let q = 0; q < m; q++) drawOrder[k++] = pi[q];
    }
    iIndex.needsUpdate = true;
  }
  // Shadow map: transmittance of the deck towards the Sun at sea level over the 2 x span box: per cloud a quad over its
  // projected footprint, transmittances multiplied in. Redrawn when the Sun moved and every 2 s of drift.
  const shadowGeo = new THREE.InstancedBufferGeometry(); shadowGeo.setAttribute('position', geo.getAttribute('position')); shadowGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const sCloud = new Float32Array(cloudsList.length * 4); cloudsList.forEach((c, i) => sCloud.set(c, i * 4));
  shadowGeo.setAttribute('aCloud', new THREE.InstancedBufferAttribute(sCloud, 4)); shadowGeo.instanceCount = cloudsList.length;
  const shadowMat = new THREE.ShaderMaterial({
    uniforms: { uDrift: CU.uDrift, uSpan: CU.uSpan, uSunDir: U.uSunDir, uBox: U.uShadowBox },
    vertexShader: `attribute vec4 aCloud; uniform vec3 uDrift; uniform float uSpan; uniform vec3 uSunDir; uniform vec4 uBox; varying vec2 vXZ; varying vec4 vC;
      void main(){ vec2 c = mod(aCloud.xy + uDrift.xy + uSpan, 2. * uSpan) - uSpan; float h = ${CLOUD.base.toFixed(3)} + aCloud.w * .5; vec2 off = uSunDir.xz / max(uSunDir.y, .08) * h;
        vec2 ext = vec2(aCloud.z) + abs(uSunDir.xz) / max(uSunDir.y, .08) * aCloud.w * .6 + .1; vec2 p = c - off + position.xy * ext;
        vXZ = p; vC = vec4(c, aCloud.zw); gl_Position = vec4((p - uBox.xy) / uBox.z * 2. - 1., 0., 1.); }`,
    fragmentShader: `uniform vec3 uSunDir; varying vec2 vXZ; varying vec4 vC;
      void main(){ vec3 o = vec3(vXZ.x - vC.x, -${CLOUD.base.toFixed(3)}, vXZ.y - vC.y) / vec3(vC.z, vC.w, vC.z), v = uSunDir / vec3(vC.z, vC.w, vC.z);
        float a = dot(v, v), b = dot(o, v), c = dot(o, o) - 1., h = b * b - a * c, len = 0.;
        if (h > 0.) { float s = sqrt(h), t0 = max((-b - s) / a, -o.y / max(v.y, 1e-4)), t1 = (-b + s) / a; len = max(t1 - max(t0, 0.), 0.); }
        float T = 1. / (1. + .75 * (1. - ${CLOUD.g}) * ${CLOUD.sigma}. * len); gl_FragColor = vec4(T, T, T, 1.); }`,
    depthTest: false, depthWrite: false, transparent: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat); shadowMesh.frustumCulled = false;
  const shadowScene = new THREE.Scene(); shadowScene.add(shadowMesh); const shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const clearColor = new THREE.Color();
  function drawShadows() {
    const prev = renderer.getRenderTarget(), ca = renderer.getClearAlpha(); renderer.getClearColor(clearColor);
    U.uShadowBox.value.set(-span, -span, 2 * span, 1);
    renderer.setRenderTarget(shadowTarget); renderer.setClearColor(0xffffff, 1); renderer.clear(true, false, false); renderer.render(shadowScene, shadowCam);
    renderer.setRenderTarget(prev); renderer.setClearColor(clearColor, ca);
  }
  let lastShadow = -1e9; const drift = new THREE.Vector2(), tmp = new THREE.Color();
  return {
    mesh,
    update(t, camera, cam, sun, earth, U2, sunMoved) {
      // Clouds ride the trade wind at their level (~8 m/s), downwind.
      drift.set(downwind.x, downwind.y).multiplyScalar(.008 * t); drift.set(((drift.x % (2 * span)) + 2 * span) % (2 * span), ((drift.y % (2 * span)) + 2 * span) % (2 * span));
      CU.uDrift.value.set(drift.x, drift.y, 0);
      if (cam.distanceTo(last) > .08 + .03 * Math.max(0, cam.y) || drift.distanceTo(lastDrift) > .08) { sort(cam, drift); last.copy(cam); lastDrift.copy(drift); }
      if (sunMoved || Math.abs(t - lastShadow) > 2) { drawShadows(); lastShadow = t; }
      U.uShadowBox.value.w = sun.y > 0 ? 1 : 0;
      // Light at cloud level (~1.2 km): sunlight through less air, skylight from above, sea light from below.
      const sc = earth.uniforms.uSunColor.value, E = earth.uniforms.uSunE.value;
      earth.sunTransmittance(1.2, sun.y, CU.uCloudSun.value).multiply(sc).multiplyScalar(E);
      CU.uLightDir.value.copy(sun);
      // At night the Moon lights them (at the night exposure, see update).
      if (U.uMoonE.value.b > 0 && sun.y < -.05) { CU.uCloudSun.value.copy(U.uMoonE.value); CU.uLightDir.value.copy(U.uMoonDir.value); }
      CU.uSkyUp.value.copy(U.uEdSky.value); CU.uSeaUp.value.copy(U.uEdSky.value).add(tmp.copy(U.uSunE.value).multiplyScalar(Math.max(sun.y, 0))).multiplyScalar(.06);
    },
    // Product of the clouds' transmittances along the Sun ray from (x, y, z) km.
    sunVisibility(x, y, z, sunDir) {
      if (sunDir.y <= 0) return 1; let T = 1; const dx = CU.uDrift.value.x, dz = CU.uDrift.value.y;
      for (const c of cloudsList) {
        const cx = wrap(c[0] + dx, span), cz = wrap(c[1] + dz, span), ox = (x - cx) / c[2], oy = (y - CLOUD.base) / c[3], oz = (z - cz) / c[2];
        const vx = sunDir.x / c[2], vy = sunDir.y / c[3], vz = sunDir.z / c[2], a = vx * vx + vy * vy + vz * vz, b = ox * vx + oy * vy + oz * vz, cc = ox * ox + oy * oy + oz * oz - 1, h = b * b - a * cc;
        if (h <= 0) continue; const s = Math.sqrt(h), t0 = Math.max((-b - s) / a, -oy / Math.max(vy, 1e-4), 0), t1 = (-b + s) / a; if (t1 <= t0) continue;
        T *= 1 / (1 + .75 * (1 - CLOUD.g) * CLOUD.sigma * (t1 - t0));
      }
      return T;
    },
    dispose() { geo.dispose(); mat.dispose(); shadowGeo.dispose(); shadowMat.dispose(); atlas.dispose(); puffData.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Impact spray: the command module entered the water at ~9 m/s (three mains; ~10 m/s on two). The splash is a crown
// of droplets thrown up to ~5-10 m (NASA S72-36293) and a mist that drifts and thins in a few seconds; the white
// water left on the surface spreads to ~10 m and fades over ~20 s. Ballistic droplets (g = 9.81, light drag), mist with
// strong drag; lit like white water (sunlight and skylight, albedo ~0.6). A visual model, not a fluid simulation.
function createSpray() {
  const n = 2600, seeds = new Float32Array(n * 4), r = rng(99);
  for (let i = 0; i < n; i++) seeds.set([r(), r(), r(), i < 120 ? 1 : 0], i * 4);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const SU = { uT: { value: -1 }, uAt: { value: new THREE.Vector3() }, uScale: { value: 800 }, uLight: { value: new THREE.Color() } };
  const material = new THREE.ShaderMaterial({
    uniforms: SU, transparent: true, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `attribute vec4 aSeed; uniform float uT, uScale; uniform vec3 uAt; varying float vA, vMist;
      void main(){
        float t = uT, mist = aSeed.w, a = aSeed.x * 6.2832, k = aSeed.y;
        // Droplets leave the rim of the heat shield (r ~2 m): outwards 3-9 m/s, up 4-13 m/s. Mist: slower, strong drag.
        float vr = mist > .5 ? 2. + 5. * k : 3. + 6. * k, vy = mist > .5 ? 3. + 4. * aSeed.z : 4. + 9. * aSeed.z * (1. - .4 * k), tau = mist > .5 ? .7 : 3.;
        float hr = vr * tau * (1. - exp(-t / tau)), y = mist > .5 ? vy * tau * (1. - exp(-t / tau)) - 1.2 * t * t : vy * t - 4.905 * t * t;
        vec3 p = uAt + vec3(cos(a) * (2. + hr), max(y, -1.), sin(a) * (2. + hr)) * .001;
        float life = mist > .5 ? exp(-t / 1.1) * smoothstep(0., .15, t) : smoothstep(0., .05, t) * step(0., y) * (1. - .5 * smoothstep(.5, 2., t));
        vA = t < 0. || t > 8. ? 0. : life * (mist > .5 ? .12 : .45); vMist = mist;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        float size = mist > .5 ? (2. + 4. * t) * (.6 + .8 * aSeed.z) : .07 + .16 * aSeed.z * aSeed.z;   // metres (droplet clusters)
        gl_PointSize = vA > .002 ? clamp(size * .001 * uScale / -mv.z, 1., 600.) : 0.;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uLight; varying float vA, vMist;
      void main(){ vec2 q = gl_PointCoord * 2. - 1.; float d = dot(q, q); if (d > 1. || vA < .002) discard;
        float a = vA * (vMist > .5 ? (1. - d) * (1. - d) : smoothstep(1., .3, d)); gl_FragColor = vec4(uLight * a, a); }`,
  });
  const points = new THREE.Points(geo, material); points.frustumCulled = false; points.renderOrder = 6; points.visible = false; points.name = 'splash';
  let start = -1; const size = new THREE.Vector2(), tmp = new THREE.Color();
  return {
    points,
    trigger(t, x, z) { start = t; SU.uAt.value.set(x, 0, z); },
    update(t, camera, renderer, U, craftFoam) {
      const age = start < 0 ? -1 : t - start; SU.uT.value = age; points.visible = age >= 0 && age < 8;
      SU.uScale.value = renderer.getDrawingBufferSize(size).y / (2 * Math.tan(THREE.MathUtils.degToRad((camera.fov || 45) / 2)));
      // White water and spray: sunlight and skylight, albedo ~0.6, diffuse (Moon at night).
      SU.uLight.value.copy(U.uSunE.value).multiplyScalar(Math.max(U.uSunDir.value.y, 0) * .6 / Math.PI + .05).add(tmp.copy(U.uEdSky.value).multiplyScalar(.6 / Math.PI)).add(tmp.copy(U.uMoonE.value).multiplyScalar(.25));
      U.uSplash.value.set(age >= 0 ? 3 + 10 * (1 - Math.exp(-age / 4)) : 0, age >= 0 ? Math.exp(-age / 18) * Math.min(1, age * 4) : 0);
      U.uCraft.value.w = Math.max(craftFoam, age >= 0 ? .9 * Math.exp(-age / 40) : 0);
    },
    dispose() { geo.dispose(); material.dispose(); },
  };
}
