// UI helpers: formatting, escaping, covers, menus, toasts, marquee, scrubber, segmented controls.
import { icon } from './icons.js';
import { settings, lib, showPrefs } from './model.js';
import { P } from './player.js';

export const $ = (s, r = document) => r.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = s => { if (!isFinite(s)) s = 0; s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
export const long = s => { const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${Math.max(1, m)} min`; };
export const short = s => { const t = Math.round(Math.max(0, s)); return t < 60 ? `${t}s` : t < 3600 ? `${Math.floor(t / 60)}m ${t % 60}s` : `${Math.floor(t / 3600)}h ${Math.floor(t / 60) % 60}m`; };
export const rateStr = r => `${+r.toFixed(2)}×`;
export function listenLength(sec, e) {
  const r = P.episode?.id === e.id ? P.rate : (showPrefs(e).speed ?? settings.rate);
  return r === 1 ? long(sec) : `${long(sec / r)} at ${rateStr(r)}`;
}
const DF = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const DL = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
export const date = d => d ? DF.format(new Date(d)) : '';
export const dateLong = d => d ? DL.format(new Date(d)) : '';
export const bytes = n => n < 1e6 ? `${Math.round(n / 1e3)} KB` : n < 1e9 ? `${(n / 1e6).toFixed(n < 1e8 ? 1 : 0)} MB` : `${(n / 1e9).toFixed(2)} GB`;

// ---------- covers: lazy, decoded off-thread, fade-in ----------
const failed = new Set();
export function cover(url, size, extra = '') {
  const s = size ? `style="width:${size}px"` : '';
  const src = url && !failed.has(url) ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="this.classList.add('ok')" onerror="window.__coverFail(this)">` : '';
  return `<div class="cover ${extra}" ${s}>${src}</div>`;
}
window.__coverFail = img => { failed.add(img.getAttribute('src')); img.remove(); };

// ---------- buttons ----------
export const iconBtn = (name, label, act, { size = 14, active = false, cls = '', attrs = '' } = {}) =>
  `<button class="icon-btn press ${active ? 'active' : ''} ${cls}" data-act="${act}" title="${esc(label)}" aria-label="${esc(label)}" ${attrs}>${icon(name, size)}</button>`;
export const pill = (title, act, { sym, prominent, attrs = '', cls = '' } = {}) =>
  `<button class="pill press ${prominent ? 'prominent' : ''} ${cls}" data-act="${act}" ${attrs}>${sym ? icon(sym, 14) : ''}<span>${esc(title)}</span></button>`;
export const seg = (opts, sel, act, label) => `<div class="seg" role="radiogroup">${opts.map(o => `<button class="press ${o === sel ? 'on' : ''}" role="radio" aria-checked="${o === sel}" data-act="${act}" data-v="${esc(o)}">${esc(label(o))}</button>`).join('')}</div>`;
export const sw = (on, act, label) => `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-act="${act}"></button>`;
export const empty = (sym, title, msg, action) => `<div class="empty">${icon(sym, 36)}<h3>${esc(title)}</h3><p>${esc(msg)}</p>${action ? pill(action[0], action[1], { prominent: true }) : ''}</div>`;

// ---------- menus (popover on desktop, bottom sheet on phones) ----------
let menuEl, scrim;
export function menu(anchor, items, { x, y } = {}) {
  closeMenu();
  scrim = document.createElement('div'); scrim.id = 'scrim';
  const phone = matchMedia('(max-width:760px)').matches;
  if (phone) scrim.className = 'dim';
  menuEl = document.createElement('div'); menuEl.id = 'menu'; menuEl.className = 'glass' + (phone ? ' sheet' : ''); menuEl.setAttribute('role', 'menu');
  menuEl.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : it.header ? `<div class="mh">${esc(it.header)}</div>` :
    `<button class="mi ${it.danger ? 'danger' : ''}" role="menuitem" data-i="${i}"><span class="ck">${it.checked ? icon('check', 13) : ''}</span>${esc(it.label)}</button>`).join('');
  document.body.append(scrim, menuEl);
  scrim.onclick = closeMenu;
  scrim.oncontextmenu = ev => { ev.preventDefault(); closeMenu(); };
  menuEl.onclick = ev => { const b = ev.target.closest('[data-i]'); if (!b) return; const it = items[+b.dataset.i]; closeMenu(); it.run?.(); };
  if (!phone) {
    const r = anchor ? anchor.getBoundingClientRect() : { left: x, right: x, bottom: y, top: y };
    const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    let left = anchor ? Math.min(r.left, innerWidth - mw - 10) : Math.min(x, innerWidth - mw - 10);
    let top = r.bottom + 6; if (top + mh > innerHeight - 10) top = Math.max(10, r.top - mh - 6);
    menuEl.style.left = Math.max(10, left) + 'px'; menuEl.style.top = top + 'px';
  }
  menuEl.querySelector('.mi')?.focus({ preventScroll: true });
}
export function closeMenu() { menuEl?.remove(); scrim?.remove(); menuEl = scrim = null; }
addEventListener('keydown', e => { if (e.key === 'Escape' && menuEl) { closeMenu(); e.stopPropagation(); } }, true);
addEventListener('resize', closeMenu);

let toastEl, toastT;
export function toast(text, ms = 2600) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'toast'; toastEl.className = 'glass'; toastEl.setAttribute('role', 'status'); document.body.append(toastEl); }
  toastEl.textContent = text; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => toastEl.hidden = true, ms);
}

// ---------- marquee: rests 2 s, scrolls at 30 px/s, rests, returns ----------
export const marquee = (text, cls = '', center = false) => `<div class="marq ${center ? 'center' : ''} ${cls}" data-marq><span>${esc(text)}</span></div>`;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const anims = new WeakMap();
export function fitMarquees(root = document) {
  for (const m of root.querySelectorAll('[data-marq]')) {
    const s = m.firstElementChild; if (!s) continue;
    const over = s.scrollWidth - m.clientWidth;
    anims.get(s)?.cancel();
    if (over > 0.5 && !reduce.matches) {
      m.style.textAlign = 'left';
      const travel = over / 30, cycle = 4 + travel * 2, r1 = 2 / cycle, r2 = (2 + travel) / cycle, r3 = (4 + travel) / cycle;
      anims.set(s, s.animate([{ transform: 'translateX(0)', offset: 0 }, { transform: 'translateX(0)', offset: r1 }, { transform: `translateX(${-over}px)`, offset: r2 }, { transform: `translateX(${-over}px)`, offset: r3 }, { transform: 'translateX(0)', offset: 1 }], { duration: cycle * 1000, iterations: Infinity }));
    } else { m.style.textAlign = ''; if (over > 0.5) { m.style.textOverflow = 'ellipsis'; } }
  }
}

// ---------- scrubber: one canvas draw for track + sections; playhead is a transformed div ----------
export class Scrubber {
  constructor(el, height) {
    this.el = el; this.h = height; el.classList.add('scrub'); el.style.height = (height + 12) + 'px';
    el.innerHTML = `<canvas style="top:6px;height:${height}px"></canvas><div class="head"></div>`;
    el.setAttribute('role', 'slider'); el.setAttribute('aria-label', 'Playback position'); el.tabIndex = 0;
    this.c = el.firstElementChild; this.head = el.lastElementChild; this.w = 0; this.key = '';
    this.ro = new ResizeObserver(() => { this.w = 0; this.draw(true); }); this.ro.observe(el);
    const pt = e => { const r = el.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
    el.addEventListener('pointerdown', e => { if (!P.episode || !(P.duration > 0)) return; el.setPointerCapture(e.pointerId); this.drag = true; P.dragTime = pt(e) * P.duration; window.__tick?.(); });
    el.addEventListener('pointermove', e => { if (this.drag) { P.dragTime = pt(e) * P.duration; window.__tick?.(); } });
    const end = () => { if (!this.drag) return; this.drag = false; if (P.dragTime != null) window.__seek(P.dragTime); P.dragTime = null; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { window.__seek(P.time + settings.skipForward); e.preventDefault(); } if (e.key === 'ArrowLeft') { window.__seek(P.time - settings.skipBack); e.preventDefault(); } });
  }
  draw(force) {
    const el = this.el; if (!el.isConnected) { this.ro.disconnect(); return false; }
    const w = this.w || (this.w = el.clientWidth); if (!w) return true;
    const d = P.duration, now = P.dragTime ?? P.time, prog = d > 0 ? Math.min(1, Math.max(0, now / d)) : 0;
    const px = Math.round(prog * w * 2);             // redraw the canvas only when the played edge moves a half pixel
    const key = px + '|' + w + '|' + (window.__marksVer || 0) + '|' + settings.theme;
    if (force || key !== this.key) {
      this.key = key;
      const dpr = Math.min(2, devicePixelRatio || 1), c = this.c, h = this.h;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext('2d'), cs = getComputedStyle(document.documentElement);
      const col = window.__colors || (window.__colors = {});
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      g.fillStyle = col.base; g.fillRect(0, 0, w, h);
      g.fillStyle = col.accent; g.fillRect(0, 0, w * prog, h);
      if (d > 0) for (const m of window.__marks || []) {
        const x = w * m.from, mw = Math.max(2, w * (m.to - m.from));
        g.globalAlpha = m.a; g.fillStyle = col[m.k]; g.fillRect(x, 0, mw, h); g.globalAlpha = 1;
        g.fillStyle = col.bg; g.fillRect(x - 0.75, 0, 1.5, h); g.fillRect(x + mw - 0.75, 0, 1.5, h);
      }
    }
    this.head.style.transform = `translateX(${Math.min(Math.max(0, prog * w - 1.5), w - 3)}px)`;
    el.setAttribute('aria-valuetext', `${fmt(now)} of ${fmt(d)}`);
    return true;
  }
}
export function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  window.__colors = { base: v('--surface-strong'), accent: v('--accent'), bg: v('--bg'), music: v('--music'), trailer: v('--trailer'), ad: v('--ad') };
}
