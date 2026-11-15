// Gera dist/data/stars.json a partir do catálogo HYG v4.1 (astronexus, CC BY-SA 4.0).
// Mantém as estrelas visíveis a olho nu (magnitude visual <= 6,0), sem o Sol.
// Formato: { source, license, epoch, fields, stars: [[raGraus, decGraus, mag, indiceDeCor], ...] }
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';

const url = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';
const cache = 'data-source/hygdata_v41.csv';
const limit = 6.0;

await mkdir('data-source', { recursive: true });
if (!(await stat(cache).catch(() => null))) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download falhou: ${response.status} ${url}`);
  await writeFile(cache, Buffer.from(await response.arrayBuffer()));
}

const lines = (await readFile(cache, 'utf8')).split(/\r?\n/);
const header = lines[0].split(',').map(h => h.replaceAll('"', ''));
const col = name => { const i = header.indexOf(name); if (i < 0) throw new Error(`Coluna ausente: ${name}`); return i; };
const iRa = col('ra'), iDec = col('dec'), iMag = col('mag'), iCi = col('ci'), iDist = col('dist'), iProper = col('proper');

const stars = [];
for (const line of lines.slice(1)) {
  if (!line) continue;
  // O HYG não usa vírgulas dentro de campos numéricos; nomes próprios não contêm vírgula.
  const f = line.split(',').map(v => v.replaceAll('"', ''));
  const mag = Number(f[iMag]), dist = Number(f[iDist]);
  if (!Number.isFinite(mag) || mag > limit || dist === 0 || f[iProper] === 'Sol') continue;
  const ra = Number(f[iRa]) * 15, dec = Number(f[iDec]), ci = Number(f[iCi]);
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
  stars.push([+ra.toFixed(3), +dec.toFixed(3), +mag.toFixed(2), Number.isFinite(ci) ? +ci.toFixed(2) : 0.6]);
}
stars.sort((a, b) => a[2] - b[2]);

await mkdir('dist/data', { recursive: true });
await writeFile('dist/data/stars.json', JSON.stringify({
  source: 'HYG Database v4.1 (astronexus/HYG-Database)',
  license: 'CC BY-SA 4.0',
  epoch: 'J2000 (ICRS), sem movimento próprio',
  fields: ['raDeg', 'decDeg', 'mag', 'colorIndexBV'],
  stars
}));
console.log(`stars.json: ${stars.length} estrelas até magnitude ${limit}`);
