const sites = [
  { id:'shackleton', name:'Cume Shackleton', lat:-89.90, lon:-129.2, rough:1.4, sunBias:2.6, earthBias:6.1, score:'ALTA LUZ', tags:['CUME','ENERGIA'] },
  { id:'malapert', name:'Maciço Malapert', lat:-85.99, lon:0.2, rough:2.1, sunBias:1.3, earthBias:7.5, score:'BOM LINK', tags:['ELEVAÇÃO','COMUNICAÇÃO'] },
  { id:'degerlache', name:'Crista de Gerlache', lat:-88.48, lon:-159.0, rough:2.9, sunBias:1.0, earthBias:4.6, score:'EQUILÍBRIO', tags:['CRISTA','CIÊNCIA'] },
  { id:'nobile', name:'Borda Nobile', lat:-85.20, lon:53.5, rough:3.7, sunBias:-0.2, earthBias:5.4, score:'RELEVO', tags:['CRATERA','VOLÁTEIS'] },
  { id:'haworth', name:'Borda Haworth', lat:-87.45, lon:-4.1, rough:4.3, sunBias:-1.0, earthBias:3.9, score:'SOMBRA', tags:['PSR','CIÊNCIA'] }
];

const state = { selected:['shackleton','malapert'], primary:'shackleton', view:'polar' };
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const deg = r => r * 180 / Math.PI;
const rad = d => d * Math.PI / 180;
const fmt = n => `${n >= 0 ? '+' : ''}${n.toFixed(1)}°`;
const selectedSites = () => state.selected.map(id => sites.find(s => s.id === id));

function model(site, date) {
  const hours = date.getTime() / 36e5;
  const lunar = (hours / (29.5306 * 24)) * 360;
  const slow = rad(lunar + site.lon * .36);
  const fast = rad((hours % 24) * 15 + site.lon);
  const sunEl = site.sunBias + 3.7 * Math.sin(slow) + .45 * Math.sin(fast);
  const sunAz = (lunar * .93 + site.lon + 360) % 360;
  const earthEl = site.earthBias + 1.9 * Math.sin(rad(lunar * 1.07 + site.lon * .15));
  const earthAz = (18 + site.lon * .12 + 5 * Math.sin(slow) + 360) % 360;
  const localHorizonSun = site.rough * (.45 + .35 * Math.sin(rad(sunAz * 2 + site.lon)));
  const localHorizonEarth = site.rough * (.35 + .28 * Math.cos(rad(earthAz * 3 - site.lon)));
  return { sunEl, sunAz, earthEl, earthAz, sunMargin:sunEl-localHorizonSun, earthMargin:earthEl-localHorizonEarth };
}

function polarPoint(az, el) {
  const r = clamp(162 - el * 8.5, 18, 178);
  return { x:210 + Math.sin(rad(az))*r, y:210 - Math.cos(rad(az))*r };
}

function terrainPath(site) {
  const pts=[];
  for(let a=0;a<=360;a+=6){
    const elevation = site.rough*(.52+.24*Math.sin(rad(a*2+site.lon))+.14*Math.cos(rad(a*5-site.lon)));
    const p=polarPoint(a,elevation);
    pts.push(`${a===0?'M':'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  }
  return pts.join(' ')+' Z';
}

function renderSites(){
  $('#siteList').innerHTML=sites.map(site=>{
    const sel=state.selected.includes(site.id), primary=state.primary===site.id;
    return `<button class="site-item ${sel?'selected':''} ${primary?'primary':''}" data-site="${site.id}" aria-pressed="${sel}">
      <span class="site-check">${sel?'✓':''}</span><h3>${site.name}</h3>
      <div class="site-coords">${Math.abs(site.lat).toFixed(2)}°S · ${Math.abs(site.lon).toFixed(1)}°${site.lon<0?'W':'E'}</div>
      <div class="site-tags"><span class="site-tag">${site.score}</span><span class="site-tag">${site.tags[0]}</span></div>
    </button>`;
  }).join('');
  $('#selectionCount').textContent=`${state.selected.length} / 3`;
  $$('.site-item').forEach(btn=>btn.addEventListener('click',()=>toggleSite(btn.dataset.site)));
}

function toggleSite(id){
  if(state.selected.includes(id)){
    if(state.selected.length===1) return;
    state.selected=state.selected.filter(x=>x!==id);
    if(state.primary===id) state.primary=state.selected[0];
  }else{
    if(state.selected.length===3){ state.selected.shift(); }
    state.selected.push(id); state.primary=id;
  }
  renderAll();
}

function getDate(){ return new Date($('#dateTime').value+'Z'); }
function setDate(date){
  const iso=new Date(date).toISOString().slice(0,16);
  $('#dateTime').value=iso;
  renderAll();
}

function updateReadout(){
  const site=sites.find(s=>s.id===state.primary);
  const m=model(site,getDate());
  $('#primarySiteName').textContent=site.name;
  $('#terrainPath').setAttribute('d',terrainPath(site));
  const sp=polarPoint(m.sunAz,m.sunEl), ep=polarPoint(m.earthAz,m.earthEl);
  $('#sunMarker').setAttribute('transform',`translate(${sp.x} ${sp.y})`);
  $('#earthMarker').setAttribute('transform',`translate(${ep.x} ${ep.y})`);
  $('#sunMarker').style.opacity=m.sunEl>-5?'1':'.28'; $('#earthMarker').style.opacity=m.earthEl>-5?'1':'.28';
  $('#sunElevation').textContent=fmt(m.sunEl); $('#sunAzimuth').textContent=`${Math.round(m.sunAz)}°`; $('#sunMargin').textContent=fmt(m.sunMargin);
  $('#earthElevation').textContent=fmt(m.earthEl); $('#earthAzimuth').textContent=`${Math.round(m.earthAz)}°`; $('#earthMargin').textContent=fmt(m.earthMargin);
  const ss=$('#sunStatus'), es=$('#earthStatus');
  ss.textContent=m.sunMargin>0?'ILUMINAÇÃO FAVORÁVEL':'SOL OBSTRUÍDO PELO RELEVO'; ss.className=`status-label ${m.sunMargin>0?'favorable':'unavailable'}`;
  es.textContent=m.earthMargin>0?'LINK DIRETO DISPONÍVEL':'LINHA DE VISADA BLOQUEADA'; es.className=`status-label ${m.earthMargin>0?'connected':'unavailable'}`;
}

function updateClock(){
  const d=getDate();
  $('#clock').textContent=d.toISOString().slice(11,19);
  const start=new Date(Date.UTC(d.getUTCFullYear(),0,0));
  const day=Math.floor((d-start)/86400000);
  $('#dayOfYear').textContent=`DIA ${String(day).padStart(3,'0')} · ${d.getUTCFullYear()}`;
}

function renderTimeline(){
  const base=getDate(); base.setUTCHours(0,0,0,0);
  let best=0;
  $('#timelineRows').innerHTML=selectedSites().map(site=>{
    let combined=0;
    const hours=Array.from({length:24},(_,h)=>{
      const d=new Date(base.getTime()+h*36e5), m=model(site,d);
      const sun=m.sunMargin>0, earth=m.earthMargin>0;
      if(sun&&earth) combined++;
      const cls=sun&&earth?'both':sun?'sun-only':earth?'earth-only':'none';
      const label=`${String(h).padStart(2,'0')}:00 — Sol ${fmt(m.sunEl)}, Terra ${fmt(m.earthEl)}`;
      return `<span class="hour ${cls}" title="${label}" aria-label="${label}"></span>`;
    }).join('');
    best=Math.max(best,combined);
    return `<div class="timeline-row"><div class="timeline-name">${site.name}</div><div class="timeline-track">${hours}</div></div>`;
  }).join('');
  $('#bestSpan').textContent=`${best}h`;
}

function renderAll(){ renderSites(); updateReadout(); updateClock(); renderTimeline(); }

$('#dateTime').addEventListener('change',renderAll);
$$('[data-shift]').forEach(btn=>btn.addEventListener('click',()=>{
  $$('.chip').forEach(x=>x.classList.remove('active')); btn.classList.add('active');
  if(btn.dataset.shift==='0') setDate(new Date()); else setDate(new Date(getDate().getTime()+Number(btn.dataset.shift)*36e5));
}));
$('#bestWindow').addEventListener('click',()=>{
  const start=getDate(); let best={score:-1,date:start};
  for(let h=0;h<29*24;h+=2){
    const date=new Date(start.getTime()+h*36e5);
    const score=selectedSites().reduce((sum,s)=>{const m=model(s,date);return sum+(m.sunMargin>0?1:0)+(m.earthMargin>0?1:0)},0);
    if(score>best.score) best={score,date};
  }
  setDate(best.date); $$('.chip').forEach(x=>x.classList.remove('active')); $('#bestWindow').classList.add('active');
});
$$('.view-tab').forEach(btn=>btn.addEventListener('click',()=>{
  $$('.view-tab').forEach(x=>{x.classList.toggle('active',x===btn);x.setAttribute('aria-selected',x===btn)});
  state.view=btn.dataset.view;
  $('#skyChart').style.transform=state.view==='profile'?'perspective(700px) rotateX(62deg) scale(.92)':'none';
}));
const dialog=$('#aboutDialog'); $('#helpButton').addEventListener('click',()=>dialog.showModal()); $('.dialog-close').addEventListener('click',()=>dialog.close());

function registerWebMCP(){
  const ctx=document.modelContext;
  if(!ctx?.registerTool) return;
  const report=e=>console.warn('WebMCP:',e);
  try{
    Promise.resolve(ctx.registerTool({
      name:'configure_lunar_comparison', title:'Configurar comparação lunar',
      description:'Seleciona de um a três locais candidatos e define a data UTC mostrada no comparador.',
      inputSchema:{type:'object',properties:{siteIds:{type:'array',items:{type:'string',enum:sites.map(s=>s.id)},minItems:1,maxItems:3,uniqueItems:true},utcDate:{type:'string',description:'Data/hora em ISO 8601'}},required:['siteIds','utcDate'],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input){
        if(!Array.isArray(input?.siteIds)||!input.siteIds.length||input.siteIds.length>3||input.siteIds.some(id=>!sites.find(s=>s.id===id))) throw new Error('siteIds deve conter de 1 a 3 identificadores válidos.');
        const d=new Date(input.utcDate); if(Number.isNaN(d.getTime())) throw new Error('utcDate inválida.');
        state.selected=[...new Set(input.siteIds)]; state.primary=state.selected[0]; setDate(d);
        return {selectedSites:selectedSites().map(s=>s.name),utcDate:d.toISOString()};
      }
    })).catch(report);
    Promise.resolve(ctx.registerTool({
      name:'read_lunar_visibility', title:'Ler visibilidade lunar',
      description:'Retorna as elevações e margens atuais do Sol e da Terra para os locais selecionados.',
      inputSchema:{type:'object',properties:{},additionalProperties:false},
      annotations:{readOnlyHint:true,untrustedContentHint:false},
      execute(){const d=getDate();return {utcDate:d.toISOString(),sites:selectedSites().map(s=>({name:s.name,...model(s,d)}))};}
    })).catch(report);
  }catch(e){report(e);}
}

renderAll(); registerWebMCP();
