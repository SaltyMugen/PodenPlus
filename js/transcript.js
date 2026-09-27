// Interactive transcript: word-by-word highlight, tap a word to jump there, follows playback.
// Built for 3-hour episodes (30 000+ words): sentences render in chunks as you scroll near them
// (content-visibility keeps off-screen ones free), and each tick only touches the one or two words
// whose state changed — never the whole list.
import { P, play, seek } from './player.js';
import * as A from './analyzer.js';
import { settings, listFor } from './model.js';
import { esc, pill } from './ui.js';
import { icon } from './icons.js';
const T = self.PodenText;

const views = new Set();
export function mount(el, e) {
  const v = { el, e, tt: null, line: -1, word: -1, rendered: 0, lastAuto: 0, userScroll: -1e9 };
  el.__tv = v; views.add(v);
  el.style.fontSize = (+el.dataset.size || settings.transcriptSize) + 'px';
  el.addEventListener('click', ev => {
    const w = ev.target.closest('w'); if (!w) return;
    const ln = w.parentElement, li = +ln.dataset.l, wi = +w.dataset.w, t = v.tt.lines[li].ws[wi];
    if (t >= 0) { if (P.episode?.id === e.id) { seek(t); if (!P.isPlaying) window.__toggle(); } else play(e, listFor(e), t); }
  });
  const mark = () => { if (performance.now() - v.lastAuto > 400) v.userScroll = performance.now(); };
  el.addEventListener('wheel', mark, { passive: true }); el.addEventListener('touchmove', mark, { passive: true });
  el.addEventListener('scroll', () => { if (v.rendered < (v.tt?.lines.length || 0) && el.scrollTop + el.clientHeight * 3 > el.scrollHeight) more(v, 400); }, { passive: true });
  build(v);
  return v;
}
export function refreshAll() { for (const v of views) if (!v.el.isConnected) views.delete(v); else build(v); }
export function setSize(px) { for (const v of views) if (v.el.isConnected) { const base = +v.el.dataset.size; if (!v.el.dataset.fixed) v.el.style.fontSize = px + 'px'; } }

function build(v) {
  const { el, e } = v;
  const t = A.an.transcripts.get(e.id), tt = A.an.timed.get(e.id);
  if (!t || !tt || !tt.lines.length) {
    v.tt = null;
    const msg = t === undefined ? 'Loading transcript…' : e.transcriptURL ? 'This show’s transcript couldn’t be loaded.' : 'This show doesn’t publish transcripts.';
    el.classList.remove('live');
    el.innerHTML = `<div class="empty" style="height:100%;justify-content:center">${icon('bubble', 28)}<p class="callout">${msg}</p>${t === undefined || e.transcriptURL ? '' : '<p class="cap ter">Transcripts made by Poden+ for Mac come across with a library import (Settings → Library).</p>'}</div>`;
    return;
  }
  if (v.tt === tt && el.firstElementChild?.classList.contains('ln')) return;
  v.tt = tt; v.line = -1; v.word = -1; v.rendered = 0; el.innerHTML = '';
  const pos = P.episode?.id === e.id ? T.position(tt, P.time) : null;
  more(v, Math.max(300, (pos?.line || 0) + 200));
  update(v, true);
}
function more(v, n) {
  const tt = v.tt, end = Math.min(tt.lines.length, v.rendered + n); let h = '';
  for (let i = v.rendered; i < end; i++) {
    const L = tt.lines[i];
    h += `<span class="ln ${i === 0 ? '' : L.p ? 'p' : 's'}" data-l="${i}">`;
    for (let k = 0; k < L.w.length; k++) h += `<w data-w="${k}">${esc(L.w[k])}</w> `;
    h += '</span>';
  }
  v.el.insertAdjacentHTML('beforeend', h); v.rendered = end;
}

// Called by the tick loop (≈ every animation frame while playing, throttled to word changes).
export function tick() {
  for (const v of views) { if (!v.el.isConnected) { views.delete(v); continue; } update(v, false); }
}
function update(v, force) {
  const tt = v.tt; if (!tt) return;
  const mine = P.episode?.id === v.e.id;
  const pos = mine ? T.position(tt, P.dragTime ?? P.time) : null;
  const line = pos ? pos.line : -1, word = pos ? pos.word : -1;
  if (!force && line === v.line && word === v.word) return;
  const el = v.el;
  el.classList.toggle('live', !!pos);
  if (line >= v.rendered) more(v, line - v.rendered + 200);
  const lineEl = i => i >= 0 && i < v.rendered ? el.children[i] : null;
  if (line !== v.line) {
    const old = lineEl(v.line);
    if (old) { old.classList.remove('act'); for (const w of old.querySelectorAll('w.rd,w.now')) w.className = ''; }
    const cur = lineEl(line); if (cur) cur.classList.add('act');
    v.word = -1;
    if (cur && settings.follow && performance.now() - v.userScroll > 4000) {
      v.lastAuto = performance.now();
      const top = cur.offsetTop - el.clientHeight / 2 + cur.offsetHeight / 2;
      el.scrollTo({ top, behavior: Math.abs(top - el.scrollTop) > el.clientHeight * 2 || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }
  const cur = lineEl(line);
  if (cur) {
    const ws = cur.children, from = Math.max(0, Math.min(v.word, word)), to = Math.min(ws.length - 1, Math.max(v.word, word));
    if (v.word < 0 || word < v.word) for (let k = 0; k < ws.length; k++) ws[k].className = k < word ? 'rd' : k === word ? 'now' : '';
    else for (let k = from; k <= to; k++) ws[k].className = k < word ? 'rd' : k === word ? 'now' : '';
  }
  v.line = line; v.word = word;
}
export function recenter() { for (const v of views) { v.userScroll = -1e9; v.line = -2; update(v, true); } }

// ---------- chapters ----------
const chViews = new Set();
export function mountChapters(el, e) { const v = { el, e, ci: -2 }; chViews.add(v); buildCh(v); el.addEventListener('click', ev => { const b = ev.target.closest('[data-c]'); if (!b) return; const c = A.chapters(e)[+b.dataset.c]; if (c) play(e, listFor(e), c.start); }); }
function buildCh(v) {
  const list = A.chapters(v.e);
  if (!list.length) {
    const working = A.an.status.has(v.e.id) || !A.upToDate(v.e.id);
    v.el.innerHTML = `<div class="empty">${icon('list', 30)}<h3>${working ? 'Making chapters…' : 'No chapters'}</h3><p>${working ? 'Chapters are made on this device once the episode has a transcript and has been scanned.' : 'This episode doesn’t include chapters.'}</p></div>`;
    v.n = 0; return;
  }
  v.n = list.length;
  v.el.innerHTML = list.map((c, i) => `<button class="ch press" data-c="${i}"><span class="grow stack gap6"><span class="ct clamp2">${esc(c.title)}</span><span class="progress hidden" style="height:3px"><i></i></span></span><span class="callout sec mono">${fmtT(c.start)}</span></button>`).join('');
  v.ci = -2; tickCh(v, true);
}
const fmtT = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
export function refreshChapters() { for (const v of chViews) if (!v.el.isConnected) chViews.delete(v); else buildCh(v); }
export function tickChapters() { for (const v of chViews) { if (!v.el.isConnected) { chViews.delete(v); continue; } tickCh(v, false); } }
function tickCh(v, force) {
  const list = A.chapters(v.e); if (!list.length) return;
  const mine = P.episode?.id === v.e.id, now = P.dragTime ?? P.time;
  const ci = mine ? A.currentChapter(list, now) : null;
  if (ci !== v.ci || force) {
    const kids = v.el.children;
    if (v.ci >= 0 && kids[v.ci]) { kids[v.ci].classList.remove('on'); kids[v.ci].querySelector('.progress').classList.add('hidden'); }
    if (ci != null && kids[ci]) { kids[ci].classList.add('on'); kids[ci].querySelector('.progress').classList.remove('hidden'); if (v.el.dataset.scrolls) kids[ci].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    v.ci = ci ?? -1;
  }
  if (ci != null) { const end = ci + 1 < list.length ? list[ci + 1].start : P.duration, bar = v.el.children[ci]?.querySelector('.progress i'); if (bar && end > list[ci].start) bar.style.width = Math.min(100, (now - list[ci].start) / (end - list[ci].start) * 100) + '%'; }
}
