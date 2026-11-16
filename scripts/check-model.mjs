import assert from 'node:assert/strict';
import * as Astronomy from 'astronomy-engine';
import { readFile } from 'node:fs/promises';
import { sites } from '../dist/sites.js';
import { lunarFrame,ephemeris,unit,Terrain,evaluate,longestRun } from '../dist/model.js';
const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
const metadata=JSON.parse(await readFile('dist/data/metadata.json','utf8'));
for(const iso of ['2000-01-01T12:00:00Z','2026-10-02T12:00:00Z','2030-06-15T00:00:00Z','2050-12-01T00:00:00Z']){
  const date=new Date(iso),frame=lunarFrame(date,Astronomy),eph=ephemeris(date,Astronomy),earth=unit(eph.earth),lib=Astronomy.Libration(date);
  for(const basis of [frame.x,frame.y,frame.z])assert.ok(Math.abs(dot(basis,basis)-1)<1e-12);
  assert.ok(Math.abs(dot(frame.x,frame.y))<1e-12);assert.ok(Math.abs(dot(frame.y,frame.z))<1e-12);
  const lat=Math.asin(earth[2])*180/Math.PI,lon=Math.atan2(earth[1],earth[0])*180/Math.PI;
  assert.ok(Math.abs(lat-lib.elat)<.1,`Sub-Earth latitude diverged at ${iso}`);
  assert.ok(Math.abs(lon-lib.elon)<.1,`Sub-Earth longitude diverged at ${iso}`);
  for(const site of sites){
    const bytes=await readFile(`dist/data/${site.id}.bin`),floats=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
    const terrain=new Terrain(site,floats,metadata);assert.ok(Math.abs(terrain.height(0,0))<1e-5);
    const low=terrain.horizon(2),high=terrain.horizon(20);
    assert.ok(high.every((v,i)=>v<=low[i]+1e-5),'Taller observer cannot have a higher terrain horizon');
    const m=evaluate(site,date,terrain,Astronomy,2,'tracking',eph),flat=evaluate(site,date,terrain,Astronomy,2,'horizontal',eph);
    assert.ok(Math.abs(m.sun.elevation)<10,'Polar solar altitude outside plausible bounds');
    assert.ok(m.irradiance>=0&&m.irradiance<1500);assert.ok(flat.irradiance<=m.irradiance);
    assert.ok(m.earth.distanceKm>320000&&m.earth.distanceKm<420000);
    assert.equal(m.sun.available,m.sun.margin>0&&m.sun.eclipse<1);assert.equal(m.earth.available,m.earth.margin>0);
  }
}
assert.deepEqual(longestRun([true,false,true,true,true,false,true,true]),{start:2,length:3});
// Eclipses: the Earth covering the Sun, seen from the site. Total lunar eclipse of 26 June 2029 (Astronomy Engine):
// at the peak the south pole sits in the umbra (no direct light); the site's totality starts after the Moon's limb
// enters the umbra and before the whole Moon is inside it; outside the penumbral window there is no eclipse.
{
  const site=sites.find(s=>s.id==='malapert'),bytes=await readFile('dist/data/malapert.bin'),terrain=new Terrain(site,new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4),metadata);
  const e=Astronomy.SearchLunarEclipse(new Date('2029-06-01T00:00:00Z')),peak=+e.peak.date,at=min=>evaluate(site,new Date(peak+min*60000),terrain,Astronomy,2,'tracking');
  assert.equal(e.kind,'total');
  const mid=at(0);assert.equal(mid.sun.eclipse,1);assert.equal(mid.sun.available,false);assert.equal(mid.irradiance,0);assert.ok(mid.sun.margin>0,'Sun above the relief: only the Earth hides it');
  let totalIn=null;for(let m=-e.sd_partial;m<=0;m++)if(at(m).sun.eclipse>=1){totalIn=m;break;}
  assert.ok(totalIn>-e.sd_partial&&totalIn<-e.sd_total,'Site totality must begin between umbral contact and full immersion');
  const partial=at(totalIn-10);assert.ok(partial.sun.eclipse>0&&partial.sun.eclipse<1&&partial.irradiance>0&&partial.irradiance<mid.irradiance+1361);
  assert.equal(at(-e.sd_penum-5).sun.eclipse,0);assert.equal(at(e.sd_penum+5).sun.eclipse,0);
}
assert.deepEqual(longestRun([false,false]),{start:0,length:0});
// Independent JPL Horizons reference: coord@301, airless, Oct 2 2026 12:00 UT.
// Elevation 0.754492 km; current IAU_MOON approximation is tested to 0.01 degree.
const referenceDate=new Date('2026-10-02T12:00:00Z'),eph=ephemeris(referenceDate,Astronomy);
const bytes=await readFile('dist/data/shackleton.bin');
const terrain=new Terrain(sites[0],new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4),metadata);
const result=evaluate(sites[0],referenceDate,terrain,Astronomy);
for(const [body,az,el] of [['sun',53.767314606,1.219849714],['earth',129.729085306,5.496299075]]){
  assert.ok(Math.abs(result[body].azimuth-az)<.01,`${body} azimuth vs JPL Horizons`);
  assert.ok(Math.abs(result[body].elevation-el)<.01,`${body} elevation vs JPL Horizons`);
}
console.log('PASS: lunar frame, libration, terrain curvature, observer height, polar geometry, irradiance, visibility and continuous intervals.');
