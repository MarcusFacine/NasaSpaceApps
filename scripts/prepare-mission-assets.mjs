// High-resolution textures used only by the mission simulation (dist/assets/mission/).
// Earth: three.js example textures, 4096 px (day, night lights, and bump/roughness/clouds packed in R/G/B).
// Moon: NASA SVS CGI Moon Kit (svs.gsfc.nasa.gov/4720): LROC WAC colour, and a tangent-space normal map
// computed here from the LOLA elevation model ldem_16 (16 px/degree) at true vertical scale.
// Sky: NASA SVS Deep Star Maps 2020, Milky Way only (the stars themselves come from the HYG catalogue).
// Spacecraft models (dist/assets/mission/models) are NASA 3D Resources GLB files, copied as published.
// Needs network and ffmpeg on the PATH. Large source files stay in a cache folder outside dist.
import { fromFile } from 'geotiff';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const out = 'dist/assets/mission', cache = process.env.MISSION_CACHE || path.join(tmpdir(), 'horisite-mission-cache');
await mkdir(out, { recursive: true }); await mkdir(cache, { recursive: true });
const exists = file => stat(file).then(() => true, () => false);
async function download(url, destination) {
  if (await exists(destination)) return;
  const response = await fetch(url); if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer())); console.log('baixado', path.basename(destination));
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
console.log('pronto:', out);
