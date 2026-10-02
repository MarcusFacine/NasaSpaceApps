import { evaluate } from './model.js';
import { HOUR, PHASES, buildMission, sampleMission } from './mission-model.js';
import { MissionScene } from './mission-scene.js';

const $=s=>document.querySelector(s);
const fullDate=d=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(d))+' UTC';
const shortDate=d=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(d))+' UTC';
export class MissionUI {
  constructor(astronomy,onClose){
    this.astronomy=astronomy;this.onClose=onClose;this.dialog=$('#missionDialog');this.progress=0;this.playing=false;
    $('#closeMission').addEventListener('click',()=>this.dialog.close());this.dialog.addEventListener('close',()=>{this.stop();cancelAnimationFrame(this.frame);this.scene?.dispose();this.scene=null;onClose();});
    $('#missionForm').addEventListener('submit',e=>{e.preventDefault();this.apply();});
    $('#missionWindowHours').addEventListener('input',()=>{if(!$('#missionWindowHours').disabled)$('#missionStay').max=Number($('#missionWindowHours').value);});
    $('#missionPlay').addEventListener('click',()=>{if(!this.plan)return;if(this.playing)this.stop();else{if(this.progress>=1)this.progress=0;this.playing=true;this.last=performance.now();this.playButton();}});
    $('#missionReplay').addEventListener('click',()=>{this.stop();this.progress=0;this.draw(true);});
    $('#missionProgress').addEventListener('input',()=>{this.stop();this.progress=Number($('#missionProgress').value)/1000;this.draw(true);});
    $('#missionCamera').addEventListener('change',()=>this.scene?.setMode($('#missionCamera').value));
    $('#missionResetCamera').addEventListener('click',()=>this.draw(true));
    $('#missionFullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#missionViewport').requestFullscreen();}catch{$('#missionSceneMessage').textContent='Tela cheia não está disponível neste navegador.';}});
    document.addEventListener('visibilitychange',()=>{this.last=performance.now();});
    window.addEventListener('pagehide',()=>{this.stop();cancelAnimationFrame(this.frame);this.scene?.dispose();});
  }
  open(context){
    this.context=context;this.progress=0;this.stop();this.plan=null;this.last=performance.now();this.lastDraw=0;this.conditionKey='';
    $('#missionSite').textContent=context.site.name;$('#missionCoordinates').textContent=`${Math.abs(context.site.lat).toFixed(2)}° S · ${Math.abs(context.site.lon).toFixed(2)}° ${context.site.lon<0?'W':'E'}`;
    $('#missionWindowHours').value=Math.round((context.window.end-context.window.start)/HOUR);$('#missionWindowHours').disabled=context.window.source==='search';
    $('#missionOutbound').value=72;$('#missionInbound').value=72;$('#missionStay').value=Math.min(24,(context.window.end-context.window.start)/HOUR);$('#missionStay').max=(context.window.end-context.window.start)/HOUR;
    $('#missionCamera').value='auto';$('#missionSceneMessage').textContent='';$('#missionError').textContent='';
    this.dialog.showModal();
    try{this.scene=new MissionScene($('#missionCanvas'),$('#missionViewport'),context.terrain,text=>$('#missionSceneMessage').textContent=text);}catch{$('#missionSceneMessage').textContent='A cena 3D não pôde ser iniciada. O cronograma da missão continua disponível.';}
    this.apply();
    this.tick=now=>{if(!this.dialog.open)return;const dt=Math.min(5000,now-this.last);this.last=now;if(this.playing&&!document.hidden){this.progress=Math.min(1,this.progress+dt/100000*Number($('#missionSpeed').value));if(this.progress>=1)this.stop();if(now-this.lastDraw>=40){this.lastDraw=now;this.draw();}}this.frame=requestAnimationFrame(this.tick);};this.frame=requestAnimationFrame(this.tick);
  }
  apply(){
    this.stop();const c=this.context,duration=Number($('#missionWindowHours').value);
    try{
      if(c.window.source!=='search'&&(!Number.isInteger(duration)||duration<1||duration>720))throw new Error('A janela manual deve durar de 1 a 720 horas.');
      const end=c.window.source==='search'?c.window.end:new Date(+c.window.start+duration*HOUR);
      const plan=buildMission({site:c.site,windowStart:c.window.start,windowEnd:end,outboundHours:Number($('#missionOutbound').value),stayHours:Number($('#missionStay').value),inboundHours:Number($('#missionInbound').value),elevationKm:c.terrain.elevationKm},this.astronomy);
      this.plan=plan;this.progress=0;this.conditionKey='';$('#missionError').textContent='';$('#missionStay').max=(end-c.window.start)/HOUR;
      $('#missionWindowSource').textContent=c.window.source==='search'?'JANELA CALCULADA · AMOSTRAS DE 1 h':'JANELA MANUAL · NÃO OTIMIZADA';
      $('#missionWindowStart').textContent=fullDate(c.window.start);$('#missionWindowEnd').textContent='até '+fullDate(end);
      $('#missionEvents').innerHTML=[['Lançamento',plan.launch],['Pouso lunar',plan.arrival],['Saída da Lua',plan.departure],['Chegada à Terra',plan.returnAt]].map(([label,time])=>`<div><dt>${label}</dt><dd>${shortDate(time)}</dd></div>`).join('');
      $('#missionPhases').innerHTML=PHASES.map(p=>`<button data-mission-phase="${p.id}" aria-pressed="false">${p.label}</button>`).join('');
      document.querySelectorAll('[data-mission-phase]').forEach(button=>button.addEventListener('click',()=>{this.stop();this.progress=PHASES.find(p=>p.id===button.dataset.missionPhase).start;this.draw(true);}));
      let total=0,good=0;
      for(let h=0;h<plan.stayHours;h++){const m=evaluate(c.site,new Date(plan.arrival+h*HOUR),c.terrain,this.astronomy,c.heightM,c.panel);total++;if(m.sun.available&&m.earth.available)good++;}
      const last=evaluate(c.site,new Date(plan.departure),c.terrain,this.astronomy,c.heightM,c.panel);total++;if(last.sun.available&&last.earth.available)good++;
      $('#missionAssessment').textContent=good===total?`Destino com Sol + Terra em ${total}/${total} amostras da permanência (passo ≤1 h). Transições finas não verificadas.`:`Atenção: Sol + Terra em ${good}/${total} amostras da permanência. A cena pode mostrar sombra ou visada obstruída no destino.`;
      $('#missionAssessment').classList.toggle('warning',good!==total);
      this.scene?.setPlan(plan);this.draw(true);
    }catch(error){$('#missionError').textContent=error.message;}
  }
  draw(reset=false){
    if(!this.plan)return;const s=sampleMission(this.plan,this.progress,this.astronomy),c=this.context;
    const key=Math.floor(+s.date/60000);if(key!==this.conditionKey){this.conditionKey=key;this.conditions=evaluate(c.site,s.date,c.terrain,this.astronomy,c.heightM,c.panel);}
    this.scene?.update(s,this.conditions,reset);$('#missionPhase').textContent=s.label;$('#missionClock').textContent=fullDate(s.date);
    $('#missionElapsed').textContent=`${s.elapsedHours.toFixed(1)} h`;$('#missionDistance').textContent=Math.round(s.distanceKm).toLocaleString('pt-BR')+' km';
    $('#missionAltitude').textContent=(s.altitudeKm<1?(s.altitudeKm*1000).toFixed(0)+' m':Math.round(s.altitudeKm).toLocaleString('pt-BR')+' km')+' / '+s.altitudeReference;
    $('#missionConditions').textContent=`Sol ${this.conditions.sun.available?'visível':'obstruído'} · Terra ${this.conditions.earth.available?'visível':'obstruída'}`;
    $('#missionProgress').value=Math.round(this.progress*1000);
    document.querySelectorAll('[data-mission-phase]').forEach(b=>{const active=b.dataset.missionPhase===s.phase;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    this.sample=s;
  }
  playButton(){const b=$('#missionPlay');b.textContent=this.playing?'Ⅱ Pausar':'▶ Reproduzir';b.setAttribute('aria-pressed',String(this.playing));b.setAttribute('aria-label',this.playing?'Pausar missão':'Reproduzir missão');}
  stop(){this.playing=false;this.playButton();}
}
