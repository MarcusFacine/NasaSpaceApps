// Recortes de terreno a partir dos DEMs LOLA do polo sul do NASA GSFC PGDA (produto 90,
// Barker et al. 2023, Planetary Science Journal 4:183, doi:10.60903/gsfcpgda-lola-spole).
// Os arquivos são Cloud-Optimized GeoTIFF: só a janela de cada local é baixada, por HTTP Range.
//
// - detalhe: 100 × 100 km, 769 × 769 amostras (~130 m), da versão de 80 m do LDEM_80S_20MPP_ADJ;
// - contexto: 400 × 400 km, 257 × 257 amostras (~1,56 km), da versão de 480 m do LDEM_60S_240MPP_ADJ.
//
// Alturas em km sobre a esfera de referência de 1737,4 km. Projeção dos arquivos: estereográfica
// polar sul sobre essa esfera, origem no polo, fator de escala 1, meridiano 0° para cima.
// Antes de gravar, o script compara o recorte novo com os arquivos existentes (DEM SVS de 474 m)
// e interrompe se a diferença indicar projeção ou orientação erradas.
import { fromUrl } from 'geotiff';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { sites } from '../dist/sites.js';

const R = 1737.4;
const PGDA = 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/';
const DETAIL = { file: 'LDEM_80S_20MPP_ADJ.TIF', level: 2, size: 769, extentKm: 100 };
const WIDE = { file: 'LDEM_60S_240MPP_ADJ.TIF', level: 1, size: 257, extentKm: 400 };
// Centro: 20 × 20 km da versão de 40 m, para o relevo perto do observador.
const INNER = { file: 'LDEM_80S_20MPP_ADJ.TIF', level: 1, size: 513, extentKm: 20 };
// Regiões permanentemente sombreadas (PSR), mesma grade do detalhe; 1 = PSR.
const PSR = { file: 'LPSR_80S_20MPP_ADJ.TIF', level: 2, size: 769, extentKm: 100 };
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

function basis(site) {
  const lat = rad(site.lat), lon = rad(site.lon);
  return {
    up: [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)],
    east: [-Math.sin(lon), Math.cos(lon), 0],
    north: [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)]
  };
}
// Ponto da grade (leste, norte em km no plano tangente) -> latitude/longitude planetocêntricas.
function gridLatLon(b, eastKm, northKm) {
  const v = b.up.map((u, i) => R * u + eastKm * b.east[i] + northKm * b.north[i]);
  const len = Math.hypot(...v);
  return [deg(Math.asin(v[2] / len)), deg(Math.atan2(v[1], v[0]))];
}
// Estereográfica polar sul, esfera R, k0 = 1, longitude central 0 (metros).
function stereo(latDeg, lonDeg, mirror) {
  const rho = 2 * R * 1000 * Math.tan(Math.PI / 4 + rad(latDeg) / 2);
  return [(mirror ? -1 : 1) * rho * Math.sin(rad(lonDeg)), rho * Math.cos(rad(lonDeg))];
}

// O servidor do PGDA às vezes recusa uma faixa isolada; repetir com espera resolve.
async function withRetry(fn, label) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (error) {
      if (attempt >= 6) throw error;
      console.warn(`${label}: tentativa ${attempt} falhou, repetindo`);
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

async function openLevel({ file, level }) {
  const tiff = await fromUrl(PGDA + file, { allowFullFile: false, blockSize: 65536 });
  const full = await tiff.getImage(0), img = await tiff.getImage(level);
  const [ox, oy] = full.getOrigin();
  const res = full.getResolution()[0] * full.getWidth() / img.getWidth();
  return { file, img, ox, oy, res, w: img.getWidth(), h: img.getHeight() };
}

async function sampleTile(src, site, n, extentKm, mirror = false, value = v => v / 1000) {
  const b = basis(site), cols = new Float64Array(n * n), rows = new Float64Array(n * n);
  let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity;
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const [la, lo] = gridLatLon(b, (col / (n - 1) - 0.5) * extentKm, (0.5 - row / (n - 1)) * extentKm);
    const [x, y] = stereo(la, lo, mirror), i = row * n + col;
    cols[i] = (x - src.ox) / src.res - 0.5; rows[i] = (src.oy - y) / src.res - 0.5;
    c0 = Math.min(c0, cols[i]); c1 = Math.max(c1, cols[i]); r0 = Math.min(r0, rows[i]); r1 = Math.max(r1, rows[i]);
  }
  const win = [Math.max(0, Math.floor(c0) - 2), Math.max(0, Math.floor(r0) - 2), Math.min(src.w, Math.ceil(c1) + 3), Math.min(src.h, Math.ceil(r1) + 3)];
  const raster = (await withRetry(() => src.img.readRasters({ window: win }), `${src.file} ${site.id}`))[0], ww = win[2] - win[0];
  const at = (c, r) => value(raster[(r - win[1]) * ww + (c - win[0])]);
  const heights = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const fc = Math.min(Math.max(cols[i], win[0]), win[2] - 1.001), fr = Math.min(Math.max(rows[i], win[1]), win[3] - 1.001);
    const c = Math.floor(fc), r = Math.floor(fr), tx = fc - c, ty = fr - r;
    const v = (at(c, r) * (1 - tx) + at(c + 1, r) * tx) * (1 - ty) + (at(c, r + 1) * (1 - tx) + at(c + 1, r + 1) * tx) * ty;
    if (!Number.isFinite(v)) throw new Error(`${src.file}: amostra sem dado em ${site.id}`);
    heights[i] = v;
  }
  return heights;
}

// Conferência contra os recortes SVS existentes (257 × 257, 100 km), mesma grade.
async function compare(src, site, mirror) {
  const old = await readFile(`dist/data/${site.id}.bin`).catch(() => null);
  if (!old || old.byteLength !== 257 * 257 * 4) return null;
  const a = new Float32Array(old.buffer, old.byteOffset, 257 * 257), b = await sampleTile(src, site, 257, 100, mirror);
  let sum = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; } ma /= a.length; mb /= a.length;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < a.length; i++) { sum += Math.abs(a[i] - b[i]); cov += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
  return { meanAbsKm: sum / a.length, correlation: cov / Math.sqrt(va * vb) };
}

const detail = await openLevel(DETAIL), wide = await openLevel(WIDE), inner = await openLevel(INNER), psr = await openLevel(PSR);
const previous = JSON.parse(await readFile('dist/data/metadata.json', 'utf8').catch(() => '{}'));
console.log(`Detalhe: ${detail.file} @ ${detail.res} m; contexto: ${wide.file} @ ${wide.res} m`);

// Orientação conferida em 14/11/2026: a versão espelhada dá ~1,2 km de diferença média e
// correlação baixa; a normal, ~8 m e 0,9999 em Shackleton e Malapert.
const checks = {};
for (const site of sites) {
  checks[site.id] = (await compare(detail, site, false)) ?? previous.validation?.[site.id] ?? null;
  console.log(site.id, 'comparação com o DEM SVS 474 m:', checks[site.id]);
}
const bad = Object.entries(checks).filter(([, c]) => c && (c.correlation < 0.97 || c.meanAbsKm > 0.15));
if (bad.length) throw new Error(`Recorte não confere com o DEM SVS: ${bad.map(([id]) => id).join(', ')}. Nada foi gravado.`);

const metadata = {
  source: PGDA + DETAIL.file, sourceOverviewMeters: detail.res, sourceNativeMeters: 20,
  wideSource: PGDA + WIDE.file, wideOverviewMeters: wide.res,
  credit: 'NASA GSFC PGDA / LRO LOLA — Barker et al. 2023, Planetary Science Journal 4:183',
  doi: '10.60903/gsfcpgda-lola-spole',
  sourceMeridionalSpacingKm: detail.res / 1000, radiusKm: R,
  tileSize: DETAIL.size, extentKm: DETAIL.extentKm,
  wide: { tileSize: WIDE.size, extentKm: WIDE.extentKm },
  inner: { tileSize: INNER.size, extentKm: INNER.extentKm, sourceOverviewMeters: inner.res },
  psr: { tileSize: PSR.size, extentKm: PSR.extentKm, source: PGDA + PSR.file, encoding: 'uint8, 255 = PSR' },
  validation: checks, sites: {}
};
await mkdir('dist/data', { recursive: true });
for (const site of sites) {
  const heights = await sampleTile(detail, site, DETAIL.size, DETAIL.extentKm);
  const context = await sampleTile(wide, site, WIDE.size, WIDE.extentKm);
  await writeFile(`dist/data/${site.id}.bin`, Buffer.from(heights.buffer));
  await writeFile(`dist/data/${site.id}-wide.bin`, Buffer.from(context.buffer));
  const centre = await sampleTile(inner, site, INNER.size, INNER.extentKm);
  await writeFile(`dist/data/${site.id}-inner.bin`, Buffer.from(centre.buffer));
  // PSR: binário (0/1) na resolução nativa; a versão de 80 m já vem interpolada, então o valor é a fração sombreada.
  const shadow = await sampleTile(psr, site, PSR.size, PSR.extentKm, false, v => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0));
  await writeFile(`dist/data/${site.id}-psr.bin`, Buffer.from(Uint8Array.from(shadow, f => Math.round(Math.min(1, f) * 255))));
  let min = Infinity, max = -Infinity; for (const h of heights) { if (h < min) min = h; if (h > max) max = h; }
  let psrCells = 0; for (const f of shadow) if (f > 0.5) psrCells++;
  metadata.sites[site.id] = { elevationKm: heights[(heights.length - 1) / 2], innerElevationKm: centre[(centre.length - 1) / 2], minKm: min, maxKm: max, psrFraction: psrCells / shadow.length };
  console.log(site.id, metadata.sites[site.id]);
}
await writeFile('dist/data/metadata.json', JSON.stringify(metadata, null, 2));
console.log('Recortes de terreno PGDA gravados.');
