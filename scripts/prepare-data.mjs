import { fromUrl } from 'geotiff';
import { mkdir, writeFile, cp, stat } from 'node:fs/promises';
import { sites } from '../dist/sites.js';

const base = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/';
await mkdir('dist/data', { recursive: true });
await mkdir('dist/vendor', { recursive: true });
await mkdir('dist/assets', { recursive: true });
await cp('node_modules/three/build/three.module.js', 'dist/vendor/three.module.js');
await cp('node_modules/three/build/three.core.js', 'dist/vendor/three.core.js');
await cp('node_modules/three/examples/jsm/controls/OrbitControls.js', 'dist/vendor/OrbitControls.js');
// Loaders and post-processing for the mission scene ("three/addons/" in the import map of dist/app).
for (const file of ['loaders/GLTFLoader.js', 'loaders/DRACOLoader.js', 'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js', 'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/ShaderPass.js', 'postprocessing/MaskPass.js', 'postprocessing/Pass.js', 'postprocessing/UnrealBloomPass.js', 'postprocessing/OutputPass.js', 'shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js', 'shaders/OutputShader.js']) {
  await mkdir(`dist/vendor/addons/${file.split('/')[0]}`, { recursive: true }); await cp(`node_modules/three/examples/jsm/${file}`, `dist/vendor/addons/${file}`);
}
await mkdir('dist/vendor/addons/libs/draco', { recursive: true });
for (const file of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) await cp(`node_modules/three/examples/jsm/libs/draco/gltf/${file}`, `dist/vendor/addons/libs/draco/${file}`);
await cp('node_modules/three/LICENSE', 'dist/vendor/THREE-LICENSE.txt');
await cp('node_modules/astronomy-engine/astronomy.browser.min.js', 'dist/vendor/astronomy.browser.min.js');
// Astronomy Engine's MIT license is included in the browser bundle header.

async function download(url, destination) {
  if(await stat(destination).catch(()=>null)) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}
await Promise.all([
  download(base + 'lroc_color_2k.jpg', 'dist/assets/moon-color.jpg'),
  download('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg', 'dist/assets/earth-color.jpg'),
  download('https://threejs.org/examples/textures/planets/earth_clouds_1024.png', 'dist/assets/earth-clouds.png'),
  download('https://threejs.org/examples/textures/planets/earth_lights_2048.png', 'dist/assets/earth-lights.png')
]);

// Terrain tiles now come from the NASA GSFC PGDA 20 m south pole DEM (scripts/prepare-terrain.mjs).
// The SVS 474 m reading below is kept only as an optional cross-check: node scripts/prepare-data.mjs --svs-check
if (!process.argv.includes('--svs-check')) {
  await import('./prepare-terrain.mjs');
  process.exit(0);
}
// HTTP ranges retrieve only the southern polar rows of the 16-bit LOLA DEM.
const tiff = await fromUrl(base + 'ldem_64_uint.tif', { allowFullFile: false, blockSize: 65536 });
const image = await tiff.getImage();
const width = image.getWidth(), height = image.getHeight();
const y0 = Math.floor((90 + 83) / 180 * height);
console.log(`Reading LOLA southern cap: ${width} × ${height - y0}`);
// This NASA TIFF is little-endian, uncompressed, one contiguous strip per row.
// Coalesce the polar strips into a single range rather than hundreds of requests.
const directory = image.getFileDirectory();
if(directory.getValue('Compression') !== 1 || directory.getValue('RowsPerStrip') !== 1) throw new Error('Unexpected DEM encoding');
const firstOffset = Number(await directory.loadValueIndexed('StripOffsets',y0));
const lastOffset = Number(await directory.loadValueIndexed('StripOffsets',height-1));
const lastBytes = Number(await directory.loadValueIndexed('StripByteCounts',height-1));
if(lastOffset-firstOffset !== (height-y0-1)*width*2) throw new Error('DEM rows are not contiguous');
const response = await fetch(base+'ldem_64_uint.tif',{headers:{Range:`bytes=${firstOffset}-${lastOffset+lastBytes-1}`}});
if(response.status !== 206) throw new Error('DEM server did not return a partial response');
const cap = await response.arrayBuffer();
if(cap.byteLength !== (height-y0)*width*2) throw new Error('Incomplete polar DEM');
const raster = new Uint16Array(cap);
const rows = height - y0;
const R = 1737.4;
const rad = d => d * Math.PI / 180;
function sample(lat, lon) {
  const fx = ((lon + 180) / 360 * width - .5 + width) % width;
  const fy = Math.max(0, Math.min(rows - 1.001, (90 - lat) / 180 * height - .5 - y0));
  const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
  const val = (a, b) => (raster[b * width + ((a + width) % width)] - 20000) / 2000;
  return (val(x,y)*(1-tx) + val(x+1,y)*tx)*(1-ty) + (val(x,y+1)*(1-tx) + val(x+1,y+1)*tx)*ty;
}
const metadata = { source: base + 'ldem_64_uint.tif', credit: "NASA's Scientific Visualization Studio / LRO LOLA", sourcePixelsPerDegree: 64, sourceMeridionalSpacingKm: Math.PI * R / 180 / 64, radiusKm: R, tileSize: 257, extentKm: 100, sites: {} };
for (const site of sites) {
  const lat = rad(site.lat), lon = rad(site.lon), n = 257, extent = 100;
  const up = [Math.cos(lat)*Math.cos(lon), Math.cos(lat)*Math.sin(lon), Math.sin(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat)*Math.cos(lon), -Math.sin(lat)*Math.sin(lon), Math.cos(lat)];
  const heights = new Float32Array(n*n);
  for(let row=0;row<n;row++) for(let col=0;col<n;col++) {
    const e = (col/(n-1)-.5)*extent, northKm = (.5-row/(n-1))*extent;
    const v = up.map((u,i)=>R*u+e*east[i]+northKm*north[i]);
    const len=Math.hypot(...v), la=Math.asin(v[2]/len)*180/Math.PI, lo=Math.atan2(v[1],v[0])*180/Math.PI;
    heights[row*n+col]=sample(la,lo);
  }
  await writeFile(`dist/data/${site.id}.bin`, Buffer.from(heights.buffer));
  metadata.sites[site.id] = { elevationKm: sample(site.lat,site.lon), minKm: Math.min(...heights), maxKm: Math.max(...heights) };
  console.log(site.id, metadata.sites[site.id]);
}
await writeFile('dist/data/metadata.json', JSON.stringify(metadata,null,2));
console.log('Terrain tiles and local libraries ready.');
