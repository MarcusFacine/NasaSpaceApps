import { sites } from './sites.js';
import { Terrain, evaluate, ephemeris, longestRun, clamp } from './model.js';
import { LunarScene } from './scene.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const astronomy=window.Astronomy;
const fmt=n=>`${n>=0?'+':'−'}${Math.abs(n).toFixed(2)}°`;
const coords=s=>`${Math.abs(s.lat).toFixed(2)}° S · ${Math.abs(s.lon).toFixed(2)}° ${s.lon<0?'W':'E'}`;
const state={selected:['shackleton','malapert'],primary:'shackleton',view:'terrain',heightM:2,panel:'tracking',date:new Date('2026-10-02T12:00:00Z')};
const terrains=new Map();let scene=null,ready=false,playing=null,timelineKey='',searching=false,current=null;
const selectedSites=()=>state.selected.map(id=>sites.find(s=>s.id===id));
const primarySite=()=>sites.find(s=>s.id===state.primary);
const humanDate=d=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(d)+' UTC';

function message(text,error=false){$('#appMessage').textContent=text;$('#appMessage').className=`message ${text?'visible':''} ${error?'error':''}`;}
function validDate(date){return Number.isFinite(date?.getTime())&&date>=new Date('2000-01-01T00:00Z')&&date<=new Date('2050-12-31T23:59Z');}
function setDate(date,keepMessage=false){
  if(!validDate(date)){message('Escolha uma data entre 2000 e 2050.',true);$('#dateTime').value=state.date.toISOString().slice(0,16);return false;}
  state.date=new Date(date);if(!keepMessage)message('');render();return true;
}
function renderSites(){
  $('#siteList').innerHTML=sites.map(s=>`<div class="site-item ${state.primary===s.id?'primary':''}" style="--site-color:${s.color}"><label class="check-wrap"><input type="checkbox" data-site-check="${s.id}" aria-label="Comparar ${s.name}" ${state.selected.includes(s.id)?'checked':''}></label><button class="site-name" data-site-focus="${s.id}" aria-pressed="${state.primary===s.id}"><b>${s.name}</b><span>${coords(s)}</span><small>${s.tag}</small></button></div>`).join('');
  $('#selectionCount').textContent=`${state.selected.length}/3`;
  $$('[data-site-check]').forEach(el=>el.addEventListener('change',()=>{
    if(el.checked){if(state.selected.length>=3){el.checked=false;message('Você já está comparando três locais. Desmarque um para incluir outro.');return;}state.selected.push(el.dataset.siteCheck);}
    else{if(state.selected.length===1){el.checked=true;message('Mantenha pelo menos um local na comparação.');return;}state.selected=state.selected.filter(id=>id!==el.dataset.siteCheck);}
    message('');renderSites();render();
  }));
  $$('[data-site-focus]').forEach(el=>el.addEventListener('click',()=>focusSite(el.dataset.siteFocus)));
}
function focusSite(id){state.primary=id;renderSites();render();}
function setView(view){state.view=view;$$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});scene?.setView(view);render();}

function render(){
  const d=state.date;
  $('#dateTime').value=d.toISOString().slice(0,16);
  $('#clock').textContent=d.toISOString().slice(11,16)+' UTC';
  $('#hourOutput').textContent=d.toISOString().slice(11,16)+' UTC';
  $('#hourSlider').value=d.getUTCHours()*60+d.getUTCMinutes();
  const year=d.getUTCFullYear(),day=Math.floor((d-new Date(Date.UTC(year,0,1)))/864e5)+1;
  $('#dayOfYear').textContent=`DIA ${String(day).padStart(3,'0')} / ${year}`;
  $('#heightOutput').textContent=state.heightM+' m';
  $('#primarySiteName').textContent=primarySite().name;$('#sceneCoordinates').textContent=coords(primarySite());
  $('#cameraHint').textContent=state.view==='surface'?'Arraste para olhar ao redor · Home para recentrar':state.view==='globe'?'Arraste para girar a Lua · Role para aproximar':'Arraste para orbitar · Role para aproximar';
  $('#scaleLabel').textContent=state.view==='globe'?'LUA / REFERÊNCIAS REGIONAIS':'ESCALA VERTICAL 1×';
  if(!ready)return;
  const terrain=terrains.get(state.primary);
  current=evaluate(primarySite(),d,terrain,astronomy,state.heightM,state.panel);
  for(const body of ['sun','earth']){
    const m=current[body];$(`#${body}Elevation`).textContent=fmt(m.elevation);$(`#${body}Azimuth`).textContent=m.azimuth.toFixed(1)+'°';
    $(`#${body}Horizon`).textContent=fmt(m.horizon);$(`#${body}Margin`).textContent=fmt(m.margin);
    const status=$(`#${body}Status`),edge=Math.abs(m.margin)<.2;
    status.textContent=edge?'LIMÍTROFE':m.available?'VISÍVEL':'OBSTRUÍDO';status.className=`visibility ${edge?'edge':m.available?'visible':'hidden'}`;
    $(`#${body}Label b`).textContent=fmt(m.elevation);
  }
  $('#irradiance').innerHTML=`${Math.round(current.irradiance)} <small>W/m²</small>`;
  $('#solarMeter').style.width=clamp(current.irradiance/1420*100,0,100)+'%';
  $('#earthDistance').textContent=Math.round(current.earth.distanceKm).toLocaleString('pt-BR')+' km';
  $('#lightingBadge').textContent=current.sun.diskFraction===0?'SOMBRA / LUZ DE LEITURA':current.sun.diskFraction<1?'SOL PARCIALMENTE OBSTRUÍDO':'ILUMINAÇÃO SOLAR';
  // Update directions before resetting the camera for a newly focused site.
  scene?.update(current,d,state.heightM,state.selected);scene?.setTerrain(terrain);
  renderHorizon(terrain,current);renderTimeline();
}

function renderHorizon(terrain,result){
  const horizon=terrain.horizon(state.heightM),W=650,H=190,L=40,T=15,B=28,R=12;
  const lower=Math.min(-4,Math.floor(Math.min(...horizon,result.sun.elevation,result.earth.elevation)/2)*2);
  const upper=Math.max(8,Math.ceil(Math.max(...horizon,result.sun.elevation,result.earth.elevation)/2)*2);
  const x=az=>L+az/360*(W-L-R),y=el=>T+(upper-el)/(upper-lower)*(H-T-B);
  let content='';
  for(let i=0;i<5;i++){const el=lower+(upper-lower)*i/4;content+=`<line x1="${L}" x2="${W-R}" y1="${y(el)}" y2="${y(el)}" class="chart-grid"/><text x="${L-6}" y="${y(el)+4}" text-anchor="end" class="chart-text">${el.toFixed(0)}°</text>`;}
  for(let az=0;az<=360;az+=90){content+=`<text x="${x(az)}" y="${H-7}" text-anchor="middle" class="chart-text">${az}°</text>`;}
  const path=Array.from(horizon,(h,i)=>`${i?'L':'M'}${x(i/2).toFixed(1)},${y(h).toFixed(1)}`).join(' ');
  content+=`<path d="${path} L${x(360)},${y(lower)} L${x(0)},${y(lower)} Z" class="chart-terrain"/><line x1="${L}" x2="${W-R}" y1="${y(0)}" y2="${y(0)}" class="chart-zero"/>`;
  for(const body of ['sun','earth']){const m=result[body];content+=`<circle cx="${x(m.azimuth)}" cy="${y(m.elevation)}" r="5" class="chart-${body}"><title>${body==='sun'?'Sol':'Terra'}: ${fmt(m.elevation)} / ${m.azimuth.toFixed(1)}°</title></circle>`;}
  $('#horizonChart').innerHTML=content;
}

function renderTimeline(){
  // Every column refers to an hour beginning at the selected UTC hour, not midnight.
  const base=new Date(state.date);base.setUTCMinutes(0,0,0);
  const key=[base.toISOString(),state.selected.join(','),state.heightM].join('|');
  if(key===timelineKey)return;timelineKey=key;
  const timeVectors=Array.from({length:24},(_,h)=>ephemeris(new Date(base.getTime()+h*36e5),astronomy));
  $('#timeScale').innerHTML=[0,6,12,18,24].map(h=>`<span>${String(new Date(base.getTime()+h*36e5).getUTCHours()).padStart(2,'0')}h</span>`).join('');
  let best=0;
  $('#timelineRows').innerHTML=selectedSites().map(s=>{
    const availability=[];
    const blocks=timeVectors.map((eph,h)=>{
      const date=new Date(base.getTime()+h*36e5),m=evaluate(s,date,terrains.get(s.id),astronomy,state.heightM,state.panel,eph);
      const sun=m.sun.available,earth=m.earth.available;availability.push(sun&&earth);
      const cls=sun&&earth?'both':sun?'sun-only':earth?'earth-only':'none';
      const label=`${s.name}, ${humanDate(date)}: ${sun?'Sol visível':'Sol obstruído'}, ${earth?'Terra visível':'Terra obstruída'}`;
      return `<button class="hour ${cls} ${h===0?'selected-hour':''}" data-hour="${date.toISOString()}" data-hour-site="${s.id}" title="${label}" aria-label="${label}"></button>`;
    }).join('');
    best=Math.max(best,longestRun(availability).length);
    return `<div class="timeline-row"><button class="timeline-name" data-timeline-site="${s.id}">${s.name}</button><div class="timeline-track">${blocks}</div></div>`;
  }).join('');
  $('#bestSpan').innerHTML=best+'h<small>maior intervalo / local</small>';
  $$('[data-hour]').forEach(el=>el.addEventListener('click',()=>{state.primary=el.dataset.hourSite;renderSites();setDate(new Date(el.dataset.hour));}));
  $$('[data-timeline-site]').forEach(el=>el.addEventListener('click',()=>focusSite(el.dataset.timelineSite)));
}

function stopPlayback(){if(playing)clearInterval(playing);playing=null;$('#playButton').textContent='▶';$('#playButton').setAttribute('aria-pressed','false');$('#playButton').setAttribute('aria-label','Animar passagem do tempo');}
async function findBestWindow(){
  if(searching||!ready)return;stopPlayback();searching=true;
  const button=$('#bestWindow');button.disabled=true;button.textContent='Calculando…';
  const snapshot={date:new Date(state.date),sites:selectedSites(),heightM:state.heightM,panel:state.panel};
  const hours=[];
  try{
    for(let h=0;h<720;h++){
      const date=new Date(snapshot.date.getTime()+h*36e5);
      if(!validDate(date))break;
      const eph=ephemeris(date,astronomy);
      hours.push(snapshot.sites.every(s=>{const m=evaluate(s,date,terrains.get(s.id),astronomy,snapshot.heightM,snapshot.panel,eph);return m.sun.available&&m.earth.available;}));
      if(h%48===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    const best=longestRun(hours);
    if(!best.length){message('Nenhum intervalo comum de Sol + Terra encontrado nos próximos 30 dias. Compare menos locais ou explore outra data.');return;}
    if(state.date.getTime()!==snapshot.date.getTime()||state.heightM!==snapshot.heightM||state.selected.join(',')!==snapshot.sites.map(s=>s.id).join(',')){message('Os parâmetros mudaram durante a busca. Calcule novamente para usar a seleção atual.');return;}
    const start=new Date(snapshot.date.getTime()+best.start*36e5),end=new Date(start.getTime()+best.length*36e5);
    setDate(start,true);message(`Maior intervalo comum estimado: ${best.length} h, de ${humanDate(start)} a ${humanDate(end)}. Busca de 30 dias, com amostras de 1 hora.`);
  }finally{searching=false;button.disabled=false;button.textContent='Melhor janela';}
}

$('#dateTime').addEventListener('change',()=>{stopPlayback();setDate(new Date($('#dateTime').value+'Z'));});
$('#nowButton').addEventListener('click',()=>{stopPlayback();setDate(new Date());});
$$('[data-shift]').forEach(b=>b.addEventListener('click',()=>{stopPlayback();setDate(new Date(state.date.getTime()+Number(b.dataset.shift)*36e5));}));
$('#bestWindow').addEventListener('click',findBestWindow);
$('#height').addEventListener('input',()=>{state.heightM=Number($('#height').value);render();if(state.view==='surface')scene?.resetCamera();});
$$('[name=panel]').forEach(el=>el.addEventListener('change',()=>{state.panel=el.value;render();}));
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('#hourSlider').addEventListener('input',()=>{stopPlayback();const date=new Date(state.date);date.setUTCHours(0,Number($('#hourSlider').value),0,0);setDate(date);});
$('#playButton').addEventListener('click',()=>{
  if(playing){stopPlayback();return;}if(!ready)return;
  $('#playButton').textContent='Ⅱ';$('#playButton').setAttribute('aria-pressed','true');$('#playButton').setAttribute('aria-label','Pausar passagem do tempo');
  playing=setInterval(()=>{if(document.hidden)return;const d=new Date(state.date.getTime()+10*60e3);if(!setDate(d))stopPlayback();},250);
});
$('#focusSun').addEventListener('click',()=>{if(state.view==='globe')setView('surface');scene?.focus('sun');});
$('#focusEarth').addEventListener('click',()=>{if(state.view==='globe')setView('surface');scene?.focus('earth');});
$('#resetCamera').addEventListener('click',()=>scene?.resetCamera());
$('#fullscreenButton').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#sceneViewport').requestFullscreen();}catch{message('O navegador não disponibilizou o modo de tela cheia.');}});
const dialog=$('#aboutDialog');for(const id of ['#helpButton','#footerMethod'])$(id).addEventListener('click',()=>dialog.showModal());$('.dialog-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)scene?.invalidate();});
window.addEventListener('pagehide',()=>{stopPlayback();scene?.dispose();});

function readVisibility(){return {utcDate:state.date.toISOString(),primarySite:state.primary,camera:state.view,heightM:state.heightM,panel:state.panel,sites:selectedSites().map(s=>{const m=evaluate(s,state.date,terrains.get(s.id),astronomy,state.heightM,state.panel);return {id:s.id,name:s.name,sunElevation:m.sun.elevation,sunAzimuth:m.sun.azimuth,sunMargin:m.sun.margin,earthElevation:m.earth.elevation,earthMargin:m.earth.margin,irradianceWm2:m.irradiance};})};}
function registerWebMCP(){
  const ctx=document.modelContext;if(!ctx?.registerTool)return;
  const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  const register=tool=>{try{Promise.resolve(ctx.registerTool(tool,{signal:lifecycle.signal})).catch(e=>console.warn('WebMCP registration:',e));}catch(e){console.warn('WebMCP registration:',e);}};
  register({name:'configure_lunar_comparison',title:'Configurar comparação lunar 3D',description:'Seleciona de um a três locais, a data UTC e opcionalmente a câmera e altura do observador.',inputSchema:{type:'object',properties:{siteIds:{type:'array',items:{type:'string',enum:sites.map(s=>s.id)},minItems:1,maxItems:3,uniqueItems:true},utcDate:{type:'string',description:'ISO 8601 com fuso explícito'},camera:{type:'string',enum:['terrain','surface','globe']},heightM:{type:'integer',minimum:2,maximum:20,multipleOf:2}},required:['siteIds','utcDate'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},async execute(input){
    if(!input||Object.keys(input).some(k=>!['siteIds','utcDate','camera','heightM'].includes(k)))throw new Error('Parâmetros desconhecidos.');
    if(!Array.isArray(input.siteIds)||input.siteIds.length<1||input.siteIds.length>3||new Set(input.siteIds).size!==input.siteIds.length||input.siteIds.some(id=>!sites.find(s=>s.id===id)))throw new Error('Selecione de um a três locais distintos e válidos.');
    const d=new Date(input.utcDate);if(typeof input.utcDate!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(input.utcDate)||!validDate(d))throw new Error('Data UTC inválida ou fora de 2000–2050.');
    if(input.camera&&!['terrain','surface','globe'].includes(input.camera))throw new Error('Câmera inválida.');
    if(input.heightM!==undefined&&(!Number.isInteger(input.heightM)||input.heightM<2||input.heightM>20||input.heightM%2))throw new Error('Altura deve ser par, entre 2 e 20 m.');
    stopPlayback();message('');state.selected=[...input.siteIds];state.primary=state.selected[0];state.date=d;
    if(input.heightM!==undefined){state.heightM=input.heightM;$('#height').value=state.heightM;}
    renderSites();setView(input.camera||state.view);await new Promise(requestAnimationFrame);return readVisibility();
  }});
  register({name:'read_lunar_visibility',title:'Ler visibilidade lunar',description:'Lê elevações, margens sobre o horizonte LOLA e irradiância nos locais selecionados.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:readVisibility});
}

renderSites();render();
async function init(){
  try{
    if(!astronomy)throw new Error('A biblioteca de efemérides não carregou.');
    const response=await fetch('./data/metadata.json');if(!response.ok)throw new Error('Metadados LOLA indisponíveis.');const metadata=await response.json();
    await Promise.all(sites.map(async s=>{const r=await fetch(`./data/${s.id}.bin`);if(!r.ok)throw new Error(`Terreno de ${s.name} indisponível.`);const buffer=await r.arrayBuffer();if(buffer.byteLength!==metadata.tileSize**2*4)throw new Error('Malha de terreno incompleta.');terrains.set(s.id,new Terrain(s,new Float32Array(buffer),metadata));}));
    ready=true;
    try{scene=new LunarScene($('#sceneCanvas'),$('#sceneViewport'),sites,t=>message(t,true));}catch(error){message('O navegador não conseguiu iniciar WebGL. Os cálculos e os gráficos continuam disponíveis.',true);$('#sceneLoading').innerHTML='<b>Visualização 3D indisponível</b><span>Ative a aceleração gráfica ou experimente outro navegador.</span>';console.warn(error);}
    render();if(scene)$('#sceneLoading').classList.add('hidden');registerWebMCP();
  }catch(error){message(error.message,true);$('#sceneLoading').innerHTML='<b>Não foi possível carregar os dados</b><span>Recarregue a página para tentar novamente.</span>';console.error(error);}
}
init();
