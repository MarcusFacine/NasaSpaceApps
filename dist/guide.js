// First-visit guide. A spotlight on the real control and a short card beside it, one step at a time. It opens once,
// after the opening ritual (the choice is saved in the browser), can be skipped at any moment, and comes back from the
// "Guide" button in the bar or with ?guia=1 / ?guide=1. It never blocks the app: the dimmed page stays clickable.
const KEY = 'horisite-guide-v1';
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sheet = () => matchMedia('(max-width: 720px)').matches;
// Inline marks inside the step text: the real icons and colour swatches of the interface.
const MARKS = {
  plus: '<svg class="guide-ico" aria-hidden="true"><use href="#i-plus"/></svg>',
  check: '<svg class="guide-ico" aria-hidden="true"><use href="#i-check"/></svg>',
  chevron: '<svg class="guide-ico guide-chevron" aria-hidden="true"><use href="#i-chevron"/></svg>',
  sun: '<i class="guide-swatch sun" aria-hidden="true"></i>',
  earth: '<i class="guide-swatch earth" aria-hidden="true"></i>',
};
let sessionSeen = false;
function seen() { try { return localStorage.getItem(KEY) === 'done'; } catch { return sessionSeen; } }
function markSeen() { sessionSeen = true; try { localStorage.setItem(KEY, 'done'); } catch { /* storage optional: once per session */ } }
const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };

/**
 * steps: [{ id, targets: () => Element[], title: key, body: key | () => key, prepare?: () => void }]
 * canStart: () => boolean (scene ready, opening ritual over, no dialog open).
 */
export function createGuide({ steps, t, onLangChange, button, canStart }) {
  const root = document.createElement('div'); root.className = 'guide'; root.hidden = true;
  root.innerHTML = `<div class="guide-spot" aria-hidden="true"></div>
    <section class="guide-card" role="dialog" aria-modal="false" aria-labelledby="guideTitle" aria-describedby="guideBody" tabindex="-1">
      <div class="guide-text" aria-live="polite"><h2 id="guideTitle"></h2><p id="guideBody"></p></div>
      <div class="guide-actions">
        <button type="button" class="guide-skip link-button"></button>
        <span class="guide-count num" id="guideCount"></span>
        <button type="button" class="btn btn-ghost guide-prev"></button>
        <button type="button" class="btn btn-primary guide-next"></button>
      </div>
    </section>`;
  document.body.append(root);
  const spot = root.querySelector('.guide-spot'), card = root.querySelector('.guide-card');
  const title = root.querySelector('#guideTitle'), body = root.querySelector('#guideBody'), count = root.querySelector('#guideCount');
  const skip = root.querySelector('.guide-skip'), prev = root.querySelector('.guide-prev'), next = root.querySelector('.guide-next');
  let index = -1, frame = 0, returnFocus = null, last = '';

  function labels() {
    skip.textContent = t('guide.skip'); prev.textContent = t('guide.prev');
    next.textContent = t(index === steps.length - 1 ? 'guide.done' : 'guide.next');
    card.setAttribute('aria-roledescription', t('guide.role'));
  }
  function text() {
    const step = steps[index]; if (!step) return;
    title.textContent = t(step.title);
    const key = typeof step.body === 'function' ? step.body() : step.body;
    // Step text is our own dictionary; only the {marks} become markup (t() fills them with tokens first).
    const tokens = Object.fromEntries(Object.keys(MARKS).map(k => [k, `[[${k}]]`]));
    body.innerHTML = t(key, tokens).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/\[\[(\w+)\]\]/g, (m, k) => MARKS[k] ?? '');
    count.textContent = t('guide.count', { n: index + 1, total: steps.length });
    prev.hidden = index === 0; labels();
  }
  // The union of the step's visible targets, in viewport pixels.
  function area() {
    const els = steps[index].targets().filter(visible); if (!els.length) return null;
    const rs = els.map(el => el.getBoundingClientRect());
    return { left: Math.min(...rs.map(r => r.left)), top: Math.min(...rs.map(r => r.top)), right: Math.max(...rs.map(r => r.right)), bottom: Math.max(...rs.map(r => r.bottom)), first: els[0] };
  }
  // Bring the target into view, above the bottom sheet on phones (inner scroll boxes first, then the page).
  function reveal() {
    const a = area(); if (!a) return;
    a.first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const b = area(), H = innerHeight, floor = sheet() ? H - card.offsetHeight - 28 : H - 16;
    if (b.top < 12 || b.bottom > floor) {
      const room = floor - 12, h = b.bottom - b.top;
      window.scrollBy(0, h > room ? b.top - 12 : (b.top + b.bottom) / 2 - (12 + floor) / 2);
    }
  }
  function place() {
    if (index < 0) return;
    const a = area(), W = innerWidth, H = innerHeight, pad = 7, m = 14, gap = 14;
    const key = a ? [a.left, a.top, a.right, a.bottom].map(Math.round).join(',') + `|${W}x${H}|${card.offsetHeight}` : `none|${W}x${H}`;
    if (key === last) return; last = key;
    if (!a) { spot.style.opacity = '0'; }
    else {
      const w = a.right - a.left + 2 * pad, h = a.bottom - a.top + 2 * pad;
      Object.assign(spot.style, { opacity: '1', left: `${a.left - pad}px`, top: `${a.top - pad}px`, width: `${w}px`, height: `${h}px`, borderRadius: `${Math.min(22, h / 2)}px` });
    }
    if (sheet()) { card.style.left = card.style.top = ''; return; }
    const cw = card.offsetWidth, ch = card.offsetHeight;
    if (!a) { card.style.left = `${(W - cw) / 2}px`; card.style.top = `${Math.max(m, (H - ch) / 2)}px`; return; }
    const r = { left: a.left - pad, top: a.top - pad, right: a.right + pad, bottom: a.bottom + pad };
    const clampX = x => Math.min(Math.max(m, x), W - cw - m), clampY = y => Math.min(Math.max(m, y), H - ch - m);
    const sides = {
      below: [clampX(r.left), r.bottom + gap, r.bottom + gap + ch <= H - m],
      above: [clampX(r.left), r.top - gap - ch, r.top - gap - ch >= m],
      right: [r.right + gap, clampY(r.top), r.right + gap + cw <= W - m],
      left: [r.left - gap - cw, clampY(r.top), r.left - gap - cw >= m],
    };
    // Wide targets (bars, rows) take the card above or below; narrow ones beside, where the eye already is.
    const order = r.right - r.left > cw ? ['below', 'above', 'left', 'right'] : ['right', 'left', 'below', 'above'];
    const pick = order.find(s => sides[s][2]);
    const [x, y] = pick ? sides[pick] : [clampX(r.left), clampY(H - ch - m)];
    card.style.left = `${x}px`; card.style.top = `${y}px`;
  }
  // While open, follow the target: panels re-render, the page scrolls, the window resizes.
  function loop() {
    if (index < 0) return;
    if (document.querySelector('dialog[open]')) { close(true); return; }
    place(); frame = requestAnimationFrame(loop);
  }
  function go(i) {
    if (i < 0 || i >= steps.length) return;
    index = i; last = ''; steps[i].prepare?.(); text();
    root.classList.toggle('instant', reducedMotion());
    requestAnimationFrame(() => { reveal(); last = ''; place(); });
  }
  function start() {
    if (index >= 0) { go(0); return; }
    returnFocus = document.activeElement; root.hidden = false;
    go(0); cancelAnimationFrame(frame); frame = requestAnimationFrame(loop);
    // Focus goes to the card (read aloud as a dialog); Enter or the arrows move on, Tab reaches the buttons.
    requestAnimationFrame(() => card.focus({ preventScroll: true }));
  }
  function close(done = true) {
    if (index < 0) return;
    index = -1; cancelAnimationFrame(frame); root.hidden = true;
    if (done) markSeen();
    const back = returnFocus && document.contains(returnFocus) && returnFocus !== document.body ? returnFocus : button;
    if (!document.querySelector('dialog[open]')) back?.focus?.({ preventScroll: true });
  }
  next.addEventListener('click', () => (index === steps.length - 1 ? close(true) : go(index + 1)));
  prev.addEventListener('click', () => go(index - 1));
  skip.addEventListener('click', () => close(true));
  document.addEventListener('keydown', e => {
    if (index < 0 || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    // Arrows only inside the card: outside it they keep driving the 3D scene.
    if (!card.contains(document.activeElement)) return;
    if (e.key === 'ArrowRight' || (e.key === 'Enter' && document.activeElement === card)) { e.preventDefault(); if (index < steps.length - 1) go(index + 1); else if (e.key === 'Enter') close(true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
  });
  onLangChange(() => { if (index >= 0) { text(); last = ''; } });
  button?.addEventListener('click', () => start());

  // First visit (or ?guia=1): wait for the scene and the opening ritual, then a beat for the window card's pulse.
  function maybeStart() {
    const params = new URLSearchParams(location.search), forced = ['guia', 'guide'].some(k => params.get(k) === '1');
    if (!forced && seen()) return;
    const waitStart = performance.now();
    const tick = () => {
      if (index >= 0) return;
      if (!canStart()) { if (performance.now() - waitStart < 60000) setTimeout(tick, 250); return; }
      setTimeout(() => { if (index < 0 && canStart()) start(); }, 1200);
    };
    tick();
  }
  return { start, close, maybeStart, get open() { return index >= 0; } };
}
