import { t, getLang, addDictionary, bindLanguageSwitch, onLangChange, number } from './i18n.js';
import { sites } from './sites.js';

addDictionary({
  pt: {
    'l.title': 'Horisite · Pouse onde a luz dura',
    'l.nav.how': 'Como funciona', 'l.nav.science': 'O que mostra', 'l.nav.who': 'Para quem',
    'l.hero.a': 'Pouse onde a ', 'l.hero.b': 'luz', 'l.hero.c': ' dura.',
    'l.hero.lead': 'O Horisite é um explorador gratuito do polo sul da Lua. Escolha um lugar e uma data e veja, no relevo real, se há luz do Sol para gerar energia e a Terra no céu para falar com casa.',
    'l.cta.open': 'Abrir no navegador', 'l.cta.how': 'Ver como funciona',
    'l.hero.proof': 'Relevo LOLA de 20 m da NASA · posições conferidas contra o JPL Horizons',
    'l.live.where': 'Agora na borda de Shackleton', 'l.live.sunOn': 'Ao sol', 'l.live.sunOff': 'Na sombra', 'l.live.earthOn': 'Terra à vista', 'l.live.earthOff': 'Terra escondida',
    'l.badge': 'POLO SUL LUNAR · 89,66° S ·',
    'l.s1': 'regiões de referência no polo sul', 'l.s2.n': '30 dias', 'l.s2': 'de busca pela melhor janela', 'l.s3.n': '0,0024°', 'l.s3': 'maior diferença para o JPL Horizons no caso de referência',
    'l.s4.n': '~130 m', 'l.s4': 'entre pontos do relevo 3D, do modelo LOLA de 20 m', 'l.s5': 'etapas da missão, no perfil das Apollo',
    'l.why.a': 'No polo sul, ', 'l.why.b': 'cada metro', 'l.why.c': ' de relevo conta.',
    'l.why.p': 'Ali o Sol passa rente ao horizonte e a Terra quase não sai do lugar no céu. Uma crista a 20 km pode apagar um painel solar ou cortar a visada para casa; meio quilômetro para o lado pode devolver as duas.',
    'l.c1.t': 'Vai ter energia?', 'l.c1.p': 'A altura do Sol sobre o relevo de verdade e a luz que chega num painel, em W/m².',
    'l.c2.t': 'Dá para falar com a Terra?', 'l.c2.p': 'Se o centro da Terra está acima do horizonte do local, e com quantos graus de folga.',
    'l.c3.t': 'Por quanto tempo?', 'l.c3.p': 'O maior trecho contínuo com Sol e Terra juntos nos próximos 30 dias.',
    'l.f.t': 'Tudo para comparar luz e visada em cinco regiões.', 'l.f.p': 'Escolha até três locais, mude o momento e leia a resposta na própria cena 3D: raios até o Sol e a Terra mostram onde o relevo bloqueia.',
    'l.f1.t': 'Relevo real em 3D', 'l.f1.p': 'Recortes de 100 km do modelo LOLA do polo sul, com 400 km de contexto até o horizonte.',
    'l.f2.t': 'Luz do Sol e da Terra', 'l.f2.p': 'Altura no céu, relevo em cada direção e folga, hora a hora.',
    'l.f3.t': 'Melhor janela e missão', 'l.f3.p': 'O maior intervalo comum em 30 dias, e a missão até ele como nas Apollo: Saturn V, pouso, decolagem e amerissagem.',
    'l.f.alt': 'O app do Horisite: relevo 3D da borda de Shackleton com os raios até o Sol e a Terra, e o painel de resposta.',
    'l.sci.a': 'Ciência que dá para ', 'l.sci.b': 'ver', 'l.sci.c': '.',
    'l.b1.t': 'O polo sul real, em 3D, na escala real.', 'l.b1.p': 'Escala vertical 1× · curvatura lunar · sombras do Sol',
    'l.b2.p': 'maior janela comum entre Shackleton e Malapert a partir de 2 de outubro de 2026, em amostras de 1 hora.',
    'l.b3.t': 'O que o relevo esconde', 'l.b3.p': 'Silhueta real em volta da borda de Shackleton e o caminho do Sol nas próximas 24 horas, calculados agora.',
    'l.b4': 'Sol à vista, a cena acende.', 'l.b5': 'Crista no caminho, fica escuro.',
    'l.b6.p': 'maior diferença no caso de referência: Shackleton, 2 de outubro de 2026.',
    'l.b7.t': 'A Terra vista do polo sul, agora.', 'l.b7.p': 'Na lente do app, com a fase real do instante e as luzes das cidades no lado da noite.',
    'l.st.a': 'De um lugar a uma resposta em ', 'l.st.b': 'quatro passos', 'l.st.c': '.',
    'l.st1.t': 'Escolha os locais', 'l.st1.p': 'Marque até três das cinco regiões de referência do polo sul.',
    'l.st2.t': 'Escolha o momento', 'l.st2.p': 'Data e hora UTC, com a barra de 24 horas e a passagem do tempo.',
    'l.st3.t': 'Leia a resposta', 'l.st3.p': 'Raios, caminho do Sol e da Terra e a folga sobre o relevo, na cena.',
    'l.st4.t': 'Ache a janela', 'l.st4.p': 'O maior trecho com Sol e Terra juntos, e a missão até ele.',
    'l.who.a': 'Feito para quem quer ', 'l.who.b': 'entender', 'l.who.c': ' a Lua.',
    'l.w1.l': 'Estudantes e professores', 'l.w1.t': 'Uma aula que dá para girar.', 'l.w1.p': 'Abra o relevo, mude a data e veja a sombra andar. O tutorial traz exemplos que dá para reproduzir.',
    'l.w2.l': 'Entusiastas do espaço', 'l.w2.t': 'Vá aonde as missões querem ir.', 'l.w2.p': 'As cinco regiões ficam na área do polo sul que a NASA estuda para os pousos da Artemis.',
    'l.w3.l': 'Planejamento inicial', 'l.w3.t': 'Uma primeira olhada rápida.', 'l.w3.p': 'Compare luz e visada em minutos, antes de partir para análises de missão mais finas.',
    'l.link.t': 'Abre com um link.', 'l.link.p': 'Roda no navegador do computador e do celular, sem cadastro e sem instalar nada.',
    'l.link.alt': 'O Horisite no celular.',
    'l.cta.t': 'Sua primeira missão ao polo sul começa agora.', 'l.cta.go': 'Explorar o polo sul',
    'l.fo.product': 'Produto', 'l.fo.data': 'Dados', 'l.fo.open': 'Abrir', 'l.fo.method': 'Dados e método no app'
  },
  en: {
    'l.title': 'Horisite · Land where the light lasts',
    'l.nav.how': 'How it works', 'l.nav.science': 'What it shows', 'l.nav.who': 'Who it’s for',
    'l.hero.a': 'Land where the ', 'l.hero.b': 'light', 'l.hero.c': ' lasts.',
    'l.hero.lead': 'Horisite is a free explorer of the Moon’s south pole. Pick a place and a date and see, on the real terrain, whether there is sunlight for power and Earth in the sky to call home.',
    'l.cta.open': 'Open in your browser', 'l.cta.how': 'See how it works',
    'l.hero.proof': 'NASA 20 m LOLA relief · positions checked against JPL Horizons',
    'l.live.where': 'Right now at the Shackleton rim', 'l.live.sunOn': 'In sunlight', 'l.live.sunOff': 'In shadow', 'l.live.earthOn': 'Earth in view', 'l.live.earthOff': 'Earth hidden',
    'l.badge': 'LUNAR SOUTH POLE · 89.66° S ·',
    'l.s1': 'reference regions at the south pole', 'l.s2.n': '30 days', 'l.s2': 'searched for the best window', 'l.s3.n': '0.0024°', 'l.s3': 'largest difference from JPL Horizons in the reference case',
    'l.s4.n': '~130 m', 'l.s4': 'between 3D relief points, from the 20 m LOLA model', 'l.s5': 'mission phases, on the Apollo profile',
    'l.why.a': 'At the south pole, ', 'l.why.b': 'every metre', 'l.why.c': ' of terrain counts.',
    'l.why.p': 'There the Sun skims the horizon and Earth barely moves in the sky. A ridge 20 km away can switch off a solar panel or cut the line of sight home; half a kilometre aside can give both back.',
    'l.c1.t': 'Will there be power?', 'l.c1.p': 'The Sun’s height above the real relief and the light reaching a panel, in W/m².',
    'l.c2.t': 'Can we talk to Earth?', 'l.c2.p': 'Whether Earth’s centre is above the local horizon, and by how many degrees.',
    'l.c3.t': 'For how long?', 'l.c3.p': 'The longest continuous stretch with Sun and Earth together in the next 30 days.',
    'l.f.t': 'Everything to compare light and line of sight across five regions.', 'l.f.p': 'Choose up to three sites, change the moment and read the answer in the 3D scene itself: rays to the Sun and Earth show where the relief blocks them.',
    'l.f1.t': 'Real relief in 3D', 'l.f1.p': '100 km tiles of the LOLA south pole model, with 400 km of context out to the horizon.',
    'l.f2.t': 'Sunlight and Earth', 'l.f2.p': 'Height in the sky, relief in each direction and margin, hour by hour.',
    'l.f3.t': 'Best window and mission', 'l.f3.p': 'The longest common interval in 30 days, and the mission to it as on Apollo: Saturn V, landing, liftoff and splashdown.',
    'l.f.alt': 'The Horisite app: 3D relief of the Shackleton rim with rays to the Sun and Earth, and the answer panel.',
    'l.sci.a': 'Science you can ', 'l.sci.b': 'see', 'l.sci.c': '.',
    'l.b1.t': 'The real south pole, in 3D, at true scale.', 'l.b1.p': 'Vertical scale 1× · lunar curvature · sun shadows',
    'l.b2.p': 'longest common window for Shackleton and Malapert from 2 October 2026, in 1-hour samples.',
    'l.b3.t': 'What the relief hides', 'l.b3.p': 'The real silhouette around the Shackleton rim and the Sun’s path in the next 24 hours, computed now.',
    'l.b4': 'Sun in view, the scene lights up.', 'l.b5': 'Ridge in the way, it goes dark.',
    'l.b6.p': 'largest difference in the reference case: Shackleton, 2 October 2026.',
    'l.b7.t': 'Earth from the south pole, right now.', 'l.b7.p': 'Through the app’s lens, with its real phase at that moment and city lights on the night side.',
    'l.st.a': 'From a place to an answer in ', 'l.st.b': 'four steps', 'l.st.c': '.',
    'l.st1.t': 'Pick your sites', 'l.st1.p': 'Tick up to three of the five south pole reference regions.',
    'l.st2.t': 'Pick the moment', 'l.st2.p': 'UTC date and time, with the 24-hour bar and time playback.',
    'l.st3.t': 'Read the answer', 'l.st3.p': 'Rays, the Sun and Earth paths and the margin over the relief, in the scene.',
    'l.st4.t': 'Find the window', 'l.st4.p': 'The longest stretch with Sun and Earth together, and the mission to it.',
    'l.who.a': 'Made for people who want to ', 'l.who.b': 'understand', 'l.who.c': ' the Moon.',
    'l.w1.l': 'Students and teachers', 'l.w1.t': 'A lesson you can turn around.', 'l.w1.p': 'Open the relief, change the date and watch the shadow move. The tutorial has examples you can reproduce.',
    'l.w2.l': 'Space enthusiasts', 'l.w2.t': 'Go where missions want to go.', 'l.w2.p': 'All five regions lie in the south polar area NASA studies for Artemis landings.',
    'l.w3.l': 'Early planning', 'l.w3.t': 'A fast first pass.', 'l.w3.p': 'Compare light and line of sight in minutes, before moving on to finer mission analysis.',
    'l.link.t': 'Opens with a link.', 'l.link.p': 'Runs in the browser on computer and phone, with no sign-up and nothing to install.',
    'l.link.alt': 'Horisite on a phone.',
    'l.cta.t': 'Your first mission to the south pole starts now.', 'l.cta.go': 'Explore the south pole',
    'l.fo.product': 'Product', 'l.fo.data': 'Data', 'l.fo.open': 'Open', 'l.fo.method': 'Data & method in the app'
  }
});

const $ = s => document.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const data = path => new URL(path, import.meta.url);
let live = null, horizonValues = null, sunPath = null;

function renderLive() {
  if (!live) return;
  const set = (id, on, labelOn, labelOff, margin) => {
    const el = $(id); el.dataset.state = on ? 'visible' : 'blocked';
    el.querySelector('b').textContent = t(on ? labelOn : labelOff);
    el.querySelector('.val').textContent = t(margin >= 0 ? 'answer.above' : 'answer.below', { v: `${number(Math.abs(margin), 2)}°` });
  };
  set('#liveSun', live.sun.available, 'l.live.sunOn', 'l.live.sunOff', live.sun.margin);
  set('#liveEarth', live.earth.available, 'l.live.earthOn', 'l.live.earthOff', live.earth.margin);
}

function renderHorizon() {
  if (!horizonValues) return;
  const W = 560, H = 170, L = 6, R = 6, T = 10, B = 22;
  const els = [...horizonValues, ...sunPath.map(p => p.elevation)];
  const lower = Math.min(-4, Math.floor(Math.min(...els))), upper = Math.max(6, Math.ceil(Math.max(...els)) + 1);
  const x = az => L + az / 360 * (W - L - R), y = el => T + (upper - el) / (upper - lower) * (H - T - B);
  const land = Array.from(horizonValues, (h, i) => `${i ? 'L' : 'M'}${x(i / 2).toFixed(1)},${y(h).toFixed(1)}`).join(' ');
  let sun = '', prev = null;
  for (const p of sunPath) { sun += `${prev === null || Math.abs(p.azimuth - prev) > 180 ? 'M' : 'L'}${x(p.azimuth).toFixed(1)},${y(p.elevation).toFixed(1)} `; prev = p.azimuth; }
  const axis = [0, 90, 180, 270, 360].map(a => `<text x="${Math.min(W - 18, Math.max(2, x(a) - 8))}" y="${H - 6}" class="hz-axis">${a}°</text>`).join('');
  $('#liveHorizon').innerHTML = `<rect x="0" y="0" width="${W}" height="${H - B + 4}" rx="10" class="hz-sky"/><path d="${sun}" class="hz-sun"/><path d="${land} L${x(360)},${y(lower)} L${x(0)},${y(lower)} Z" class="hz-land"/>${axis}`;
}

function relabel() {
  document.title = t('l.title');
  $('#badgeText').textContent = t('l.badge');
  document.querySelectorAll('img[data-shot]').forEach(img => { img.src = `assets/landing/${getLang()}/${img.dataset.shot}.jpg`; });
  renderLive(); renderHorizon();
}

async function liveData() {
  const astronomy = window.Astronomy; if (!astronomy) return;
  const { Terrain, evaluate } = await import('./model.js');
  const metadata = await fetch(data('./data/metadata.json')).then(r => r.json());
  const site = sites.find(s => s.id === 'shackleton');
  const get = name => fetch(data(`./data/${name}`)).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  const [detail, wide, inner] = await Promise.all([get('shackleton.bin'), get('shackleton-wide.bin'), get('shackleton-inner.bin')]);
  const terrain = new Terrain(site, new Float32Array(detail), metadata, wide ? new Float32Array(wide) : null, inner ? new Float32Array(inner) : null);
  const now = new Date();
  live = evaluate(site, now, terrain, astronomy, 2, 'tracking');
  horizonValues = terrain.horizon(2);
  sunPath = Array.from({ length: 49 }, (_, i) => { const m = evaluate(site, new Date(+now + i * 18e5), terrain, astronomy, 2, 'tracking'); return { azimuth: m.sun.azimuth, elevation: m.sun.elevation }; });
  renderLive(); renderHorizon();
}

// The Moon in the hero: LROC colour, regolith shading, lit from the Sun's real direction now,
// seen from below the south pole with the five reference regions marked.
async function liveMoon() {
  const canvas = $('#moonCanvas'), astronomy = window.Astronomy;
  if (!canvas || !astronomy) return;
  const THREE = await import('three');
  const { lunarMaterial } = await import('./lunar-surface.js');
  const { ephemeris, siteBasis, unit } = await import('./model.js');
  const bodyToScene = a => new THREE.Vector3(a[0], a[2], -a[1]);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const texture = new THREE.TextureLoader().load(data('./assets/moon-color.jpg').href, () => draw());
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 120), lunarMaterial({ vertexColors: false, map: texture, color: 0xf2efe8 }));
  scene.add(moon);
  for (const site of sites) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    dot.position.copy(bodyToScene(siteBasis(site).up).multiplyScalar(1.004)); moon.add(dot);
  }
  const light = new THREE.DirectionalLight(0xfff4e0, 3.2); scene.add(light);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x000000, 0.06));
  const eph = ephemeris(new Date(), astronomy), sun = unit(eph.sun);
  light.position.copy(bodyToScene(sun).multiplyScalar(10));
  const subsolar = Math.atan2(sun[1], sun[0]);
  const setCamera = drift => {
    const lon = subsolar - 0.95 + drift;
    const dir = unit([Math.cos(lon) * 0.62, Math.sin(lon) * 0.62, -0.78]);
    camera.position.copy(bodyToScene(dir).multiplyScalar(4.6)); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0);
  };
  const resize = () => { const r = canvas.getBoundingClientRect(); if (!r.width) return; renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); };
  const draw = () => renderer.render(scene, camera);
  new ResizeObserver(() => { resize(); draw(); }).observe(canvas);
  resize(); setCamera(0); draw();
  canvas.parentElement.querySelector('.moon-fallback')?.remove();
  if (reduced) return;
  let visible = true;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(canvas);
  const t0 = performance.now();
  const loop = now => { if (visible && !document.hidden) { setCamera(((now - t0) / 1000) * 0.012); draw(); } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

bindLanguageSwitch();
onLangChange(relabel);
relabel();
const start = () => { liveMoon().catch(e => console.warn('moon', e)); liveData().catch(e => console.warn('live', e)); };
if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
