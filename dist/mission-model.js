import { AU_KM, RADIUS_KM, lunarFrame, siteBasis, clamp } from './model.js';

export const HOUR = 36e5;
export const EARTH_RADIUS = 6378.137;
// JPL DE440, km³/s²: https://ssd.jpl.nasa.gov/astro_par.html
export const EARTH_MU = 398600.435507;
export const MOON_MU = 4902.800118;
export const PARKING = Object.freeze({ earthAltitudeKm:300, lunarAltitudeKm:100, earthTurns:1.5, lunarTurns:1 });
export const ANIMATION_SECONDS=140;
// Presentation time is independent of the mission's UTC timeline.
export const PHASES = [
  ['launch','Lançamento',10],['earthOrbit','Órbita terrestre',14],['tli','Injeção translunar',4],
  ['outbound','Ida à Lua',12],['loi','Inserção lunar',4],['lunarOrbit','Órbita lunar',10],
  ['descent','Pouso lunar',20],['surface','No solo',8],['ascent','Decolagem lunar',20],
  ['lunarReturnOrbit','Órbita lunar / volta',12],['tei','Injeção à Terra',4],['inbound','Volta à Terra',16],
  ['arrival','Reentrada terrestre',6]
].map(([id,label,seconds],i,all)=>{const before=all.slice(0,i).reduce((sum,p)=>sum+p[2],0);return {id,label,seconds,start:before/ANIMATION_SECONDS,end:(before+seconds)/ANIMATION_SECONDS};});
export const LOCAL_DESCENT_START=.25,LOCAL_ASCENT_END=.70;
const TAU = 2*Math.PI;
const add = (a,b) => a.map((v,i)=>v+b[i]);
const subtract = (a,b) => a.map((v,i)=>v-b[i]);
const scale = (a,k) => a.map(v=>v*k);
const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
const norm = a => Math.hypot(...a);
const unit = a => scale(a,1/norm(a));
const mix = (a,b,t) => a+(b-a)*t;
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const smooth = t => t*t*(3-2*t);
// Ease only the presentation clock over the outer 8% of a stage. Analytic
// parking motion still has the correct speed/period as a function of UTC.
export function presentationTime(t){
  const edge=.08;if(t>1-edge)return 1-presentationTime(1-t);
  if(t<edge){const s=t/edge;return edge*(s**3-.5*s**4)/(1-edge);}
  return (t-edge/2)/(1-edge);
}
const rotate = (p,q,angle) => add(scale(p,Math.cos(angle)),scale(q,Math.sin(angle)));
const tangent = (p,q,angle) => add(scale(p,-Math.sin(angle)),scale(q,Math.cos(angle)));
const bezier = (a,b,c,d,t) => add(add(scale(a,(1-t)**3),scale(b,3*(1-t)**2*t)),add(scale(c,3*(1-t)*t*t),scale(d,t**3)));
const hermite=(a,b,da,db,t)=>(2*t**3-3*t*t+1)*a+(t**3-2*t*t+t)*da+(-2*t**3+3*t*t)*b+(t**3-t*t)*db;
const phaseWidth=id=>{const p=PHASES.find(p=>p.id===id);return p.end-p.start;};
export function toInertial(v,frame){return v.map((_,i)=>frame.x[i]*v[0]+frame.y[i]*v[1]+frame.z[i]*v[2]);}
export function moonPosition(date,astronomy){const v=astronomy.GeoMoon(date);return [v.x*AU_KM,v.y*AU_KM,v.z*AU_KM];}
export function terrestrialPoint(date,astronomy,altitudeKm=0){
  const v=astronomy.ObserverVector(date,new astronomy.Observer(28.5,-80.6,altitudeKm*1000),false);
  return [v.x*AU_KM,v.y*AU_KM,v.z*AU_KM];
}
export function lunarPoint(site,date,astronomy,elevationKm=0,altitudeKm=0){
  return add(moonPosition(date,astronomy),toInertial(scale(siteBasis(site).up,RADIUS_KM+elevationKm+altitudeKm),lunarFrame(date,astronomy)));
}

// Analytic circular two-body motion in a fixed EQJ plane. This is not an
// Earth–Moon transfer solver, a gravity assist, or a propellant calculation.
export function circularOrbit({body,radiusKm,mu,p,q,start,turns}){
  const radial=unit(p),side=unit(subtract(q,scale(radial,dot(q,radial))));
  const angularRate=Math.sqrt(mu/radiusKm**3),periodSeconds=TAU/angularRate;
  return {body,radiusKm,mu,p:radial,q:side,normal:unit(cross(radial,side)),start,turns,
    angularRate,periodSeconds,speedKmS:Math.sqrt(mu/radiusKm),end:start+turns*periodSeconds*1000};
}
export function parkingState(orbit,ms,radiusKm=orbit.radiusKm){
  const angle=orbit.angularRate*(ms-orbit.start)/1000;
  return {relative:scale(rotate(orbit.p,orbit.q,angle),radiusKm),direction:tangent(orbit.p,orbit.q,angle),angle};
}
export function parkingPath(orbit){
  return Array.from({length:193},(_,i)=>scale(rotate(orbit.p,orbit.q,TAU*i/192),orbit.radiusKm));
}
function lunarArc(plan,ms,t,ascending,astronomy){
  const frame=lunarFrame(new Date(ms),astronomy),basis=siteBasis(plan.site);
  const ground=RADIUS_KM+plan.elevationKm,parking=RADIUS_KM+PARKING.lunarAltitudeKm;
  const local=ascending?t<=LOCAL_ASCENT_END:t>=LOCAL_DESCENT_START;
  let angle=0,radius;
  if(local){
    const s=ascending?t/LOCAL_ASCENT_END:(t-LOCAL_DESCENT_START)/(1-LOCAL_DESCENT_START);
    radius=ground+.4*(ascending?smooth(s):1-smooth(s));
  }else{
    const span=ascending?1-LOCAL_ASCENT_END:LOCAL_DESCENT_START,s=ascending?(t-LOCAL_ASCENT_END)/span:t/span;
    const rate=Math.sqrt(MOON_MU/parking**3),slope=rate*.25*HOUR/1000*span;
    angle=ascending?hermite(0,plan.landingArc,0,slope,s):hermite(-plan.landingArc,0,slope,0,s);
    radius=mix(ground+.4,parking,ascending?smooth(s):1-smooth(s));
  }
  const radial=toInertial(rotate(basis.up,basis.north,angle),frame);
  return {relative:scale(radial,radius),radial,direction:toInertial(tangent(basis.up,basis.north,angle),frame),local,altitudeKm:radius-ground};
}
function rawTransferPoint(plan,id,t,astronomy){
  const outbound=id==='outbound',curve=outbound?plan.outboundCurve:plan.inboundCurve;
  const [begin,end]=plan.times[id],moon=moonPosition(new Date(mix(begin,end,t)),astronomy);
  const reference=outbound?plan.outboundMoonReference:plan.inboundMoonReference;
  // Blend the lunar ephemeris into the illustrative curve near the lunar end.
  // This keeps a long visual transfer from crossing the Moon's moving sphere.
  return add(bezier(...curve,t),scale(subtract(moon,reference),outbound?smooth(t):1-smooth(t)));
}
const LINK_SPAN=.02;
function burnPoint(plan,id,t,astronomy){
  const [begin,end]=plan.times[id],ms=mix(begin,end,t),u=smooth(t);
  const orbit=id==='tli'?plan.earthParking:id==='loi'?plan.lunarParking:plan.lunarReturnParking;
  const radius=orbit.radiusKm+(id==='tli'?80*u:id==='loi'?200*(1-u):200*u);
  const relative=parkingState(orbit,ms,radius).relative;
  return orbit.body==='Earth'?relative:add(moonPosition(new Date(ms),astronomy),relative);
}
function makeTransferLinks(plan,id,astronomy){
  const span=plan[id+'LinkSpan'];
  const outbound=id==='outbound',before=outbound?'tli':'tei',after=outbound?'loi':'arrival';
  const endpoint=(phase,t)=>phase==='arrival'?terrestrialPoint(new Date(mix(...plan.times.arrival,t)),astronomy,120*(1-smooth(t))):burnPoint(plan,phase,t,astronomy);
  const derivative=(fn,t)=>{const a=Math.max(0,t-.001),b=Math.min(1,t+.001);return scale(subtract(fn(b),fn(a)),1/(b-a));};
  const raw=t=>rawTransferPoint(plan,id,t,astronomy),a=raw(0),b=raw(span),c=raw(1-span),d=raw(1);
  // Match d(position)/d(animation progress) at both ends. The UTC mapping is
  // compressed differently by stage: these are visual C1 links, not burns solved by dynamics.
  const startHandle=scale(derivative(t=>endpoint(before,t),1),phaseWidth(id)*span/phaseWidth(before)/3);
  const endHandle=scale(derivative(t=>endpoint(after,t),0),phaseWidth(id)*span/phaseWidth(after)/3);
  return {first:[a,add(a,startHandle),subtract(b,scale(derivative(raw,span),span/3)),b],
    last:[c,add(c,scale(derivative(raw,1-span),span/3)),subtract(d,endHandle),d]};
}
function transferPoint(plan,id,t,astronomy){
  const links=plan[id+'Links'],span=plan[id+'LinkSpan'];
  if(t<span)return bezier(...links.first,t/span);
  if(t>1-span)return bezier(...links.last,(t-1+span)/span);
  return rawTransferPoint(plan,id,t,astronomy);
}
function selectTransferCurve(plan,id,astronomy){
  const key=id==='outbound'?'outboundCurve':'inboundCurve',original=plan[key];
  const reference=id==='outbound'?plan.outboundMoonReference:plan.inboundMoonReference;
  const [begin,end]=plan.times[id];
  const samples=Array.from({length:1001},(_,i)=>{
    const t=i/1000,moon=moonPosition(new Date(mix(begin,end,t)),astronomy);
    return {t,moon,shift:scale(subtract(moon,reference),id==='outbound'?smooth(t):1-smooth(t))};
  });
  // Select only visual control handles, NOT an orbital/fuel optimization.
  // Reject geometric links that intersect either moving reference sphere.
  for(const span of [LINK_SPAN,.01,.005])for(const first of [1,1.5,2,3,4])for(const last of [1,1.5,2,3,4]){
    const [a,b,c,d]=original,curve=[a,add(a,scale(subtract(b,a),first)),add(d,scale(subtract(c,d),last)),d];
    plan[key]=curve;plan[id+'LinkSpan']=span;const links=makeTransferLinks(plan,id,astronomy);plan[id+'Links']=links;
    const clear=(point,moon)=>norm(point)>EARTH_RADIUS+50&&norm(subtract(point,moon))>RADIUS_KM+50;
    const connectorSamples=Array.from({length:101},(_,i)=>i/100).flatMap(s=>[s*span,1-span+s*span]);
    if(samples.every(({t,moon,shift})=>clear(t<span?bezier(...links.first,t/span):t>1-span?bezier(...links.last,(t-1+span)/span):add(bezier(...curve,t),shift),moon))&&
      connectorSamples.every(t=>clear(transferPoint(plan,id,t,astronomy),moonPosition(new Date(mix(begin,end,t)),astronomy)))){
      return;
    }
  }
  throw new Error('Não foi possível ligar as órbitas sem cruzar os globos. Experimente outra data ou duração de viagem.');
}

export function buildMission({site,windowStart,windowEnd,outboundHours=72,stayHours=24,inboundHours=72,elevationKm=0},astronomy){
  const start=new Date(windowStart),end=new Date(windowEnd),arrival=+start,departure=arrival+stayHours*HOUR;
  if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start)throw new Error('Janela inválida.');
  for(const hours of [outboundHours,inboundHours])if(!Number.isFinite(hours)||hours<24||hours>240)throw new Error('As viagens devem durar de 24 a 240 horas.');
  if(!Number.isFinite(stayHours)||stayHours<.5||departure>+end)throw new Error('A permanência precisa caber na janela escolhida (mínimo de 0,5 h).');
  if(!Number.isFinite(elevationKm)||Math.abs(elevationKm)>20)throw new Error('Elevação lunar inválida.');
  const launch=arrival-outboundHours*HOUR,returnAt=departure+inboundHours*HOUR;
  if(launch<+new Date('2000-01-01T00:00Z')||returnAt>+new Date('2050-12-31T23:59Z'))throw new Error('Toda a missão deve ficar entre 2000 e 2050.');
  const plan={site,windowStart:start,windowEnd:end,outboundHours,stayHours,inboundHours,elevationKm,launch,arrival,departure,returnAt,landingArc:Math.PI/5};
  const ground=terrestrialPoint(new Date(launch),astronomy),p=unit(ground),q=unit(cross([0,0,1],p));
  plan.launchFrame={p,q,radiusKm:norm(ground),angle:.28};
  plan.earthParking=circularOrbit({body:'Earth',radiusKm:EARTH_RADIUS+PARKING.earthAltitudeKm,mu:EARTH_MU,
    p:rotate(p,q,plan.launchFrame.angle),q:tangent(p,q,plan.launchFrame.angle),start:launch+.2*HOUR,turns:PARKING.earthTurns});
  const descentStart=arrival-.25*HOUR,ascentEnd=departure+.25*HOUR;
  const descentEntry=lunarArc(plan,descentStart,0,false,astronomy),ascentExit=lunarArc(plan,ascentEnd,1,true,astronomy);
  const lunarPeriod=TAU*Math.sqrt((RADIUS_KM+PARKING.lunarAltitudeKm)**3/MOON_MU);
  plan.lunarParking=circularOrbit({body:'Moon',radiusKm:RADIUS_KM+PARKING.lunarAltitudeKm,mu:MOON_MU,
    p:descentEntry.relative,q:descentEntry.direction,start:descentStart-PARKING.lunarTurns*lunarPeriod*1000,turns:PARKING.lunarTurns});
  plan.lunarReturnParking=circularOrbit({body:'Moon',radiusKm:RADIUS_KM+PARKING.lunarAltitudeKm,mu:MOON_MU,
    p:ascentExit.relative,q:ascentExit.direction,start:ascentEnd,turns:PARKING.lunarTurns});
  const tliStart=plan.earthParking.end,tliEnd=tliStart+.1*HOUR;
  const loiEnd=plan.lunarParking.start,loiStart=loiEnd-.1*HOUR;
  const teiStart=plan.lunarReturnParking.end,teiEnd=teiStart+.05*HOUR,reentryStart=returnAt-.25*HOUR;
  if(tliEnd>=loiStart||teiEnd>=reentryStart)throw new Error('A duração não comporta as órbitas e manobras.');
  plan.times={launch:[launch,plan.earthParking.start],earthOrbit:[plan.earthParking.start,tliStart],tli:[tliStart,tliEnd],
    outbound:[tliEnd,loiStart],loi:[loiStart,loiEnd],lunarOrbit:[loiEnd,descentStart],descent:[descentStart,arrival],
    surface:[arrival,departure],ascent:[departure,ascentEnd],lunarReturnOrbit:[ascentEnd,teiStart],tei:[teiStart,teiEnd],
    inbound:[teiEnd,reentryStart],arrival:[reentryStart,returnAt]};
  // Burn arcs and transfers are illustrative links between the
  // analytic parking orbits. No Lambert targeting, delta-v, or n-body dynamics.
  const earthExit=parkingState(plan.earthParking,tliEnd,plan.earthParking.radiusKm+80);
  const moonEntry=parkingState(plan.lunarParking,loiStart,plan.lunarParking.radiusKm+200);
  const moonExit=parkingState(plan.lunarReturnParking,teiEnd,plan.lunarReturnParking.radiusKm+200);
  const moonVelocity=ms=>scale(subtract(moonPosition(new Date(ms+1000),astronomy),moonPosition(new Date(ms-1000),astronomy)),.5);
  const makeCurve=(a,d,da,dd)=>{const handle=norm(subtract(d,a))*.22;return [a,add(a,scale(unit(da),handle)),subtract(d,scale(unit(dd),handle)),d];};
  plan.outboundCurve=makeCurve(earthExit.relative,add(moonPosition(new Date(loiStart),astronomy),moonEntry.relative),add(earthExit.direction,scale(unit(earthExit.relative),.8)),
    add(add(scale(moonEntry.direction,plan.lunarParking.speedKmS),moonVelocity(loiStart)),scale(unit(moonEntry.relative),-1.5)));
  const endEarth=terrestrialPoint(new Date(reentryStart),astronomy,120);
  plan.inboundCurve=makeCurve(add(moonPosition(new Date(teiEnd),astronomy),moonExit.relative),endEarth,
    add(add(scale(moonExit.direction,plan.lunarReturnParking.speedKmS),moonVelocity(teiEnd)),scale(unit(moonExit.relative),1.5)),scale(unit(endEarth),-1));
  plan.outboundMoonReference=moonPosition(new Date(loiStart),astronomy);plan.inboundMoonReference=moonPosition(new Date(teiEnd),astronomy);
  selectTransferCurve(plan,'outbound',astronomy);selectTransferCurve(plan,'inbound',astronomy);
  plan.outboundPath=Array.from({length:201},(_,i)=>transferPoint(plan,'outbound',i/200,astronomy));
  plan.inboundPath=Array.from({length:201},(_,i)=>transferPoint(plan,'inbound',i/200,astronomy));
  return plan;
}

export function sampleMission(plan,progress,astronomy){
  const p=clamp(progress,0,1),phase=PHASES.find(s=>p<s.end)||PHASES.at(-1),t=presentationTime(clamp((p-phase.start)/(phase.end-phase.start),0,1)),u=smooth(t);
  const [begin,end]=plan.times[phase.id],ms=mix(begin,end,t),date=new Date(ms),moon=moonPosition(date,astronomy),frame=lunarFrame(date,astronomy);
  let position,direction,altitudeKm=0,local=false,engine=false,orbit=null,arc=null,altitudeReference='Terra';
  const around=(parking,radius)=>{const state=parkingState(parking,ms,radius);direction=state.direction;position=parking.body==='Earth'?state.relative:add(moon,state.relative);altitudeReference=parking.body==='Earth'?'Terra':'Lua';altitudeKm=norm(state.relative)-(parking.body==='Earth'?EARTH_RADIUS:RADIUS_KM);};
  switch(phase.id){
    case 'launch':{
      const f=plan.launchFrame,angle=f.angle*u,radial=rotate(f.p,f.q,angle);
      position=scale(radial,mix(f.radiusKm,plan.earthParking.radiusKm,u));direction=unit(add(scale(radial,1-u),scale(tangent(f.p,f.q,angle),u)));
      altitudeKm=PARKING.earthAltitudeKm*u;engine=true;break;
    }
    case 'earthOrbit':orbit=plan.earthParking;around(orbit);break;
    case 'tli':around(plan.earthParking,plan.earthParking.radiusKm+80*u);engine=true;break;
    case 'loi':around(plan.lunarParking,plan.lunarParking.radiusKm+200*(1-u));engine=true;break;
    case 'lunarOrbit':orbit=plan.lunarParking;around(orbit);break;
    case 'lunarReturnOrbit':orbit=plan.lunarReturnParking;around(orbit);break;
    case 'tei':around(plan.lunarReturnParking,plan.lunarReturnParking.radiusKm+200*u);engine=true;break;
    case 'descent':case 'ascent':{
      arc=lunarArc(plan,ms,t,phase.id==='ascent',astronomy);position=add(moon,arc.relative);altitudeKm=Math.max(0,arc.altitudeKm);
      local=arc.local;engine=phase.id==='descent'?t<.999:t>.001;altitudeReference='solo lunar';
      // Start pitching only AFTER leaving parking; descent starts immediately.
      // Never reverse the attitude while coasting around the lunar parking orbit.
      const pitch=phase.id==='descent'?smooth(clamp(t/LOCAL_DESCENT_START,0,1)):1-smooth(clamp((t-LOCAL_ASCENT_END)/(1-LOCAL_ASCENT_END),0,1));
      direction=rotate(arc.direction,arc.radial,pitch*Math.PI/2);break;
    }
    case 'surface':position=lunarPoint(plan.site,date,astronomy,plan.elevationKm);local=true;altitudeReference='solo lunar';break;
    case 'outbound':case 'inbound':{
      position=transferPoint(plan,phase.id,t,astronomy);direction=unit(subtract(transferPoint(plan,phase.id,clamp(t+1e-7,0,1),astronomy),transferPoint(plan,phase.id,clamp(t-1e-7,0,1),astronomy)));
      // Refer to the closer body rather than reporting a misleading lunar altitude near Earth.
      const earthAltitude=norm(position)-EARTH_RADIUS,moonAltitude=norm(subtract(position,moon))-RADIUS_KM;
      altitudeReference=earthAltitude<moonAltitude?'Terra':'Lua';altitudeKm=Math.min(earthAltitude,moonAltitude);break;
    }
    case 'arrival':{
      altitudeKm=120*(1-u);position=terrestrialPoint(date,astronomy,altitudeKm);
      const motion=unit(subtract(terrestrialPoint(new Date(ms+500),astronomy,altitudeKm),terrestrialPoint(new Date(ms-500),astronomy,altitudeKm))),pitch=smooth(clamp(t/.25,0,1));
      direction=unit(add(scale(motion,1-pitch),scale(unit(position),pitch)));break;
    }
  }
  if(!direction)direction=unit(subtract(position,moon));
  if(['loi','tei'].includes(phase.id)){
    const a=clamp(t-.001,0,1),b=clamp(t+.001,0,1),motion=unit(subtract(burnPoint(plan,phase.id,b,astronomy),burnPoint(plan,phase.id,a,astronomy)));
    const blend=phase.id==='loi'?1-u:u;direction=unit(add(scale(direction,1-blend),scale(motion,blend)));
  }
  let localPosition=null,localDirection=null;
  if(local){
    const basis=siteBasis(plan.site),relative=frame.transform(subtract(position,moon)),bodyDirection=frame.transform(direction);
    localPosition=[dot(relative,basis.east),dot(relative,basis.up)-RADIUS_KM-plan.elevationKm,-dot(relative,basis.north)];
    localDirection=[dot(bodyDirection,basis.east),dot(bodyDirection,basis.up),-dot(bodyDirection,basis.north)];
  }
  return {phase:phase.id,label:phase.label,t,date,position,direction,moon,frame,local,localPosition,localDirection,engine,orbit,
    orbitTurns:orbit?clamp((ms-orbit.start)/(orbit.periodSeconds*1000),0,orbit.turns):null,
    altitudeKm:Math.max(0,altitudeKm),altitudeReference,elapsedHours:(ms-plan.launch)/HOUR,distanceKm:norm(moon)};
}
