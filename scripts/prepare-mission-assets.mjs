// High-resolution textures used only by the mission simulation (dist/assets/mission/).
// Earth: three.js example textures, 4096 px (day, night lights, and bump/roughness/clouds packed in R/G/B).
// Moon: NASA SVS CGI Moon Kit (svs.gsfc.nasa.gov/4720): LROC WAC colour, and a tangent-space normal map
// computed here from the LOLA elevation model ldem_16 (16 px/degree) at true vertical scale.
// Sky: NASA SVS Deep Star Maps 2020, Milky Way only (the stars themselves come from the HYG catalogue).
// Spacecraft models (dist/assets/mission/models) are NASA 3D Resources GLB files, copied as published.
// 8k set (*-8k.*), swapped in lazily by the mission once the 4k set is on screen: NASA Blue Marble Next
// Generation, Black Marble 2016, Blue Marble 2002 clouds, MODIS land/water mask and the 8k LROC colour map.
// Needs network and ffmpeg/ffprobe on the PATH. Large source files stay in a cache folder outside dist.
// Idempotent: a file that already exists is neither downloaded nor rebuilt (delete it to rebuild it).
import { fromFile } from 'geotiff';
import { mkdir, writeFile, rename, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';

const out = 'dist/assets/mission', cache = process.env.MISSION_CACHE || path.join(tmpdir(), 'horisite-mission-cache');
await mkdir(out, { recursive: true }); await mkdir(cache, { recursive: true });
const exists = file => stat(file).then(() => true, () => false);
// `url` may be a list: mirrors are tried in order. A host that does not answer within 30 s is skipped (the
// timer stops once the headers arrive, so a slow but live transfer is never cut). Written through a .part
// file, so an interrupted run never leaves a truncated file that a later run would take as complete.
// `check` (optional): { sha256 } for a byte-exact source, { type } for a server that answers errors with 200.
async function download(url, destination, check = {}) {
  if (await exists(destination)) return;
  let failure;
  for (const source of [url].flat()) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 30000);
    try {
      const response = await fetch(source, { signal: abort.signal }); clearTimeout(timer);
      if (!response.ok) throw new Error(`Download failed: ${response.status} ${source}`);
      if (check.type && !(response.headers.get('content-type') || '').startsWith(check.type)) throw new Error(`Not ${check.type}: ${source}\n${(await response.text()).slice(0, 400)}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (check.sha256 && createHash('sha256').update(data).digest('hex') !== check.sha256) throw new Error(`Checksum mismatch: ${source}`);
      await writeFile(destination + '.part', data); await rename(destination + '.part', destination);
      console.log('baixado', path.basename(destination), source === [url].flat()[0] ? '' : `(espelho: ${source})`); return;
    } catch (error) { clearTimeout(timer); failure = error; console.warn('falhou', source, error.message); }
  }
  throw failure;
}
const ffmpeg = (args, input) => new Promise((resolve, reject) => {
  const p = spawn('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
  p.on('error', reject); p.on('exit', code => code ? reject(new Error(`ffmpeg ${code}`)) : resolve());
  if (input) { p.stdin.on('error', () => {}); p.stdin.end(input); }
});

const three = 'https://threejs.org/examples/textures/planets/', svs = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/';
await Promise.all([
  download(three + 'earth_day_4096.jpg', `${out}/earth-day.jpg`),
  download(three + 'earth_night_4096.jpg', `${out}/earth-night.jpg`),
  download(three + 'earth_bump_roughness_clouds_4096.jpg', `${out}/earth-brc.jpg`),
  download(svs + 'lroc_color_poles_4k.tif', `${cache}/lroc_color_poles_4k.tif`),
  download(svs + 'ldem_16_uint.tif', `${cache}/ldem_16_uint.tif`),
  // NASA SVS Deep Star Maps 2020 (svs.gsfc.nasa.gov/4851): the Milky Way alone, celestial coordinates.
  download('https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_4k.exr', `${cache}/milkyway_2020_4k.exr`)
]);
if (!await exists(`${out}/milkyway.jpg`)) { await ffmpeg(['-apply_trc', 'iec61966_2_1', '-i', `${cache}/milkyway_2020_4k.exr`, '-vf', 'scale=4096:2048:flags=lanczos', '-q:v', '3', `${out}/milkyway.jpg`]); console.log('milkyway.jpg'); }

if (!await exists(`${out}/moon-color.jpg`)) { await ffmpeg(['-i', `${cache}/lroc_color_poles_4k.tif`, '-vf', 'scale=4096:2048:flags=lanczos', '-q:v', '3', `${out}/moon-color.jpg`]); console.log('moon-color.jpg'); }

if (!await exists(`${out}/moon-normal.jpg`)) {
  // ldem_16_uint: 5760 × 2880, half-metre units; rows from +90° to −90°, columns from 0° eastwards? The kit is
  // registered like the colour map, so pixels pair one to one after resampling.
  const W = 4096, H = 2048, R = 1737400;
  const image = await (await fromFile(`${cache}/ldem_16_uint.tif`)).getImage();
  const [raw] = await image.readRasters({ width: W, height: H, resampleMethod: 'bilinear' });
  const h = new Float32Array(W * H); for (let i = 0; i < h.length; i++) h[i] = raw[i] * 0.5;
  const rgb = Buffer.alloc(W * H * 3), dy = Math.PI * R / H;
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI, dx = 2 * Math.PI * R * Math.max(0.02, Math.cos(lat)) / W, up = Math.max(0, y - 1), down = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const l = h[y * W + (x + W - 1) % W], r = h[y * W + (x + 1) % W], n = h[up * W + x], s = h[down * W + x];
      // Tangent space: +x east, +y north, +z out. True vertical scale.
      const nx = -(r - l) / (2 * dx), ny = -(n - s) / ((down - up) * dy), len = Math.hypot(nx, ny, 1), i = (y * W + x) * 3;
      rgb[i] = Math.round((nx / len * 0.5 + 0.5) * 255); rgb[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255); rgb[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
    }
  }
  await ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', '-', '-q:v', '2', `${out}/moon-normal.jpg`], rgb); console.log('moon-normal.jpg');
}

// ---------------------------------------------------------------------------------------------------------
// 8k set. Every map is equirectangular, north up, longitude −180° at the left edge and 0° at the centre,
// exactly like the 4k files above (verified by cross-correlation against them: zero shift). All NASA,
// public domain; credit lines in the "Dados e método" panel.
// ---------------------------------------------------------------------------------------------------------
const eo = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/', W8 = 8192, H8 = 4096;
const src = {
  // Blue Marble Next Generation (Stöckli et al. 2005), September 2004, BASE map: MODIS surface reflectance only.
  // Not the "topo.bathy" variant on purpose: that one paints a bright shaded relief of the sea floor (mid-ocean
  // ridges, trenches) that no camera ever sees and bakes a fixed-sun hillshade into the land, which then
  // fights the real sunlight of the renderer. September: northern snow near its minimum, southern winter not
  // yet at its maximum and the monsoon green-up done, a near-equinox look for a mission that can fly any month.
  day: [`${eo}bmng/bmng-base/september/world.200409.3x21600x10800.jpg`, 21600, 10800],
  // Black Marble 2016 (Suomi NPP VIIRS day/night band), the grayscale release: lights only. The colour release
  // paints the land in a dim blue that would glow on the night side as if moonlit.
  night: [`${eo}imagerecords/144000/144897/BlackMarble_2016_3km_gray.jpg`, 13500, 6750],
  // Blue Marble 2002 cloud layer (Visible Earth 57747): MODIS composite, two days of visible imagery plus one
  // of thermal infrared over the poles. The same data as the B channel of earth-brc.jpg (r = 0.95), at 2×.
  // eoimages.gsfc.nasa.gov is being retired; the Internet Archive copy of the same URL is the byte-identical
  // mirror (checked by SHA-256).
  clouds: [['https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_8192.tif',
    'https://web.archive.org/web/20261018141030id_/https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_8192.tif'], 8192, 4096,
  'd137775d8966ab8d443fd5126dc6e7ad72072bc1ed50555c5818d221735daf0f'],
  moon: [svs + 'lroc_color_poles_8k.tif', 8192, 4096]
};
const file = key => `${cache}/${path.basename([src[key][0]].flat()[0])}`;
await Promise.all(Object.keys(src).map(key => download(src[key][0], file(key), { sha256: src[key][3] })));
// Land/water: MODIS MOD44W v6 (250 m, 2015) rendered by NASA GIBS as 8 WMS tiles of 90° × 90° (the server
// refuses a single 16k image), i.e. 16384 × 8192 before the area-averaged reduction to 8192 × 4096.
const gibs = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_L3_Land_Water_Mask&STYLES=&CRS=EPSG:4326&WIDTH=4096&HEIGHT=4096&FORMAT=image/png&TIME=2015-01-01';
const tiles = []; await mkdir(`${cache}/mod44w`, { recursive: true });
for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) tiles.push(`${cache}/mod44w/tile_${row}_${col}.png`);
for (const [i, tile] of tiles.entries()) {
  const row = i >> 2, col = i & 3, lat = 90 - 90 * row, lon = -180 + 90 * col;
  await download(`${gibs}&BBOX=${lat - 90},${lon},${lat},${lon + 90}`, tile, { type: 'image/png' }); // WMS 1.3.0 EPSG:4326: lat,lon
}
const probe = file => new Promise((resolve, reject) => {
  const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]); let text = '';
  p.stdout.on('data', d => text += d); p.on('error', reject); p.on('exit', () => resolve(text.trim()));
});
// A changed upstream file must fail loudly, not silently shift or rescale a map.
for (const key of Object.keys(src)) { const size = await probe(file(key)); if (size !== `${src[key][1]},${src[key][2]}`) throw new Error(`${file(key)}: ${size}, expected ${src[key][1]}×${src[key][2]}`); }
for (const tile of tiles) if (await probe(tile) !== '4096,4096') throw new Error(`${tile}: not a 4096² GIBS tile (an XML error?) - delete it and retry`);

// Reduction in linear light: the maps are decoded as sRGB by the renderer, so averaging their encoded values
// would darken every sub-pixel bright feature (a lit source pixel on black loses 70 % of its light at the 1.65×
// reduction of the night map, 90 % at the 2.6× of the day map). 16-bit samples through the exact sRGB curves;
// the round trip alone is lossless.
const toLinear = 'if(lte(val,2651),val/12.92,65535*pow((val/65535+0.055)/1.055,2.4))';
const toSRGB = 'if(lte(val,205),val*12.92,65535*(1.055*pow(val/65535,1/2.4)-0.055))';
const lut = e => `lutrgb=r='${e}':g='${e}':b='${e}'`;
const linearScale = kernel => `format=rgb48le,${lut(toLinear)},scale=${W8}:${H8}:flags=${kernel}+accurate_rnd+full_chroma_int,${lut(toSRGB)}`;
const exact = ['-sws_flags', 'accurate_rnd+full_chroma_int'];
// JPEG qualities chosen so the whole 8k set stays under 15 MB (see the report for sizes).
if (!await exists(`${out}/earth-day-8k.jpg`)) { await ffmpeg([...exact, '-i', file('day'), '-vf', `${linearScale('lanczos')},format=yuvj420p`, '-q:v', '3', `${out}/earth-day-8k.jpg`]); console.log('earth-day-8k.jpg'); }
// Area filter for the lights: it conserves the emitted energy exactly and never rings around point sources.
if (!await exists(`${out}/earth-night-8k.jpg`)) { await ffmpeg([...exact, '-i', file('night'), '-vf', `${linearScale('area')},format=gray`, '-q:v', '3', `${out}/earth-night-8k.jpg`]); console.log('earth-night-8k.jpg'); }
// Cloud opacity is used as data (read linearly, like earth-brc.jpg B): no resampling, no curve, one channel.
if (!await exists(`${out}/earth-clouds-8k.jpg`)) { await ffmpeg(['-i', file('clouds'), '-vf', 'format=gray', '-q:v', '4', `${out}/earth-clouds-8k.jpg`]); console.log('earth-clouds-8k.jpg'); }
if (!await exists(`${out}/moon-color-8k.jpg`)) { await ffmpeg(['-i', file('moon'), '-vf', 'format=yuvj420p', '-q:v', '4', `${out}/moon-color-8k.jpg`]); console.log('moon-color-8k.jpg'); }

if (!await exists(`${out}/earth-water-8k.png`)) {
  // 255 = open water (oceans, seas, lakes, wide rivers), 0 = land or ice, coasts fractional (area coverage).
  // North of 55.5° S: MOD44W. MOD44W has no Antarctica (the GIBS layer reads "water" there), so south of it
  // water is classified from the Blue Marble day map itself: open sea there is the dark navy fill
  // (B ≫ R), ice and rock are not. September Blue Marble has no sea ice: polar seas are open water here.
  // 'close', not 'exit': it fires only once stdout has been fully delivered.
  const run = (args, stdio) => { const p = spawn('ffmpeg', ['-loglevel', 'error', ...args], { stdio }); return [p, new Promise((ok, ko) => { p.on('error', ko); p.on('close', c => c ? ko(new Error(`ffmpeg ${c}`)) : ok()); })]; };
  const read = async (args) => { const [p, done] = run(args, ['ignore', 'pipe', 'inherit']), parts = []; for await (const c of p.stdout) parts.push(c); await done; return Buffer.concat(parts); };
  const inputs = tiles.flatMap(t => ['-i', t]), layout = tiles.map((t, i) => `${(i & 3) * 4096}_${(i >> 2) * 4096}`).join('|');
  const modis = await read([...inputs, '-filter_complex', `${tiles.map((t, i) => `[${i}]`).join('')}xstack=inputs=8:layout=${layout},alphaextract,scale=${W8}:${H8}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  // Blue Marble classifier at full 21600 × 10800 resolution, streamed, then area-reduced like the MODIS mask.
  const [dec, decoded] = run([...exact, '-i', file('day'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], ['ignore', 'pipe', 'inherit']);
  const [enc, encoded] = run(['-f', 'rawvideo', '-pix_fmt', 'gray', '-s', '21600x10800', '-i', '-', '-vf', `scale=${W8}:${H8}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], ['pipe', 'pipe', 'inherit']);
  const parts = []; enc.stdout.on('data', c => parts.push(c));
  let rest = Buffer.alloc(0);
  for await (const chunk of dec.stdout) {
    const data = rest.length ? Buffer.concat([rest, chunk]) : chunk, n = Math.floor(data.length / 3), mask = Buffer.allocUnsafe(n);
    for (let i = 0, j = 0; i < n; i++, j += 3) { const r = data[j], b = data[j + 2]; mask[i] = b - r >= Math.max(3, 0.35 * b) ? 255 : 0; }
    rest = Buffer.from(data.subarray(n * 3)); if (!enc.stdin.write(mask)) await once(enc.stdin, 'drain');
  }
  enc.stdin.end(); await Promise.all([decoded, encoded]); const marble = Buffer.concat(parts);
  if (modis.length !== W8 * H8 || marble.length !== W8 * H8) throw new Error('water mask: unexpected raster size');
  const south = Math.floor((90 + 55.5) / 180 * H8) * W8; marble.copy(modis, south, south);
  await ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W8}x${H8}`, '-i', '-', '-compression_level', '9', `${out}/earth-water-8k.png`], modis); console.log('earth-water-8k.png');
}
let total = 0; for (const name of ['earth-day-8k.jpg', 'earth-night-8k.jpg', 'earth-clouds-8k.jpg', 'earth-water-8k.png', 'moon-color-8k.jpg']) total += (await stat(`${out}/${name}`)).size;
console.log(`conjunto 8k: ${(total / 1e6).toFixed(1)} MB`);
console.log('pronto:', out);
