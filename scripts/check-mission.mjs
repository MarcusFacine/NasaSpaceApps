import assert from 'node:assert/strict';
import * as Astronomy from 'astronomy-engine';
import { sites } from '../dist/sites.js';
import { PHASES,HOUR,buildMission,sampleMission,lunarPoint,terrestrialPoint } from '../dist/mission-model.js';
const plan=buildMission({site:sites[0],windowStart:'2026-10-22T18:00:00Z',windowEnd:'2026-10-29T00:00:00Z',outboundHours:72,stayHours:24,inboundHours:72},Astronomy);
assert.equal(new Date(plan.launch).toISOString(),'2026-10-19T18:00:00.000Z');
assert.equal(new Date(plan.returnAt).toISOString(),'2026-10-26T18:00:00.000Z');
let previous=-Infinity;
for(let i=0;i<=1000;i++){
  const s=sampleMission(plan,i/1000,Astronomy);assert.ok(+s.date>=previous);previous=+s.date;
  assert.ok(s.position.every(Number.isFinite));assert.ok(s.direction.every(Number.isFinite));assert.ok(s.altitudeKm>=0);assert.ok(s.distanceKm>320000&&s.distanceKm<420000);
}
for(const phase of PHASES.slice(1)){
  const left=sampleMission(plan,phase.start-1e-9,Astronomy),right=sampleMission(plan,phase.start,Astronomy);
  assert.ok(Math.hypot(...left.position.map((v,i)=>v-right.position[i]))<.1,`Position discontinuity: ${phase.id}`);
  assert.ok(Math.abs(+left.date-+right.date)<100,`Clock discontinuity: ${phase.id}`);
}
const landed=sampleMission(plan,.49,Astronomy),returned=sampleMission(plan,1,Astronomy);
assert.equal(+landed.date,plan.arrival);assert.equal(landed.altitudeKm,0);assert.equal(landed.phase,'surface');
assert.deepEqual(landed.position,lunarPoint(plan.site,landed.date,Astronomy));
assert.equal(+returned.date,plan.returnAt);assert.equal(returned.altitudeKm,0);assert.deepEqual(returned.position,terrestrialPoint(returned.date,Astronomy));
assert.throws(()=>buildMission({...plan,stayHours:151},Astronomy),/caber/);
assert.throws(()=>buildMission({...plan,outboundHours:0},Astronomy),/24 a 240/);
assert.equal(plan.departure-plan.arrival,24*HOUR);
console.log('PASS: mission dates, monotonic UTC clock, finite vectors, continuous stage boundaries, selected lunar landing, Earth arrival and invalid durations. Trajectory remains kinematic, not orbital.');
