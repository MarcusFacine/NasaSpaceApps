import { AU_KM, RADIUS_KM, lunarFrame, siteBasis, clamp } from './model.js';

export const HOUR=36e5;
export const EARTH_RADIUS=6378.137;
export const PHASES=[
  {id:'launch',label:'Lançamento',start:0,end:.10},
  {id:'outbound',label:'Ida à Lua',start:.10,end:.34},
  {id:'descent',label:'Pouso lunar',start:.34,end:.49},
  {id:'surface',label:'No solo',start:.49,end:.59},
  {id:'ascent',label:'Decolagem',start:.59,end:.73},
  {id:'inbound',label:'Volta à Terra',start:.73,end:.94},
  {id:'arrival',label:'Chegada à Terra',start:.94,end:1}
];
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const scale=(a,k)=>a.map(v=>v*k);
const norm=a=>Math.hypot(...a);
const unit=a=>scale(a,1/norm(a));
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const smooth=t=>t*t*(3-2*t);
const bezier=(a,b,c,d,t)=>add(add(scale(a,(1-t)**3),scale(b,3*(1-t)**2*t)),add(scale(c,3*(1-t)*t*t),scale(d,t**3)));
export function toInertial(v,frame){return v.map((_,i)=>frame.x[i]*v[0]+frame.y[i]*v[1]+frame.z[i]*v[2]);}
export function moonPosition(date,astronomy){const v=astronomy.GeoMoon(date);return [v.x*AU_KM,v.y*AU_KM,v.z*AU_KM];}
export function terrestrialPoint(date,astronomy,altitudeKm=0){
  const v=astronomy.ObserverVector(date,new astronomy.Observer(28.5,-80.6,altitudeKm*1000),false);
  return [v.x*AU_KM,v.y*AU_KM,v.z*AU_KM];
}
export function lunarPoint(site,date,astronomy,elevationKm=0,altitudeKm=0){
  return add(moonPosition(date,astronomy),toInertial(scale(siteBasis(site).up,RADIUS_KM+elevationKm+altitudeKm),lunarFrame(date,astronomy)));
}
export function buildMission({site,windowStart,windowEnd,outboundHours=72,stayHours=24,inboundHours=72,elevationKm=0},astronomy){
  const start=new Date(windowStart),end=new Date(windowEnd),arrival=+start,departure=arrival+stayHours*HOUR;
  if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start)throw new Error('Janela inválida.');
  for(const hours of [outboundHours,inboundHours])if(!Number.isFinite(hours)||hours<24||hours>240)throw new Error('As viagens devem durar de 24 a 240 horas.');
  if(!Number.isFinite(stayHours)||stayHours<.5||departure>+end)throw new Error('A permanência precisa caber na janela escolhida (mínimo de 0,5 h).');
  const launch=arrival-outboundHours*HOUR,returnAt=departure+inboundHours*HOUR;
  if(launch<+new Date('2000-01-01T00:00Z')||returnAt>+new Date('2050-12-31T23:59Z'))throw new Error('Toda a missão deve ficar entre 2000 e 2050.');
  const plan={site,windowStart:start,windowEnd:end,outboundHours,stayHours,inboundHours,elevationKm,launch,arrival,departure,returnAt};
  // Kinematic illustrations: not a Lambert solution or a gravitational propagation.
  const startEarth=terrestrialPoint(new Date(launch+.2*HOUR),astronomy,300);
  const endMoon=lunarPoint(site,new Date(arrival-HOUR),astronomy,elevationKm,.4);
  const startMoon=lunarPoint(site,new Date(departure+HOUR),astronomy,elevationKm,.4);
  const endEarth=terrestrialPoint(new Date(returnAt-.25*HOUR),astronomy,120);
  const makeCurve=(a,d,sign)=>{
    const direction=unit(d.map((v,i)=>v-a[i]));let side=cross(direction,[0,0,1]);if(norm(side)<.01)side=cross(direction,[0,1,0]);side=scale(unit(side),sign*norm(d.map((v,i)=>v-a[i]))*.20);
    return [a,add(lerp(a,d,.25),side),add(lerp(a,d,.75),side),d];
  };
  plan.outboundCurve=makeCurve(startEarth,endMoon,1);plan.inboundCurve=makeCurve(startMoon,endEarth,-1);
  plan.outboundPath=Array.from({length:201},(_,i)=>bezier(...plan.outboundCurve,i/200));
  plan.inboundPath=Array.from({length:201},(_,i)=>bezier(...plan.inboundCurve,i/200));
  return plan;
}
export function sampleMission(plan,progress,astronomy){
  const p=clamp(progress,0,1),phase=PHASES.find(s=>p<s.end)||PHASES.at(-1),t=clamp((p-phase.start)/(phase.end-phase.start),0,1),u=smooth(t);
  let ms,position,altitudeKm=0,local=false,engine=false;
  switch(phase.id){
    case 'launch':ms=plan.launch+.2*HOUR*t;altitudeKm=300*u;position=terrestrialPoint(new Date(ms),astronomy,altitudeKm);engine=true;break;
    case 'outbound':ms=plan.launch+.2*HOUR+(plan.arrival-HOUR-plan.launch-.2*HOUR)*t;position=bezier(...plan.outboundCurve,t);break;
    case 'descent':ms=plan.arrival-HOUR+HOUR*t;altitudeKm=.4*(1-u);local=true;engine=t<.999;break;
    case 'surface':ms=plan.arrival+(plan.departure-plan.arrival)*t;local=true;break;
    case 'ascent':ms=plan.departure+HOUR*t;altitudeKm=.4*u;local=true;engine=t>.001;break;
    case 'inbound':ms=plan.departure+HOUR+(plan.returnAt-.25*HOUR-plan.departure-HOUR)*t;position=bezier(...plan.inboundCurve,t);break;
    case 'arrival':ms=plan.returnAt-.25*HOUR+.25*HOUR*t;altitudeKm=120*(1-u);position=terrestrialPoint(new Date(ms),astronomy,altitudeKm);break;
  }
  const date=new Date(ms),moon=moonPosition(date,astronomy),frame=lunarFrame(date,astronomy);
  if(local)position=lunarPoint(plan.site,date,astronomy,plan.elevationKm,altitudeKm);
  const radial=local?toInertial(siteBasis(plan.site).up,frame):unit(position);
  let direction=radial;
  if(['outbound','inbound'].includes(phase.id)){
    const curve=phase.id==='outbound'?plan.outboundCurve:plan.inboundCurve;
    direction=unit(bezier(...curve,clamp(t+.0001,0,1)).map((v,i)=>v-bezier(...curve,clamp(t-.0001,0,1))[i]));
    altitudeKm=phase.id==='outbound'?norm(position)-EARTH_RADIUS:norm(position.map((v,i)=>v-moon[i]))-RADIUS_KM;
  }
  return {phase:phase.id,label:phase.label,t,date,position,direction,moon,frame,local,engine,altitudeKm:Math.max(0,altitudeKm),altitudeReference:['launch','outbound','arrival'].includes(phase.id)?'Terra':'Lua',elapsedHours:(ms-plan.launch)/HOUR,distanceKm:norm(moon)};
}
