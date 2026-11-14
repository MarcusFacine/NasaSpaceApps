import { sites } from './sites.js';
import { Terrain, evaluate, ephemeris, longestRun, clamp } from './model.js';
import { LunarScene } from './scene.js';
import { MissionUI } from './mission.js';
import { t, getLang, addDictionary, bindLanguageSwitch, onLangChange, number, signedDegrees, utcDate } from './i18n.js';

const SHORT = { shackleton: 'Shackleton', malapert: 'Malapert', degerlache: 'de Gerlache', nobile: 'Nobile', haworth: 'Haworth' };
addDictionary({ pt: { 'dir.S': 'S', 'dir.W': 'O', 'dir.E': 'L' }, en: { 'dir.S': 'S', 'dir.W': 'W', 'dir.E': 'E' } });

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const data = path => new URL(path, import.meta.url);
const astronomy = window.Astronomy;
const STORE = 'horisite-state-v1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const siteName = s => t(`site.${s.id}`);
const coords = s => `${number(Math.abs(s.lat), 2)}° ${t('dir.S')} · ${number(Math.abs(s.lon), 2)}° ${s.lon < 0 ? t('dir.W') : t('dir.E')}`;
const degrees = n => `${number(n, 1)}°`;

const state = { selected: ['shackleton', 'malapert'], primary: 'shackleton', view: 'terrain', heightM: 2, panel: 'tracking', date: new Date(), window: null, readingLight: false, psr: false };
const terrains = new Map();
let metadata = null, scene = null, ready = false, playing = null, timelineKey = '', stripKey = '', pathKey = '', searching = false, current = null, restored = false, ritual = null;
const selectedSites = () => state.selected.map(id => sites.find(s => s.id === id));
const primarySite = () => sites.find(s => s.id === state.primary);
const windowKey = () => [state.date.toISOString(), state.selected.join(','), state.heightM].join('|');

function chosenWindow() {
  if (state.window?.key === windowKey() && state.selected.includes(state.primary)) return { start: new Date(state.window.start), end: new Date(state.window.end), source: 'search' };
  return { start: new Date(state.date), end: new Date(+state.date + 24 * 36e5), source: 'manual' };
}
function validDate(date) { return Number.isFinite(date?.getTime()) && date >= new Date('2000-01-01T00:00Z') && date <= new Date('2050-12-31T23:59Z'); }
function save() { try { localStorage.setItem(STORE, JSON.stringify({ ...state, readingLight: undefined, psr: undefined })); } catch { /* storage optional */ } }
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE)); if (!s) return false;
    if (Array.isArray(s.selected) && s.selected.length >= 1 && s.selected.length <= 3 && new Set(s.selected).size === s.selected.length && s.selected.every(id => sites.some(site => site.id === id))) state.selected = s.selected;
    if (sites.some(site => site.id === s.primary)) state.primary = s.primary;
    if (validDate(new Date(s.date))) state.date = new Date(s.date);
    if (Number.isInteger(s.heightM) && s.heightM >= 2 && s.heightM <= 20 && s.heightM % 2 === 0) state.heightM = s.heightM;
    if (['tracking', 'horizontal'].includes(s.panel)) state.panel = s.panel;
    if (['terrain', 'surface', 'globe'].includes(s.view)) state.view = s.view;
    if (s.window?.key === windowKey() && validDate(new Date(s.window.start)) && validDate(new Date(s.window.end)) && new Date(s.window.end) > new Date(s.window.start)) state.window = s.window;
    return true;
  } catch { return false; }
}

let messageTimer = 0;
function message(text, error = false, sticky = false) {
  $('#appMessageText').textContent = text;
  $('#appMessage').className = `message ${text ? 'visible' : ''} ${error ? 'error' : ''}`;
  clearTimeout(messageTimer);
  if (text && !error && !sticky) messageTimer = setTimeout(() => message(''), 9000);
}
$('#appMessageClose').addEventListener('click', () => message(''));

function setDate(date, keepMessage = false) {
  if (!validDate(date)) { message(t('msg.dateRange'), true); $('#dateTime').value = state.date.toISOString().slice(0, 16); return false; }
  state.date = new Date(date); if (!keepMessage) message(''); render(); return true;
}

function renderSites() {
  $('#siteList').innerHTML = sites.map((s, i) => {
    const checked = state.selected.includes(s.id), primary = state.primary === s.id;
    return `<div class="site-chip ${checked ? 'checked' : ''} ${primary ? 'primary' : ''}"><label><input type="checkbox" data-site-check="${s.id}" ${checked ? 'checked' : ''} aria-label="${t('sites.compare', { name: siteName(s) })}"><span class="n"><span>${i + 1}</span></span></label><button type="button" data-site-focus="${s.id}" aria-pressed="${primary}" title="${siteName(s)} · ${coords(s)}" aria-label="${siteName(s)}">${SHORT[s.id]}</button></div>`;
  }).join('');
  $$('[data-site-check]').forEach(el => el.addEventListener('change', () => {
    if (el.checked) { if (state.selected.length >= 3) { el.checked = false; message(t('sites.max')); return; } state.selected.push(el.dataset.siteCheck); }
    else { if (state.selected.length === 1) { el.checked = true; message(t('sites.min')); return; } state.selected = state.selected.filter(id => id !== el.dataset.siteCheck); }
    message(''); renderSites(); ensureTerrains(state.selected).then(render);
  }));
  $$('[data-site-focus]').forEach(el => el.addEventListener('click', () => focusSite(el.dataset.siteFocus)));
}
async function focusSite(id) { state.primary = id; renderSites(); await ensureTerrains([id]); render(); }
function setView(view) {
  state.view = view;
  $$('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  scene?.setView(view); render();
}

// 24 hours of Sun and Earth directions for the primary site, every 30 minutes.
function computePaths(site, terrain, date) {
  const key = [site.id, state.heightM, Math.floor(+date / 6e5)].join('|');
  if (key === pathKey && computePaths.last) return computePaths.last;
  const out = { sun: [], earth: [] };
  for (let i = 0; i <= 48; i++) {
    const m = evaluate(site, new Date(+date + i * 18e5), terrain, astronomy, state.heightM, state.panel);
    for (const body of ['sun', 'earth']) out[body].push({ direction: m[body].direction, visible: m[body].available, azimuth: m[body].azimuth, elevation: m[body].elevation });
  }
  pathKey = key; computePaths.last = out; return out;
}

function render() {
  const d = state.date, site = primarySite();
  if (state.window?.key !== windowKey()) state.window = null;
  const win = chosenWindow();
  $('#chosenWindow').textContent = `${utcDate(win.start)} → ${utcDate(win.end)} · ${t(win.source === 'search' ? 'window.search' : 'window.manual')}`;
  save();
  $('#dateTime').value = d.toISOString().slice(0, 16);
  $('#hourOutput').textContent = d.toISOString().slice(11, 16) + ' UTC';
  $('#hourSlider').value = d.getUTCHours() * 60 + d.getUTCMinutes();
  $('#heightOutput').textContent = state.heightM + ' m';
  $('#primarySiteName').textContent = siteName(site);
  $('#sceneCoordinates').textContent = coords(site);
  $('#cameraHint').textContent = t(state.view === 'surface' ? 'hint.surface' : state.view === 'globe' ? 'hint.globe' : 'hint.terrain');
  $('#scaleLabel').textContent = scene?.telephoto && state.view === 'surface' ? t('scale.tele') : t(state.view === 'surface' ? 'scale.surface' : state.view === 'globe' ? 'scale.globe' : 'scale.terrain', { h: state.heightM });
  const terrain = terrains.get(state.primary);
  if (!ready || !terrain) return;
  current = evaluate(site, d, terrain, astronomy, state.heightM, state.panel);
  for (const body of ['sun', 'earth']) {
    const m = current[body], row = $(`#${body}Row`), edge = Math.abs(m.margin) < 0.2;
    const s = edge ? 'edge' : m.available ? 'visible' : 'blocked';
    row.dataset.state = s;
    $(`#${body}Status`).textContent = t(`state.${s}`);
    $(`#${body}MarginText`).textContent = t(m.margin >= 0 ? 'answer.above' : 'answer.below', { v: `${number(Math.abs(m.margin), 2)}°` });
    $(`#${body}Elevation`).textContent = signedDegrees(m.elevation);
    $(`#${body}Azimuth`).textContent = degrees(m.azimuth);
    $(`#${body}Label b`).textContent = signedDegrees(m.elevation);
  }
  $('#sunHorizon').textContent = signedDegrees(current.sun.horizon);
  $('#earthDistance').textContent = `${number(Math.round(current.earth.distanceKm))} km`;
  $('#irradiance').textContent = `${Math.round(current.irradiance)} W/m²`;
  $('#solarMeter').style.transform = `scaleX(${clamp(current.irradiance / 1420, 0, 1)})`;
  const light = state.readingLight ? 'reading' : current.sun.diskFraction === 0 ? 'dark' : current.sun.diskFraction < 1 ? 'partial' : 'real';
  $('#lightingBadge').textContent = t(`light.${light}`) + (state.psr ? ` · ${t('psr.legend')}` : '');
  $('.stage-meta').dataset.light = light;
  const paths = computePaths(site, terrain, d);
  if (scene) { scene.update(current, d, state.heightM, state.selected); scene.setTerrain(terrain); scene.setPaths(paths); }
  renderHorizon(terrain, current, paths); renderStrip(site, terrain); renderTimeline();
}

function renderHorizon(terrain, result, paths) {
  const horizon = terrain.horizon(state.heightM), W = 960, H = 280, L = 46, T = 18, B = 30, R = 14;
  const els = [...horizon, ...paths.sun.map(p => p.elevation), ...paths.earth.map(p => p.elevation)];
  const lower = Math.min(-4, Math.floor(Math.min(...els) / 2) * 2), upper = Math.max(8, Math.ceil(Math.max(...els) / 2) * 2);
  const x = az => L + az / 360 * (W - L - R), y = el => T + (upper - el) / (upper - lower) * (H - T - B);
  let out = `<title id="horizonTitle">${t('horizon.title')}</title>`;
  for (let i = 0; i <= 4; i++) { const el = lower + (upper - lower) * i / 4; out += `<line x1="${L}" x2="${W - R}" y1="${y(el)}" y2="${y(el)}" class="hz-grid"/><text x="${L - 8}" y="${y(el) + 4}" text-anchor="end" class="hz-text">${number(el)}°</text>`; }
  for (let az = 0; az <= 360; az += 45) out += `<text x="${x(az)}" y="${H - 8}" text-anchor="middle" class="hz-text">${az}°</text>`;
  const relief = Array.from(horizon, (h, i) => `${i ? 'L' : 'M'}${x(i / 2).toFixed(1)},${y(h).toFixed(1)}`).join(' ');
  out += `<path d="${relief} L${x(360)},${y(lower)} L${x(0)},${y(lower)} Z" class="hz-relief"/><line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="hz-zero"/>`;
  for (const body of ['sun', 'earth']) {
    let d = '', prev = null;
    for (const p of paths[body]) { d += `${prev === null || Math.abs(p.azimuth - prev) > 180 ? 'M' : 'L'}${x(p.azimuth).toFixed(1)},${y(p.elevation).toFixed(1)} `; prev = p.azimuth; }
    out += `<path d="${d}" class="hz-path-${body}"/>`;
  }
  for (const body of ['sun', 'earth']) {
    const m = result[body], cx = x(m.azimuth), cy = y(m.elevation), right = cx < W - 120;
    out += `<circle cx="${cx}" cy="${cy}" r="7" class="hz-now-${body}"><title>${t(body)} · ${signedDegrees(m.elevation)} · ${degrees(m.azimuth)}</title></circle>`;
    out += `<text x="${cx + (right ? 12 : -12)}" y="${cy - 10}" text-anchor="${right ? 'start' : 'end'}" class="hz-label">${t(body)} · ${t('legend.now')}</text>`;
  }
  $('#horizonChart').innerHTML = out;
}

// 24 cells under the time scrubber for the primary site: Sun on top, Earth below.
function renderStrip(site, terrain) {
  const base = new Date(state.date); base.setUTCHours(0, 0, 0, 0);
  const key = [site.id, base.toISOString(), state.heightM].join('|'); if (key === stripKey) return; stripKey = key;
  $('#dayStrip').innerHTML = Array.from({ length: 24 }, (_, h) => {
    const m = evaluate(site, new Date(+base + h * 36e5), terrain, astronomy, state.heightM, state.panel);
    return `<i class="${m.sun.available ? 's1' : 's0'} ${m.earth.available ? 'e1' : 'e0'}"></i>`;
  }).join('');
}

function renderTimeline() {
  // Each column is an hour starting at the selected UTC hour, not at midnight.
  const base = new Date(state.date); base.setUTCMinutes(0, 0, 0);
  const key = [base.toISOString(), state.selected.join(','), state.heightM, getLang()].join('|');
  if (key === timelineKey || !state.selected.every(id => terrains.has(id))) return; timelineKey = key;
  const vectors = Array.from({ length: 24 }, (_, h) => ephemeris(new Date(+base + h * 36e5), astronomy));
  $('#timeScale').innerHTML = [0, 6, 12, 18, 24].map(h => `<span>${String(new Date(+base + h * 36e5).getUTCHours()).padStart(2, '0')}h</span>`).join('');
  let best = 0;
  $('#timelineRows').innerHTML = selectedSites().map(s => {
    const both = [];
    const cells = vectors.map((eph, h) => {
      const date = new Date(+base + h * 36e5), m = evaluate(s, date, terrains.get(s.id), astronomy, state.heightM, state.panel, eph);
      const sun = m.sun.available, earth = m.earth.available; both.push(sun && earth);
      const label = t('timeline.cell', { site: siteName(s), date: utcDate(date), sun: t(sun ? 'sun.visible' : 'sun.blocked'), earth: t(earth ? 'earth.visible' : 'earth.blocked') });
      return `<button type="button" class="hour ${sun ? 's1' : 's0'} ${earth ? 'e1' : 'e0'} ${h === 0 ? 'selected-hour' : ''}" data-hour="${date.toISOString()}" data-hour-site="${s.id}" title="${label}" aria-label="${label}"></button>`;
    }).join('');
    best = Math.max(best, longestRun(both).length);
    return `<div class="timeline-row"><button type="button" class="timeline-name" data-timeline-site="${s.id}"><span class="n">${sites.indexOf(s) + 1}</span>${siteName(s)}</button><div class="timeline-track">${cells}</div></div>`;
  }).join('');
  $('#bestSpan').textContent = `${best}h`;
  $$('[data-hour]').forEach(el => el.addEventListener('click', () => { state.primary = el.dataset.hourSite; renderSites(); stopPlayback(); setDate(new Date(el.dataset.hour)); }));
  $$('[data-timeline-site]').forEach(el => el.addEventListener('click', () => focusSite(el.dataset.timelineSite)));
}

function stopPlayback() {
  if (playing) clearInterval(playing); playing = null;
  const b = $('#playButton'); b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', t('time.play'));
}

// Longest continuous Sun + Earth interval for the selection in the next 30 days.
async function searchWindow(from, selection, heightM, panel) {
  const hours = [];
  for (let h = 0; h < 720; h++) {
    const date = new Date(+from + h * 36e5); if (!validDate(date)) break;
    const eph = ephemeris(date, astronomy);
    hours.push(selection.every(s => { const m = evaluate(s, date, terrains.get(s.id), astronomy, heightM, panel, eph); return m.sun.available && m.earth.available; }));
    if (h % 48 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const best = longestRun(hours);
  if (!best.length) return null;
  const start = new Date(+from + best.start * 36e5);
  return { start, end: new Date(+start + best.length * 36e5), hours: best.length };
}
async function findBestWindow() {
  if (searching || !ready) return; stopPlayback(); searching = true;
  const button = $('#bestWindow'); button.disabled = true; button.textContent = t('action.searching');
  const snapshot = { date: new Date(state.date), sites: selectedSites(), heightM: state.heightM, panel: state.panel };
  try {
    await ensureTerrains(state.selected);
    const found = await searchWindow(snapshot.date, snapshot.sites, snapshot.heightM, snapshot.panel);
    if (!found) { message(t('msg.noWindow')); return; }
    if (+state.date !== +snapshot.date || state.heightM !== snapshot.heightM || state.selected.join(',') !== snapshot.sites.map(s => s.id).join(',')) { message(t('msg.changed')); return; }
    setDate(found.start, true); state.window = { start: found.start.toISOString(), end: found.end.toISOString(), key: windowKey() }; render();
    message(t('msg.best', { h: found.hours, start: utcDate(found.start), end: utcDate(found.end) }));
  } finally { searching = false; button.disabled = false; button.textContent = t('action.best'); }
}

// First visit: the room goes dark, the stars come up and time runs until the Sun clears the rim.
async function openingRitual() {
  const found = await searchWindow(new Date(), selectedSites(), state.heightM, state.panel).catch(() => null);
  if (!found) { render(); return; }
  const end = found.start, start = new Date(+end - 6 * 36e5);
  state.date = new Date(end); render(); scene?.resetCamera();
  const finish = () => { ritual = null; state.date = new Date(end); state.window = { start: end.toISOString(), end: found.end.toISOString(), key: windowKey() }; render(); message(t('msg.opening')); };
  if (reducedMotion || !scene) { finish(); return; }
  const duration = 4200, t0 = performance.now();
  ritual = { cancel: false };
  const step = now => {
    if (!ritual || ritual.cancel) return;
    const k = Math.min(1, (now - t0) / duration), e = 1 - Math.pow(1 - k, 3);
    state.date = new Date(+start + (end - start) * e); render();
    if (k < 1) requestAnimationFrame(step); else finish();
  };
  requestAnimationFrame(step);
}
const cancelRitual = () => { if (ritual) ritual.cancel = true; ritual = null; };

async function loadTerrain(site) {
  if (terrains.has(site.id)) return terrains.get(site.id);
  const response = await fetch(data(`./data/${site.id}.bin`));
  if (!response.ok) throw new Error(t('error.data', { name: siteName(site) }));
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== metadata.tileSize ** 2 * 4) throw new Error(t('error.data', { name: siteName(site) }));
  let wide = null;
  if (metadata.wide) {
    const w = await fetch(data(`./data/${site.id}-wide.bin`)).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    if (w && w.byteLength === metadata.wide.tileSize ** 2 * 4) wide = new Float32Array(w);
  }
  let inner = null, psr = null;
  if (metadata.inner) {
    const b = await fetch(data(`./data/${site.id}-inner.bin`)).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    if (b && b.byteLength === metadata.inner.tileSize ** 2 * 4) inner = new Float32Array(b);
  }
  if (metadata.psr) {
    const b = await fetch(data(`./data/${site.id}-psr.bin`)).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    if (b && b.byteLength === metadata.psr.tileSize ** 2) psr = new Uint8Array(b);
  }
  const terrain = new Terrain(site, new Float32Array(buffer), metadata, wide, inner, psr);
  terrains.set(site.id, terrain); return terrain;
}
const ensureTerrains = ids => Promise.all(ids.map(id => loadTerrain(sites.find(s => s.id === id))));

// Controls
$('#dateTime').addEventListener('change', () => { cancelRitual(); stopPlayback(); setDate(new Date($('#dateTime').value + 'Z')); });
$('#nowButton').addEventListener('click', () => { cancelRitual(); stopPlayback(); setDate(new Date()); });
$$('[data-shift]').forEach(b => b.addEventListener('click', () => { cancelRitual(); stopPlayback(); setDate(new Date(+state.date + Number(b.dataset.shift) * 36e5)); }));
$('#bestWindow').addEventListener('click', () => { cancelRitual(); findBestWindow(); });
$('#height').addEventListener('input', () => { state.heightM = Number($('#height').value); render(); if (state.view === 'surface') scene?.resetCamera(); });
$$('[name=panel]').forEach(el => el.addEventListener('change', () => { state.panel = el.value; render(); }));
$$('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('#hourSlider').addEventListener('input', () => { cancelRitual(); stopPlayback(); const date = new Date(state.date); date.setUTCHours(0, Number($('#hourSlider').value), 0, 0); setDate(date); });
$('#playButton').addEventListener('click', () => {
  cancelRitual();
  if (playing) { stopPlayback(); return; } if (!ready) return;
  const b = $('#playButton'); b.setAttribute('aria-pressed', 'true'); b.setAttribute('aria-label', t('time.pause'));
  playing = setInterval(() => { if (document.hidden) return; if (!setDate(new Date(+state.date + 10 * 60e3))) stopPlayback(); }, 200);
});
// Sun and Earth buttons look through a lens from the observer's eye: the Earth fills the view with its real phase.
const lookAt = body => { if (state.view !== 'surface') setView('surface'); scene?.focus(body); render(); };
$('#focusSun').addEventListener('click', () => lookAt('sun'));
$('#focusEarth').addEventListener('click', () => lookAt('earth'));
$('#psrLayer').addEventListener('click', () => {
  state.psr = !state.psr; $('#psrLayer').setAttribute('aria-pressed', String(state.psr));
  scene?.setPsr(state.psr); render();
});
$('#resetCamera').addEventListener('click', () => { scene?.resetCamera(); render(); });
$('#readingLight').addEventListener('click', () => {
  state.readingLight = !state.readingLight; $('#readingLight').setAttribute('aria-pressed', String(state.readingLight));
  scene?.setReadingLight(state.readingLight); render();
});
$('#fullscreenButton').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#sceneViewport').requestFullscreen(); } catch { message(t('msg.fullscreen')); } });
const about = $('#aboutDialog');
for (const id of ['#helpButton', '#footerMethod']) $(id).addEventListener('click', () => about.showModal());
$('.dialog-close').addEventListener('click', () => about.close());
about.addEventListener('click', e => { if (e.target === about) { const r = about.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) about.close(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) scene?.invalidate(); });
window.addEventListener('pagehide', () => { stopPlayback(); scene?.dispose(); });

const mission = new MissionUI(astronomy, () => { if (scene) { scene.suspended = false; scene.invalidate(); } });
$('#missionButton').addEventListener('click', async () => {
  if (!ready) return; cancelRitual(); stopPlayback();
  const terrain = await loadTerrain(primarySite());
  if (scene) scene.suspended = true;
  mission.open({ site: primarySite(), terrain, window: chosenWindow(), heightM: state.heightM, panel: state.panel });
});

bindLanguageSwitch();
onLangChange(() => { document.title = t('meta.appTitle'); timelineKey = ''; stripKey = ''; renderSites(); render(); mission.refreshLanguage(); if (!searching) $('#bestWindow').textContent = t('action.best'); });
document.title = t('meta.appTitle');

// WebMCP tools for agents in the browser.
function readVisibility() {
  return { utcDate: state.date.toISOString(), primarySite: state.primary, camera: state.view, heightM: state.heightM, panel: state.panel, window: chosenWindow(),
    sites: selectedSites().filter(s => terrains.has(s.id)).map(s => { const m = evaluate(s, state.date, terrains.get(s.id), astronomy, state.heightM, state.panel); return { id: s.id, name: siteName(s), sunElevation: m.sun.elevation, sunAzimuth: m.sun.azimuth, sunMargin: m.sun.margin, earthElevation: m.earth.elevation, earthMargin: m.earth.margin, irradianceWm2: m.irradiance }; }) };
}
function registerWebMCP() {
  const ctx = document.modelContext; if (!ctx?.registerTool) return;
  const lifecycle = new AbortController(); window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  const register = tool => { try { Promise.resolve(ctx.registerTool(tool, { signal: lifecycle.signal })).catch(e => console.warn('WebMCP registration:', e)); } catch (e) { console.warn('WebMCP registration:', e); } };
  register({ name: 'configure_lunar_comparison', title: 'Configure lunar comparison', description: 'Selects one to three sites, the UTC date and optionally the camera and observer height.', inputSchema: { type: 'object', properties: { siteIds: { type: 'array', items: { type: 'string', enum: sites.map(s => s.id) }, minItems: 1, maxItems: 3, uniqueItems: true }, utcDate: { type: 'string', description: 'ISO 8601 with an explicit offset' }, camera: { type: 'string', enum: ['terrain', 'surface', 'globe'] }, heightM: { type: 'integer', minimum: 2, maximum: 20, multipleOf: 2 } }, required: ['siteIds', 'utcDate'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, async execute(input) {
    if (!input || Object.keys(input).some(k => !['siteIds', 'utcDate', 'camera', 'heightM'].includes(k))) throw new Error('Unknown parameters.');
    if (!Array.isArray(input.siteIds) || input.siteIds.length < 1 || input.siteIds.length > 3 || new Set(input.siteIds).size !== input.siteIds.length || input.siteIds.some(id => !sites.find(s => s.id === id))) throw new Error('Select one to three distinct, valid sites.');
    const d = new Date(input.utcDate); if (typeof input.utcDate !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(input.utcDate) || !validDate(d)) throw new Error('Invalid UTC date or outside 2000–2050.');
    if (input.camera && !['terrain', 'surface', 'globe'].includes(input.camera)) throw new Error('Invalid camera.');
    if (input.heightM !== undefined && (!Number.isInteger(input.heightM) || input.heightM < 2 || input.heightM > 20 || input.heightM % 2)) throw new Error('Height must be even, from 2 to 20 m.');
    cancelRitual(); stopPlayback(); message(''); state.selected = [...input.siteIds]; state.primary = state.selected[0]; state.date = d;
    if (input.heightM !== undefined) { state.heightM = input.heightM; $('#height').value = state.heightM; }
    await ensureTerrains(state.selected); renderSites(); setView(input.camera || state.view); await new Promise(requestAnimationFrame); return readVisibility();
  } });
  register({ name: 'read_lunar_visibility', title: 'Read lunar visibility', description: 'Reads elevations, margins over the LOLA horizon and irradiance at the selected sites.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: readVisibility });
}

restored = restore();
$('#height').value = state.heightM; $(`[name=panel][value=${state.panel}]`).checked = true;
renderSites(); $$('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));

async function init() {
  try {
    if (!astronomy) throw new Error(t('error.ephemeris'));
    const response = await fetch(data('./data/metadata.json')); if (!response.ok) throw new Error(t('error.data', { name: 'LOLA' }));
    metadata = await response.json();
    await ensureTerrains([...new Set([state.primary, ...state.selected])]);
    ready = true; $('#missionButton').disabled = false;
    try { scene = new LunarScene($('#sceneCanvas'), $('#sceneBox'), sites, text => message(text, true), { t }); }
    catch (error) { message(t('msg.webgl'), true); $('#sceneLoading').innerHTML = `<b>${t('loading.webglTitle')}</b><span>${t('loading.webglSub')}</span>`; console.warn(error); }
    scene?.setView(state.view);
    if (restored) render(); else await openingRitual();
    if (scene) { $('#sceneLoading').classList.add('hidden'); requestAnimationFrame(() => $('#sceneViewport').classList.add('ready')); }
    registerWebMCP();
    ensureTerrains(sites.map(s => s.id)).catch(() => { /* other sites load on demand */ });
  } catch (error) {
    message(error.message, true); $('#sceneLoading').innerHTML = `<b>${t('loading.failTitle')}</b><span>${t('loading.failSub')}</span>`; console.error(error);
  }
}
init();
