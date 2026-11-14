import * as Astronomy from 'astronomy-engine';
import { readFile } from 'node:fs/promises';
import { sites } from '../dist/sites.js';
import { Terrain,evaluate,ephemeris,longestRun } from '../dist/model.js';
import { buildMission } from '../dist/mission-model.js';
const metadata=JSON.parse(await readFile('dist/data/metadata.json','utf8'));
const terrains=new Map(await Promise.all(sites.map(async site=>{
  const bytes=await readFile(`dist/data/${site.id}.bin`);
  const wide=metadata.wide?await readFile(`dist/data/${site.id}-wide.bin`).catch(()=>null):null;
  const inner=metadata.inner?await readFile(`dist/data/${site.id}-inner.bin`).catch(()=>null):null;
  const f32=b=>b?new Float32Array(b.buffer,b.byteOffset,b.byteLength/4):null;
  return [site.id,new Terrain(site,f32(bytes),metadata,f32(wide),f32(inner))];
})));
const start=new Date('2026-10-02T12:00:00Z'),hour=36e5;
const sample=(id,date=start)=>{
  const site=sites.find(s=>s.id===id),terrain=terrains.get(id);
  const tracked=evaluate(site,date,terrain,Astronomy,2,'tracking'),flat=evaluate(site,date,terrain,Astronomy,2,'horizontal');
  return {id,name:site.name,date:date.toISOString(),sunElevation:tracked.sun.elevation,sunHorizon:tracked.sun.horizon,sunMargin:tracked.sun.margin,sunVisible:tracked.sun.available,earthElevation:tracked.earth.elevation,earthHorizon:tracked.earth.horizon,earthMargin:tracked.earth.margin,earthVisible:tracked.earth.available,trackedWm2:tracked.irradiance,horizontalWm2:flat.irradiance};
};
const availability=new Map(sites.map(site=>[site.id,[]]));
for(let h=0;h<720;h++){
  const date=new Date(+start+h*hour),eph=ephemeris(date,Astronomy);
  for(const site of sites){const m=evaluate(site,date,terrains.get(site.id),Astronomy,2,'tracking',eph);availability.get(site.id).push(m.sun.available&&m.earth.available);}
}
const search=ids=>{
  const values=Array.from({length:720},(_,h)=>ids.every(id=>availability.get(id)[h]));
  const best=longestRun(values);
  return {ids,lengthHours:best.length,start:best.length?new Date(+start+best.start*hour).toISOString():null,end:best.length?new Date(+start+(best.start+best.length)*hour).toISOString():null};
};
const common=search(['shackleton','malapert']);
const mission=buildMission({site:sites[0],windowStart:common.start,windowEnd:common.end,outboundHours:72,stayHours:24,inboundHours:72,elevationKm:terrains.get('shackleton').elevationKm},Astronomy);
const result={basis:{date:start.toISOString(),heightM:2,searchHours:720,stepHours:1},samples:sites.map(s=>sample(s.id)),common,commonLanding:sample('shackleton',new Date(common.start)),searches:[search(['haworth']),search(['degerlache']),search(['shackleton','malapert','haworth']),search(['shackleton','malapert','degerlache'])],mission:{launch:new Date(mission.launch).toISOString(),landing:new Date(mission.arrival).toISOString(),departure:new Date(mission.departure).toISOString(),return:new Date(mission.returnAt).toISOString()}};
console.log(JSON.stringify(result,null,2));
