// Poden+ web — app shell. One delegated click handler, one animation-frame tick for everything live,
// and pages that render once per navigation (never while audio plays).
import * as M from './model.js';
import * as A from './analyzer.js';
import * as PL from './player.js';
import { P } from './player.js';
import * as V from './views.js';
import { nav, route } from './views.js';
import * as TR from './transcript.js';
import { icon, skipIcon } from './icons.js';
import { $, esc, fmt, long, short, cover, iconBtn, marquee, fitMarquees, menu, toast, Scrubber, readColors, rateStr } from './ui.js';
import { ls } from './store.js';
const { lib, settings } = M;
window.__seek = t => PL.seek(t); window.__toggle = () => PL.toggle();

// ---------- shell ----------
const app = $('#app'), main = $('#main'), bar = $('#bar'), np = $('#np'), mini = $('#mini'), top = $('#top'), tabbar = $('#tabbar');
const phone = matchMedia('(max-width:760px)');

function renderTop() {
  const r = route();
  top.innerHTML = `${iconBtn('chevL', 'Back', 'back-nav', { attrs: r ? '' : 'style="visibility:hidden"' })}<span class="spacer"></span>${lib.busy ? '<span class="spinner" aria-label="Refreshing"></span>' : ''}
    <nav class="tabs desk glass" aria-label="Sections">${V.TABS.map(([id, t, sym], i) => `<button class="icon-btn press ${nav.tab === id && !r ? 'active' : ''}" data-act="tab" data-tab="${id}" title="${t} (${i + 1})" aria-label="${t}">${icon(sym, 15)}${id === 'upNext' && lib.upNext.length ? `<span class="badge">${lib.upNext.length}</span>` : ''}${id === 'downloads' && A.an.progress.size ? '<span class="dot"></span>' : ''}</button>`).join('')}
    <span class="sep"></span>${iconBtn('gear', 'Settings', 'settings', { size: 15, active: r?.type === 'settings' })}${fsButton()}</nav>
    <span class="row g6 mobile-only">${iconBtn('gear', 'Settings', 'settings', { size: 17, active: r?.type === 'settings', cls: 'phone-gear' })}${fsButton()}</span>`;
  tabbar.innerHTML = V.TABS.map(([id, t, sym]) => `<button class="press ${nav.tab === id && !r ? 'on' : ''}" data-act="tab" data-tab="${id}" aria-label="${t}">${icon(sym, 22)}<span>${t}</span>${id === 'upNext' && lib.upNext.length ? `<span class="badge">${lib.upNext.length}</span>` : ''}</button>`).join('');
}
const fsSupported = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
function fsButton() {
  if (V.isStandalone()) return '';
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
  return iconBtn(on ? 'shrink' : 'expand', on ? 'Exit full screen' : 'Full screen (app mode)', 'fullscreen', { size: 15 });
}

let pageKey = '';
function renderPage(keepScroll) {
  const y = main.scrollTop;
  main.innerHTML = V.renderPage();
  pageKey = JSON.stringify([nav.tab, nav.path.map(r => r.type + (r.id || r.ep?.id || ''))]);
  const r = route();
  main.classList.toggle('trpage', r?.type === 'transcript');
  main.style.overflowY = r?.type === 'transcript' ? 'hidden' : '';
  if (r?.type === 'transcript') main.firstElementChild.style.height = `calc(100% - ${phone.matches ? 150 : 110}px)`;
  hydrate(main);
  if (keepScroll) main.scrollTop = y; else main.scrollTop = 0;
  if (nav.tab === 'search' && !r) { const q = $('#q'); if (!phone.matches && document.activeElement !== q) q?.focus({ preventScroll: true }); V.renderTranscriptHits(nav.query); }
  renderTop();
}
// Mount live widgets inside freshly rendered HTML.
function hydrate(root) {
  for (const el of root.querySelectorAll('[data-scrub]')) scrubbers.add(new Scrubber(el, +el.dataset.scrub));
  for (const el of root.querySelectorAll('[data-tr]')) { const e = lib.byId.get(el.dataset.tr) || route()?.ep || P.episode; if (e) TR.mount(el, e); }
  for (const el of root.querySelectorAll('[data-chapters]')) { const e = lib.byId.get(el.dataset.chapters) || route()?.ep || P.episode; if (e) TR.mountChapters(el, e); }
  for (const el of root.querySelectorAll('[data-vlist]')) virtualList(el, V.lists.get(el.dataset.vlist) || [], el.dataset.vlist);
  fitMarquees(root);
  live(true);
}
// Long episode lists (900+ episodes) render in slices as you scroll — first paint stays instant.
function virtualList(el, eps, key) {
  let n = 0;
  const add = k => { const end = Math.min(eps.length, n + k); el.insertAdjacentHTML('beforeend', eps.slice(n, end).map(e => V.epRow(e, key)).join('')); n = end; };
  add(60);
  if (n < eps.length) {
    const s = document.createElement('div'); s.style.height = '1px'; el.after(s);
    const io = new IntersectionObserver(en => { if (en[0].isIntersecting) { add(120); if (n >= eps.length) { io.disconnect(); s.remove(); } } }, { root: main, rootMargin: '1500px' });
    io.observe(s);
  }
}

// ---------- navigation ----------
function go(tab) { closeNP(); nav.tab = tab; nav.path = []; history.pushState({ nav: 1 }, ''); renderPage(); }
function open(r) { closeNP(); const last = route(); if (last && last.type === r.type && (last.id || last.ep?.id) === (r.id || r.ep?.id)) return; nav.path.push(r); history.pushState({ nav: 1 }, ''); renderPage(); }
function openShow(id) { closeNP(); nav.tab = 'library'; nav.path = [{ type: 'show', id }]; history.pushState({ nav: 1 }, ''); renderPage(); }
function back() { if (nav.nowPlaying) { closeNP(); return; } if (nav.path.length) { nav.path.pop(); renderPage(); } }
addEventListener('popstate', () => { if (document.getElementById('menu')) { import('./ui.js').then(u => u.closeMenu()); return; } back(); });

// ---------- player bar ----------
function renderBar() {
  const e = P.episode;
  bar.classList.toggle('hidden', !e || nav.nowPlaying || (nav.mini && !phone.matches));
  if (!e) return;
  bar.innerHTML = `<div class="np"><button class="press" data-act="open-np" aria-label="Now playing: ${esc(e.title)}. Opens the full player">${cover(e.artworkURL)}</button>
      <div class="grow stack" style="gap:2px;min-width:0"><button class="press" data-act="open-np" style="text-align:left;min-width:0" tabindex="-1">${marquee(e.title, 'bold callout')}</button><div data-sub></div></div></div>
    <div class="mid"><div class="transport" data-transport="bar"></div><div class="scrow"><span data-t="now" style="text-align:right">0:00</span><div data-scrub="10" style="flex:1"></div><span data-t="rem">−0:00</span></div></div>
    <div class="right"><span class="keep phone-play" data-transport="phone"></span><span data-speed></span><span data-sleep-btn></span>${V.modeChips()}${V.volume(70)}</div>
    <div class="mbscrub"><i></i></div>`;
  hydrate(bar); liveBar(true);
}
function liveBar(full) {
  if (!P.episode || bar.classList.contains('hidden')) return;
  const q = s => bar.querySelector(s);
  if (full) {
    q('[data-transport=bar]').innerHTML = V.transport(false);
    q('[data-transport=phone]').innerHTML = `<button class="playbtn press" data-act="toggle" aria-label="${P.isPlaying ? 'Pause' : 'Play'}" style="width:40px;height:40px">${icon(P.isPlaying ? 'pause' : 'play', 16)}</button><button class="icon-btn press" data-act="fwd" aria-label="Forward ${settings.skipForward} seconds">${skipIcon(true, settings.skipForward, 24)}</button>`;
    q('[data-speed]').innerHTML = V.speedBtn(); q('[data-sleep-btn]').innerHTML = V.sleepBtn();
    const m = q('.modes'); if (m) m.outerHTML = V.modeChips();
    subline(q('[data-sub]'));
  }
  q('[data-t=now]').textContent = fmt(P.dragTime ?? P.time);
  q('[data-t=rem]').textContent = '−' + fmt(PL.remainingReal());
  q('.mbscrub i').style.width = (P.duration > 0 ? Math.min(100, (P.dragTime ?? P.time) / P.duration * 100) : 0) + '%';
}
function subline(el) {
  if (!el) return;
  const e = P.episode, s = P.suggestion;
  if (s) el.innerHTML = `<span class="notice"><span class="nowrap">${M.noun(s.kind)[0].toUpperCase() + M.noun(s.kind).slice(1)} playing</span><button class="nb press" data-act="accept">Skip ${Math.round(Math.max(0, s.end - P.time))}s</button><button class="keep press" data-act="dismiss">Keep</button></span>`;
  else if (P.notice) el.innerHTML = `<span class="notice"><span class="nowrap">${esc(P.notice)}</span>${P.lastSkip ? '<button class="nb press" data-act="undo">Undo</button>' : ''}</span>`;
  else { const st = e && A.an.status.get(e.id); el.innerHTML = st ? `<span class="status">${esc(st)}</span>` : el.closest('.pnl') ? `<span class="status">${esc(chapterTitle() || ' ')}</span>` : ''; }
}
const chapterTitle = () => { const e = P.episode; if (!e) return ''; const l = A.chapters(e), i = A.currentChapter(l, P.dragTime ?? P.time); return i != null ? l[i].title : ''; };

// ---------- now playing ----------
function openNP() { if (!P.episode) return; nav.nowPlaying = true; renderNP(); np.classList.add('open'); np.setAttribute('aria-hidden', 'false'); renderBar(); history.pushState({ np: 1 }, ''); }
function closeNP() { if (!nav.nowPlaying) return; nav.nowPlaying = false; np.classList.remove('open'); np.setAttribute('aria-hidden', 'true'); renderBar(); setTimeout(() => { if (!nav.nowPlaying) np.innerHTML = ''; }, 450); }
function renderNP() {
  const e = P.episode; if (!e || !nav.nowPlaying) return;
  const wide = innerWidth >= 900, big = wide ? Math.min(320, Math.max(160, innerHeight - 580)) : Math.min(innerWidth - 104, Math.max(110, innerHeight * 0.26));
  np.innerHTML = `<div class="nptop">${iconBtn('chevD', 'Close player', 'close-np', { cls: 'glass glassbtn' })}<span class="spacer" style="flex:1"></span>${iconBtn('ellipsis', 'More', 'np-menu', { cls: 'glass glassbtn' })}${iconBtn('pip', 'Mini player', 'mini', { cls: 'glass glassbtn minibtn' })}</div>
    <div class="npbody"><div class="npleft fade-y">${V.panel(e, Math.round(big))}</div><div class="npright">${V.npTabs()}<div data-npview style="flex:1;min-height:0;display:flex;flex-direction:column"></div></div></div>`;
  hydrate(np); npView(); liveNP(true);
}
function npView() {
  const el = np.querySelector('[data-npview]'); if (!el || !P.episode) return;
  el.innerHTML = settings.npTab === 'chapters' ? `<div class="chapters fade-y" data-chapters="${esc(P.episode.id)}" data-scrolls="1" style="overflow:auto;flex:1;padding:12px 0"></div>` : `<div class="tr fade-y" data-tr="${esc(P.episode.id)}" data-size="${settings.transcriptSize}"></div>`;
  np.querySelector('[data-trtools]').innerHTML = settings.npTab === 'transcript' ? V.transcriptTools() : '';
  hydrate(el);
}
function liveNP(full) {
  for (const root of [np, mini]) {
    if (root === np && !nav.nowPlaying) continue;
    if (root === mini && !nav.mini) continue;
    const q = s => root.querySelector(s);
    if (full) {
      const t = q('[data-transport=full]'); if (t) t.innerHTML = V.transport(root === np && innerWidth >= 900 ? 'large' : true);
      const sr = q('[data-secrow]'); if (sr) sr.innerHTML = `${V.speedBtn()}${V.sleepBtn()}${V.modeChips()}<span class="spacer" style="flex:1"></span>${V.volume(root === mini ? 80 : innerWidth < 900 ? 70 : 110)}`;
      const d = q('[data-detected]'); if (d && P.episode) d.innerHTML = V.detected(P.episode);
      q('[data-npcover]')?.classList.toggle('paused', !P.isPlaying);
      subline(q('[data-sub]'));
    }
    for (const ti of root.querySelectorAll('[data-times]')) timeRow(ti, ti.dataset.times === 'info');
  }
}
function timeRow(el, info) {
  const now = P.dragTime ?? P.time;
  let mid = '';
  if (info) {
    const parts = [P.duration > 0 && (P.rate !== 1 || PL.durationReal() < P.duration - 1) ? `${long(PL.durationReal())} at ${rateStr(P.rate)}` : null, P.silenceSaved >= 1 ? `${short(P.silenceSaved)} silence skipped` : null].filter(Boolean);
    mid = parts.join(' · ');
  }
  const html = `<span>${fmt(now)}</span><span class="mid">${esc(mid)}</span><span>−${fmt(PL.remainingReal())}</span>`;
  if (el.__h !== html) { el.__h = html; el.innerHTML = html; }
}

// ---------- mini player (desktop floating card; on phones the bar + OS media controls are the mini player) ----------
function openMini() { if (phone.matches) { closeNP(); return; } nav.mini = true; closeNP(); renderMini(); mini.classList.remove('hidden'); renderBar(); }
function closeMini() { nav.mini = false; mini.classList.add('hidden'); mini.innerHTML = ''; renderBar(); }
function renderMini() {
  const e = P.episode; if (!nav.mini) return;
  if (!e) { mini.innerHTML = V.panel ? `<div class="empty">${icon('headphones', 30)}<h3>Nothing playing</h3><p>Pick an episode in Poden+.</p></div>` : ''; return; }
  const pos = ls.get('miniPos', null); if (pos) { mini.style.left = pos.x + 'px'; mini.style.top = pos.y + 'px'; mini.style.right = 'auto'; mini.style.bottom = 'auto'; }
  mini.innerHTML = `<div class="mh" data-drag>${cover(e.artworkURL)}<div class="grow stack" style="gap:3px;min-width:0">${marquee(e.title, 'bold')}<div data-sub></div></div>${iconBtn('ellipsis', 'More', 'mini-menu', { cls: 'glass', attrs: 'style="border-radius:50%;width:28px;height:28px"' })}</div>
    <div class="mp"><div data-scrub="12"></div><div class="times" data-times="plain"></div></div>
    <div class="transport" data-transport="full" style="margin-top:8px"></div>
    <div class="mt" data-secrow></div>
    <div data-detected="${esc(e.id)}" style="padding:6px 16px 0"></div>
    <div class="mv"><div class="row" style="justify-content:space-between">${V.npTabs().replace('np-tab', 'mini-tab').replace(/data-v="(\w+)"/g, 'data-v="$1"')}</div><div data-miniview style="flex:1;min-height:0;display:flex;flex-direction:column"></div></div>`;
  // mini's own tab state
  const segEl = mini.querySelector('.seg'); if (segEl) segEl.outerHTML = `<div class="seg">${['chapters', 'transcript'].map(v => `<button class="press ${settings.miniTab === v ? 'on' : ''}" data-act="mini-tab" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>`;
  mini.querySelector('[data-trtools]').innerHTML = settings.miniTab === 'transcript' ? V.transcriptTools() : '';
  const view = mini.querySelector('[data-miniview]');
  view.innerHTML = settings.miniTab === 'chapters' ? `<div class="chapters fade-y" data-chapters="${esc(e.id)}" data-scrolls="1"></div>` : `<div class="tr fade-y" data-tr="${esc(e.id)}" data-size="${Math.max(13, settings.transcriptSize - 3)}" data-fixed="1"></div>`;
  hydrate(mini); liveNP(true);
  dragMini();
}
function dragMini() {
  const h = mini.querySelector('[data-drag]'); if (!h) return;
  h.onpointerdown = ev => {
    if (ev.target.closest('button')) return;
    const r = mini.getBoundingClientRect(), ox = ev.clientX - r.left, oy = ev.clientY - r.top; h.setPointerCapture(ev.pointerId);
    h.onpointermove = m => { const x = Math.min(innerWidth - r.width - 8, Math.max(8, m.clientX - ox)), y = Math.min(innerHeight - 80, Math.max(8, m.clientY - oy)); Object.assign(mini.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' }); };
    h.onpointerup = () => { h.onpointermove = null; const b = mini.getBoundingClientRect(); ls.set('miniPos', { x: b.left, y: b.top }); };
  };
}

// ---------- live updates: one rAF loop, only while something moves ----------
const scrubbers = new Set();
let lastSec = -1, lastSleep = '', running = false;
function live(force) {
  for (const s of scrubbers) if (!s.draw(force)) scrubbers.delete(s);
  liveBar(false); liveNP(false); TR.tick(); TR.tickChapters();
  const sec = Math.floor(P.time);
  if (sec !== lastSec) {
    lastSec = sec;
    const sl = document.querySelectorAll('[data-sleep]'), r = PL.sleepRemaining(); if (r != null) sl.forEach(x => x.textContent = Math.ceil(r / 60) + 'm');
    if (P.suggestion) document.querySelectorAll('.notice .nb[data-act=accept]').forEach(b => b.textContent = `Skip ${Math.round(Math.max(0, P.suggestion.end - P.time))}s`);
    const chs = document.querySelectorAll('.pnl [data-sub] .status'); if (chs.length && !P.notice && !P.suggestion && !A.an.status.get(P.episode?.id)) { const t = chapterTitle() || ' '; chs.forEach(c => { if (c.textContent !== t) c.textContent = t; }); }
    const inChips = document.querySelectorAll('.chips button[data-s]'); inChips.forEach(b => { const s = +b.dataset.s, seg = PL.sections(b.dataset.k).find(x => x.start === s); b.classList.toggle('in', !!seg && P.time >= seg.start && P.time < seg.end); });
  }
}
function loop() { if (document.hidden) { running = false; return; } live(false); if (P.isPlaying || P.dragTime != null) requestAnimationFrame(loop); else running = false; }
function kick() { if (!running && !document.hidden) { running = true; requestAnimationFrame(loop); } }
window.__tick = () => { kick(); live(false); };

// ---------- marks for scrubbers ----------
function updateMarks() {
  const d = P.duration, out = [];
  if (d > 0) for (const k of ['music', 'trailer', 'ad']) for (const s of PL.sections(k)) { const m = PL.mode(s, k); out.push({ from: s.start / d, to: s.end / d, k, a: m === 2 ? 1 : m === 1 ? 0.7 : 0.4 }); }
  window.__marks = out; window.__marksVer = (window.__marksVer || 0) + 1;
  for (const s of scrubbers) s.draw(true);
}

// ---------- themes (incl. Cover, from the playing episode's artwork) ----------
function applyTheme() {
  const t = settings.theme, root = document.documentElement;
  root.dataset.theme = t;
  root.style.setProperty('--scale', settings.textScale);
  if (t === 'cover') coverTheme(); else for (const k of ['--bg', '--bg2', '--bg3', '--ink', '--accent', '--on-accent', '--music', '--trailer', '--ad', '--tint']) root.style.removeProperty(k);
  requestAnimationFrame(() => { readColors(); const bg = getComputedStyle(root).getPropertyValue('--bg').trim(); $('meta[name=theme-color]')?.setAttribute('content', bg || '#000'); for (const s of scrubbers) s.draw(true); });
}
let coverFor = null, coverPal = null;
async function coverTheme() {
  const url = P.episode?.artworkURL, root = document.documentElement;
  const set = p => { for (const [k, v] of Object.entries(p)) root.style.setProperty(k, v); readColors(); for (const s of scrubbers) s.draw(true); };
  if (!url) return;
  if (coverFor === url && coverPal) { set(coverPal); return; }
  coverFor = url;
  const p = await palette(url); if (!p || coverFor !== url || settings.theme !== 'cover') return;
  coverPal = p; set(p);
  root.style.setProperty('--cv-bg2', p['--bg2']); root.style.setProperty('--cv-bg3', p['--bg3']); root.style.setProperty('--cv-accent', p['--accent']); root.style.setProperty('--cv-ink', `rgb(${p['--ink']})`);
}
function palette(url) {
  return new Promise(res => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.referrerPolicy = 'no-referrer';
    img.onload = () => { try { const n = 24, c = new OffscreenCanvas(n, n), g = c.getContext('2d'); g.drawImage(img, 0, 0, n, n); res(fromPixels(g.getImageData(0, 0, n, n).data)); } catch (_) { res(null); } };
    img.onerror = () => res(null);
    img.src = url;
  });
}
function fromPixels(px) {
  const lum = c => { const f = v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const con = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hsb = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d > 0) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h / 6 + 1) % 1; } return [h, mx ? d / mx : 0, mx]; };
  const rgb = (h, s, v) => { const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6), p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i]; };
  const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const readable = (c, bg, ratio) => { if (con(c, bg) >= ratio) return c; const tg = lum(bg) < 0.18 ? [1, 1, 1] : [0, 0, 0]; let lo = 0, hi = 1; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; con(mix(c, tg, m), bg) >= ratio ? hi = m : lo = m; } return mix(c, tg, hi); };
  const B = new Map();
  for (let i = 0; i < px.length; i += 4) { const c = [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255], [h, s, v] = hsb(c); const k = s < 0.18 ? 100 + Math.min(2, Math.floor(v * 3)) : Math.floor(h * 12) * 3 + Math.min(2, Math.floor(v * 3)); const b = B.get(k) || { r: 0, g: 0, b: 0, n: 0, s: 0 }; b.r += c[0]; b.g += c[1]; b.b += c[2]; b.n++; b.s += s; B.set(k, b); }
  const cols = [...B.values()].filter(b => b.n >= 4).map(b => ({ c: [b.r / b.n, b.g / b.n, b.b / b.n], share: b.n / 576, sat: b.s / b.n }));
  if (!cols.length) return null;
  const sc = x => (x.sat * 1.6 + x.share) * (hsb(x.c)[2] > 0.25 ? 1 : 0.3);
  const acc = cols.reduce((a, b) => sc(b) > sc(a) ? b : a).c, dom = cols.reduce((a, b) => b.share > a.share ? b : a).c;
  const [dh, ds] = hsb(hsb(dom)[1] < 0.12 ? acc : dom);
  const bg = rgb(dh, Math.min(0.55, ds * 0.8 + 0.12), 0.1), bg2 = rgb(dh, Math.min(0.6, ds * 0.8 + 0.2), 0.17), bg3 = rgb((dh + 0.06) % 1, Math.min(0.5, ds * 0.7 + 0.1), 0.07);
  const [ah, as] = hsb(acc); const accent = readable(rgb(ah, Math.max(0.55, Math.min(0.95, as * 1.2)), 1), bg, 4.5);
  const onA = con(accent, [0, 0, 0]) >= con(accent, [1, 1, 1]) ? '#000' : '#fff', ink = readable(rgb(dh, 0.06, 0.97), bg, 12);
  const hex = c => '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join(''), trip = c => c.map(v => Math.round(v * 255)).join(',');
  return { '--bg': hex(bg), '--bg2': hex(bg2), '--bg3': hex(bg3), '--ink': trip(ink), '--accent': hex(accent), '--on-accent': onA, '--tint': trip(ink),
    '--music': hex(readable([1, 0.62, 0.2], bg, 3)), '--trailer': hex(readable([0.4, 0.72, 1], bg, 3)), '--ad': hex(readable([1, 0.4, 0.62], bg, 3)) };
}

// ---------- menus ----------
function epMenu(e, anchor, pt) {
  const played = M.isHeard(e), playing = P.episode?.id === e.id && P.isPlaying, older = M.older(e).length, list = V.lists.get(anchor?.closest?.('[data-list]')?.dataset.list) || M.listFor(e);
  menu(anchor, [
    { label: playing ? 'Pause' : 'Play', run: () => PL.play(e, list) }, { label: 'Show Details', run: () => open({ type: 'episode', ep: e }) }, { label: 'Open Transcript', run: () => open({ type: 'transcript', ep: e }) }, '-',
    { label: 'Play Next', run: () => { M.queueNext(e); toast('Playing next'); } },
    M.isQueued(e) ? { label: 'Remove from Up Next', run: () => M.dequeue(e) } : { label: 'Add to Up Next', run: () => { M.queue(e); toast('Added to Up Next'); } }, '-',
    { label: played ? 'Mark as Unplayed' : 'Mark as Played', run: () => M.setHeard([e], !played) },
    ...(older ? [{ label: `Mark This and ${older} Older as Played`, run: () => M.markPlayedUpTo(e) }] : []),
    A.isDownloaded(e) ? { label: 'Remove Download', run: () => A.deleteDownload(e) } : A.isDownloading(e) ? { label: 'Cancel Download', run: () => A.cancelDownload(e) } : { label: 'Download', run: () => A.download(e) },
  ], pt);
}
function showMenu(p, anchor, pt) {
  menu(anchor, [{ label: 'Mark All as Played', run: () => M.setHeard(p.episodes, true) }, { label: 'Mark All as Unplayed', run: () => M.setHeard(p.episodes, false) }, '-', { label: 'Remove from Library', danger: true, run: () => { if (confirm(`Remove “${p.title}” from your library?`)) { M.removeShow(p); go('library'); } } }], pt);
}
function showSkipMenu(p, anchor) {
  const pr = lib.prefs[p.id] || {}, row = (key, k, label, g) => [{ header: label }, { label: `Default (${M.modeTitle(settings[g])})`, checked: pr[key] == null, run: () => setShow(p, key, undefined) }, ...[2, 1, 0].map(m => ({ label: M.modeTitle(m), checked: pr[key] === m, run: () => setShow(p, key, m) }))];
  menu(anchor, [...row('music', 'music', 'Interludes', 'musicMode'), '-', ...row('trailers', 'trailer', 'Extras', 'trailerMode'), '-', ...row('ads', 'ad', 'Ads', 'adMode'), '-', { label: 'Keep intro interlude (first 2 min)', checked: !!pr.keepIntro, run: () => setShow(p, 'keepIntro', pr.keepIntro ? undefined : true) }]);
}
function setShow(p, k, v) { M.setPrefs(p.id, x => x[k] = v); PL.rearm(); updateMarks(); renderPage(true); }
function speedMenu(anchor) {
  const id = P.episode?.podcastID, pinned = id && lib.prefs[id]?.speed != null;
  menu(anchor, [{ header: 'Speed' }, ...M.OPTIONS.rates.map(r => ({ label: rateStr(r), checked: r === P.rate, run: () => PL.applyRate(r) })),
    ...(id ? ['-', pinned ? { label: 'Use Default Speed for This Show', run: () => { M.setPrefs(id, x => x.speed = undefined); PL.setRate(settings.rate, true); } } : { label: `Always Use ${rateStr(P.rate)} for This Show`, run: () => M.setPrefs(id, x => x.speed = P.rate) }] : [])]);
}
function sleepMenu(anchor) {
  const on = P.sleepAt || P.sleepAtEnd;
  menu(anchor, [...[5, 15, 30, 45, 60, 90].map(m => ({ label: `${m} minutes`, run: () => PL.sleep(m) })), { label: 'End of Episode', run: PL.sleepAtEnd }, ...(on ? ['-', { label: 'Turn Off Sleep Timer', danger: true, run: PL.cancelSleep }] : [])]);
}
function shortcuts() {
  const k = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  menu(null, [{ header: 'Keyboard' }, ...[['Space', 'Play / Pause'], [k + '← / →', 'Skip back / forward'], ['⇧' + k + '← / →', 'Previous / next episode'], [k + '↑ / ↓', 'Volume'], ['⌥' + k + '[ / ]', 'Slower / faster'], ['⌥' + k + 'Z', 'Undo skip'], ['⌥' + k + 'K', 'Skip suggested section'], ['⌥' + k + 'M / T', 'Cycle interlude / extra skipping'], ['⌥' + k + 'S', 'Skip silence on/off'], ['⇧' + k + 'P', 'Now Playing'], ['⇧' + k + 'M', 'Mini player'], ['1 – 5', 'Sections'], [k + ',', 'Settings'], [k + '[ or Esc', 'Back'], [k + '+ / −', 'Transcript text size'], ['F', 'Full screen']].map(([a, b]) => ({ label: `${a}  —  ${b}`, run: () => {} }))], { x: innerWidth / 2 - 150, y: 80 });
}

// ---------- clicks: one delegated handler ----------
function epFrom(el) { const id = el.dataset.id || el.closest('[data-ep]')?.dataset.ep; return lib.byId.get(id) || (P.episode?.id === id ? P.episode : null) || route()?.ep || lib.upNext.find(x => x.id === id) || null; }
function listFrom(el, e) { return V.lists.get(el.closest('[data-list]')?.dataset.list) || M.listFor(e); }
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b || b.disabled) return;
  const a = b.dataset.act, e = () => epFrom(b);
  if (a !== 'seek-note' && b.tagName === 'A') return;
  ev.preventDefault();
  switch (a) {
    case 'tab': go(b.dataset.tab); break;
    case 'settings': open({ type: 'settings' }); break;
    case 'back-nav': history.back(); break;
    case 'fullscreen': toggleFullscreen(); break;
    case 'play': { const x = e(); if (x) PL.play(x, listFrom(b, x)); break; }
    case 'play-first': { const x = e(); if (x) PL.play(x, V.lists.get('show')); break; }
    case 'open-ep': { const x = e(); if (x) open({ type: 'episode', ep: x }); break; }
    case 'open-tr': { const x = e(); if (x) open({ type: 'transcript', ep: x }); break; }
    case 'open-show': openShow(b.dataset.show); break;
    case 'expand': nav.expanded.has(b.dataset.show) ? nav.expanded.delete(b.dataset.show) : nav.expanded.add(b.dataset.show); renderPage(true); break;
    case 'played': { const x = e(); if (x) M.setHeard([x], !M.isHeard(x)); break; }
    case 'older': { const x = e(); if (x) M.markPlayedUpTo(x); break; }
    case 'dl': { const x = e(); if (x) { A.download(x); A.persist(); } break; }
    case 'dl-cancel': { const x = e(); if (x) A.cancelDownload(x); break; }
    case 'dl-del': { const x = e(); if (x) A.deleteDownload(x); break; }
    case 'dl-all': if (confirm('Remove all downloads from this device?')) A.deleteAllDownloads(); break;
    case 'ep-menu': { const x = e(); if (x) epMenu(x, b); break; }
    case 'show-menu': { const p = M.podcast(b.dataset.show); if (p) showMenu(p, b); break; }
    case 'show-skip': { const p = M.podcast(b.dataset.show); if (p) showSkipMenu(p, b); break; }
    case 'hide-heard': M.set('hideHeard', !settings.hideHeard); renderPage(true); break;
    case 'queue-clear': M.clearQueue(); break;
    case 'q-up': M.moveQueue(+b.dataset.i, -1); break;
    case 'q-down': M.moveQueue(+b.dataset.i, 1); break;
    case 'q-remove': { const x = lib.upNext.find(y => y.id === b.dataset.id); if (x) M.dequeue(x); break; }
    case 'add-show': M.addShow(b.dataset.url, b.dataset.art || null).then(p => { if (p) { toast('Added ' + p.title); renderPage(true); A.autoDownload(); } }); break;
    case 'hit': { const x = lib.byId.get(b.dataset.id); if (x) PL.play(x, M.listFor(x), Math.max(0, +b.dataset.t)); break; }
    case 'seek-note': { const x = e(); if (x) PL.play(x, M.listFor(x), +b.dataset.t); break; }
    case 'go:search': go('search'); break;
    case 'toggle': PL.toggle(); break;
    case 'back': PL.back(); break;
    case 'fwd': PL.forward(); break;
    case 'prev': PL.previous(); break;
    case 'next': PL.next(); break;
    case 'undo': PL.undoSkip(); break;
    case 'accept': PL.acceptSuggestion(); break;
    case 'dismiss': PL.dismissSuggestion(); break;
    case 'open-np': openNP(); break;
    case 'close-np': history.back(); break;
    case 'mini': openMini(); break;
    case 'np-menu': { const x = P.episode; if (x) menu(b, [{ label: 'Show Episode', run: () => open({ type: 'episode', ep: x }) }, { label: 'Open Transcript', run: () => open({ type: 'transcript', ep: x }) }, ...(x.podcastID ? [{ label: 'Go to Show', run: () => openShow(x.podcastID) }] : []), '-', { label: 'Mini Player', run: openMini }]); break; }
    case 'mini-menu': { const x = P.episode; menu(b, [{ label: 'Open Full Player', run: () => { closeMini(); openNP(); } }, ...(x ? [{ label: 'Show Episode', run: () => { closeMini(); open({ type: 'episode', ep: x }); } }] : []), '-', { label: 'Close Mini Player', run: closeMini }]); break; }
    case 'speed-menu': speedMenu(b); break;
    case 'sleep-menu': sleepMenu(b); break;
    case 'cycle-music': M.set('musicMode', [1, 2, 0][settings.musicMode]); break;
    case 'cycle-trailer': M.set('trailerMode', [1, 2, 0][settings.trailerMode]); break;
    case 'cycle-ad': M.set('adMode', [1, 2, 0][settings.adMode]); break;
    case 'cycle-silence': M.set('skipSilence', !settings.skipSilence); break;
    case 'mute': PL.setVolume(P.volume > 0 ? 0 : 0.8); break;
    case 'kind': nav.expandedKind = nav.expandedKind === b.dataset.k ? null : b.dataset.k; liveNP(true); break;
    case 'listen': { const s = PL.sections(b.dataset.k).find(x => x.start === +b.dataset.s); if (s) PL.listen(s); break; }
    case 'np-tab': M.set('npTab', b.dataset.v); npView(); np.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x.dataset.v === settings.npTab)); break;
    case 'mini-tab': M.set('miniTab', b.dataset.v); renderMini(); break;
    case 'follow': M.set('follow', !settings.follow); document.querySelectorAll('[data-act=follow]').forEach(x => { x.classList.toggle('active', settings.follow); x.style.background = settings.follow ? '' : 'var(--surface)'; }); if (settings.follow) TR.recenter(); break;
    case 'tr-smaller': M.set('transcriptSize', Math.max(12, settings.transcriptSize - 2)); break;
    case 'tr-larger': M.set('transcriptSize', Math.min(34, settings.transcriptSize + 2)); break;
    case 'theme': M.set('theme', b.dataset.v); break;
    case 'opml-import': pickFile('.opml,.xml,text/xml', async t => { const r = await M.importOPML(t); toast(r.added || r.failed ? `Added ${r.added} show${r.added === 1 ? '' : 's'}${r.failed ? ` · ${r.failed} couldn’t be loaded` : ''}` : 'No new shows in that file'); A.autoDownload(); }); break;
    case 'opml-export': save('Poden subscriptions.opml', self.PodenText.opmlExport(lib.podcasts), 'text/x-opml'); break;
    case 'backup-import': pickFile('.json,application/json', async t => { try { await M.importBackup(JSON.parse(t)); await A.loadAll(); PL.restore(); toast('Library imported'); renderPage(); } catch (err) { toast('That file couldn’t be read'); } }); break;
    case 'backup-export': save('Poden library.json', JSON.stringify(M.exportBackup()), 'application/json'); break;
    case 'shortcuts': shortcuts(); break;
    default:
      if (a.startsWith('set-')) { const k = a.slice(4); if (b.classList.contains('switch')) M.set(k, !settings[k]); else { const raw = b.dataset.v; M.set(k, isNaN(+raw) ? raw : +raw); } if (k === 'autoDownload') A.autoDownload(); if (k === 'removePlayed') A.removePlayed(); }
  }
});
document.addEventListener('contextmenu', ev => {
  const row = ev.target.closest('[data-ep]'), tile = ev.target.closest('[data-show][data-ctx]');
  if (tile) { ev.preventDefault(); const p = M.podcast(tile.dataset.show); if (p) showMenu(p, null, { x: ev.clientX, y: ev.clientY }); return; }
  if (row && !ev.target.closest('.notes,.tr')) { ev.preventDefault(); const e = epFrom(row); if (e) epMenu(e, null, { x: ev.clientX, y: ev.clientY }); }
});
// long-press = context menu on touch
let lp = 0;
document.addEventListener('touchstart', ev => { const row = ev.target.closest('[data-ep],[data-show][data-ctx]'); if (!row || ev.target.closest('.tr,.scrub')) return; const t = ev.touches[0]; lp = setTimeout(() => { lp = -1; navigator.vibrate?.(8); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: t.clientX, clientY: t.clientY })); }, 480); }, { passive: true });
document.addEventListener('touchmove', () => { if (lp > 0) clearTimeout(lp); }, { passive: true });
document.addEventListener('touchend', ev => { if (lp > 0) clearTimeout(lp); if (lp === -1) { ev.preventDefault(); lp = 0; } }, { passive: false });
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.dataset.act === 'volume') { PL.setVolume(+t.value); t.style.setProperty('--v', t.value * 100 + '%'); }
  if (t.id === 'q') { nav.query = t.value; clearTimeout(t.__d); t.__d = setTimeout(() => V.renderTranscriptHits(nav.query), 120); }
  if (t.id === 'relay') M.set('relay', t.value.trim());
});
document.addEventListener('keydown', async ev => {
  if (ev.target.id === 'q' && ev.key === 'Enter') {
    const q = nav.query.trim(); if (!q) return; ev.target.blur();
    if (/^https?:\/\//i.test(q)) { const p = await M.addShow(q); if (p) { nav.query = ''; openShow(p.id); A.autoDownload(); } else renderPage(true); }
    else { await M.search(q); renderPage(true); }
  }
});
function pickFile(accept, then) { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = async () => { const f = i.files[0]; if (f) then(await f.text()); }; i.click(); }
function save(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

// ---------- keyboard (same shortcuts as the Mac app) ----------
addEventListener('keydown', ev => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range';
  if (typing) { if (ev.key === 'Escape') document.activeElement.blur(); return; }
  const cmd = ev.metaKey || ev.ctrlKey, k = ev.key.toLowerCase();
  const act = f => { ev.preventDefault(); f(); };
  if (ev.code === 'Space' && !cmd) return act(PL.toggle);
  if (k === 'escape') { if (nav.nowPlaying) return act(() => history.back()); if (nav.mini) return act(closeMini); if (nav.path.length) return act(() => history.back()); }
  if (cmd && ev.altKey) {
    if (ev.code === 'KeyZ') return act(PL.undoSkip); if (ev.code === 'KeyK') return act(PL.acceptSuggestion);
    if (ev.code === 'KeyM') return act(() => M.set('musicMode', [1, 2, 0][settings.musicMode])); if (ev.code === 'KeyT') return act(() => M.set('trailerMode', [1, 2, 0][settings.trailerMode]));
    if (ev.code === 'KeyS') return act(() => M.set('skipSilence', !settings.skipSilence));
    if (ev.code === 'BracketRight') return act(PL.faster); if (ev.code === 'BracketLeft') return act(PL.slower);
  }
  if (cmd && ev.shiftKey) {
    if (k === 'arrowleft') return act(PL.previous); if (k === 'arrowright') return act(PL.next);
    if (ev.code === 'KeyP') return act(() => nav.nowPlaying ? history.back() : openNP()); if (ev.code === 'KeyM') return act(() => nav.mini ? closeMini() : openMini());
  }
  if (cmd && !ev.shiftKey && !ev.altKey) {
    if (k === 'arrowleft') return act(PL.back); if (k === 'arrowright') return act(PL.forward);
    if (k === 'arrowup') return act(() => PL.setVolume(P.volume + 0.1)); if (k === 'arrowdown') return act(() => PL.setVolume(P.volume - 0.1));
    if (k === ',') return act(() => open({ type: 'settings' })); if (k === '[') return act(() => history.back());
    if (k === '=' || k === '+') return act(() => M.set('transcriptSize', Math.min(34, settings.transcriptSize + 2))); if (k === '-') return act(() => M.set('transcriptSize', Math.max(12, settings.transcriptSize - 2)));
    if (k === 'r') return act(() => M.refreshAll()); if (k === 'n') return act(() => go('search'));
  }
  if (!cmd && !ev.altKey && /^[1-5]$/.test(ev.key)) return act(() => go(V.TABS[+ev.key - 1][0]));
  if (!cmd && !ev.altKey && k === 'f' && fsSupported()) return act(toggleFullscreen);
});

// ---------- full screen / app mode ----------
// Phones: requests real full screen (Android) and locks the page into an app-like, non-scrolling shell.
// iPhone Safari can't hide its bars from a web page — Add to Home Screen gives the true full-screen app
// (standalone), and Poden+ shows how the first time you tap the button.
async function toggleFullscreen() {
  const d = document, el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) { try { await req.call(el, { navigationUI: 'hide' }); try { await screen.orientation?.lock?.('portrait'); } catch (_) {} return; } catch (_) {} }
  if (/iPhone|iPod|iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) installHint();
}
function installHint() {
  menu(null, [{ header: 'Full screen on iPhone' }, { label: '1. Tap Share (□↑) in Safari’s toolbar', run: () => {} }, { label: '2. Choose “Add to Home Screen”', run: () => {} }, { label: '3. Open Poden+ from the Home Screen', run: () => {} }, '-', { label: 'It runs full screen like an app, keeps playing in the background, with lock-screen controls.', run: () => {} }], { x: 20, y: 80 });
}
document.addEventListener('fullscreenchange', renderTop); document.addEventListener('webkitfullscreenchange', renderTop);

// ---------- leaving the page: keep playing, switch to the mini player ----------
// When you switch app / lock the phone, the bar collapses to the mini player (Now Playing closes) so
// coming back shows the compact player; audio carries on and the OS media controls take over.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (phone.matches && nav.nowPlaying && P.isPlaying) { nav.nowPlaying = false; np.classList.remove('open'); renderBar(); }
    if (!phone.matches && P.isPlaying && !nav.mini && settings.autoMini) openMini();
  } else { live(true); kick(); if (P.isPlaying && P.au.paused) P.au.play().catch(() => {}); }
});

// ---------- events → UI ----------
M.on('*', topics => {
  const t = [...topics];
  if (t.includes('settings')) { applyTheme(); }
  if (t.some(x => ['settings.skipBack', 'settings.skipForward', 'settings.musicMode', 'settings.trailerMode', 'settings.adMode', 'settings.skipSilence'].includes(x))) { PL.rearm(); updateMarks(); liveBar(true); liveNP(true); }
  if (t.includes('settings.transcriptSize')) { document.querySelectorAll('.tr:not([data-fixed])').forEach(x => x.style.fontSize = settings.transcriptSize + 'px'); const mt = mini.querySelector('.tr'); if (mt) mt.style.fontSize = Math.max(13, settings.transcriptSize - 3) + 'px'; if (route()?.type === 'settings') renderPage(true); }
  if (t.includes('settings.theme') || t.includes('settings.textScale') || t.some(x => /settings\.(skip|music|trailer|ad|auto|remove)/.test(x))) { if (route()?.type === 'settings') renderPage(true); if (t.includes('settings.textScale')) { fitMarquees(); for (const s of scrubbers) { s.w = 0; s.draw(true); } } }
  if (t.includes('episode')) { renderBar(); if (nav.nowPlaying) renderNP(); if (nav.mini) renderMini(); updateMarks(); if (settings.theme === 'cover') coverTheme(); refreshRows(); }
  if (t.includes('play')) { liveBar(true); liveNP(true); refreshRows(); kick(); }
  if (t.includes('notice') || t.includes('status')) { subline(bar.querySelector('[data-sub]')); for (const r of [np, mini]) { subline(r.querySelector('[data-sub]')); const d = r.querySelector('[data-detected]'); if (d && P.episode) d.innerHTML = V.detected(P.episode); } }
  if (t.includes('status')) { TR.refreshAll(); }
  if (t.includes('sleep') || t.includes('rate') || t.includes('prefs')) { bar.querySelector('[data-speed]') && (bar.querySelector('[data-speed]').innerHTML = V.speedBtn(), bar.querySelector('[data-sleep-btn]').innerHTML = V.sleepBtn()); liveNP(true); }
  if (t.includes('volume')) { document.querySelectorAll('input[data-act=volume]').forEach(i => { if (document.activeElement !== i) { i.value = P.volume; i.style.setProperty('--v', P.volume * 100 + '%'); } }); }
  if (t.includes('marks') || t.includes('analysis')) { updateMarks(); for (const r of [np, mini]) { const d = r.querySelector('[data-detected]'); if (d && P.episode) d.innerHTML = V.detected(P.episode); } }
  if (t.includes('transcript')) TR.refreshAll();
  if (t.includes('chapters') || t.includes('analysis')) TR.refreshChapters();
  if (t.includes('library') || t.includes('heard') || t.includes('queue') || t.includes('downloads') || t.includes('stats') || t.includes('search') || (t.includes('busy') && nav.tab === 'search')) softRefresh();
  if (t.includes('busy') || t.includes('queue') || t.includes('downloads')) renderTop();
  if (t.includes('time')) kick();
});
// Rows/pages re-render only when their data changed, keeping scroll; skipped while the user is dragging.
let softT = 0;
function softRefresh() { clearTimeout(softT); softT = setTimeout(() => { const r = route(); if (r?.type === 'transcript') return; if (r?.type === 'episode' || r?.type === 'settings' || !r || r.type === 'show') { if (nav.tab === 'search' && !r && document.activeElement?.id === 'q') { const q = document.activeElement, s = q.selectionStart; renderPage(true); const nq = $('#q'); nq?.focus({ preventScroll: true }); nq?.setSelectionRange(s, s); return; } renderPage(true); } }, 60); }
function refreshRows() {
  for (const row of main.querySelectorAll('.ep[data-ep]')) {
    const e = lib.byId.get(row.dataset.ep); if (!e) continue;
    const cur = P.episode?.id === e.id; row.classList.toggle('current', cur);
    const i = row.querySelector('.pp i'); if (i) i.innerHTML = icon(cur && P.isPlaying ? 'pause' : 'play', 11);
  }
  for (const p of main.querySelectorAll('.hero [data-act=play], .headline [data-act=play], .trpage [data-act=play]')) { const e = epFrom(p); if (!e) continue; const pl = P.episode?.id === e.id && P.isPlaying; p.innerHTML = `${icon(pl ? 'pause' : 'play', 14)}<span>${pl ? 'Pause' : M.positions.get(e.id) > 10 ? 'Resume' : 'Play'}</span>`; }
  if (route()?.type === 'episode' && P.episode?.id === route().ep.id && !main.querySelector('[data-scrub]')) renderPage(true);
}
A.onDownloadFail(e => toast(`Couldn’t download “${e.title.slice(0, 40)}”. The host may block web downloads — try a relay in Settings.`, 4500));
addEventListener('resize', () => { fitMarquees(); if (nav.nowPlaying) { clearTimeout(window.__rz); window.__rz = setTimeout(renderNP, 120); } if (phone.matches && nav.mini) closeMini(); });
np.addEventListener('touchstart', ev => { const t = ev.touches[0]; if (ev.target.closest('.tr,.scrub,input,.chapters,.npleft') && t.clientY > 120) return; np.__y = t.clientY; }, { passive: true });
np.addEventListener('touchmove', ev => { if (np.__y == null) return; const dy = ev.touches[0].clientY - np.__y; if (dy > 0) np.style.transform = `translateY(${dy}px)`; }, { passive: true });
np.addEventListener('touchend', ev => { if (np.__y == null) return; const dy = ev.changedTouches[0].clientY - np.__y; np.__y = null; np.style.transform = ''; if (dy > 110) history.back(); });

// ---------- start ----------
async function start() {
  applyTheme(); renderTop();
  main.innerHTML = '<div class="page"></div>';
  await Promise.all([M.loadLibrary(), A.loadAll()]);
  history.replaceState({ root: 1 }, '');
  PL.restore(); renderBar(); renderPage();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  // background work after first paint
  const idle = self.requestIdleCallback || (f => setTimeout(f, 600));
  idle(async () => { await M.refreshAll(); A.removePlayed(); A.autoDownload(); A.catchUp(); A.prepareAhead(P); });
  setInterval(() => { if (!document.hidden) M.refreshAll(); }, 30 * 60 * 1000);
}
start();
