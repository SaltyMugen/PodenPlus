// Player — one <audio> element, skip logic ported from Player.swift. Media Session gives lock-screen /
// Control Centre / notification controls, so playback carries on when the phone leaves the browser.
import { settings, set, positions, lib, showPrefs, setPrefs, setHeard, popUpNext, recordSkip, emit, noun, OPTIONS } from './model.js';
import * as A from './analyzer.js';
import { audioKey } from './store.js';

const au = new Audio();
au.preload = 'auto'; au.crossOrigin = null; au.setAttribute('playsinline', ''); au.setAttribute('webkit-playsinline', '');
document.documentElement.appendChild(au); au.style.display = 'none';
au.preservesPitch = true;

export const P = {
  au, episode: null, queue: [], isPlaying: false, time: 0, duration: 0, dragTime: null, seeking: false,
  rate: settings.rate, volume: settings.volume, notice: null, lastSkip: null, suggestion: null, listening: new Set(),
  sleepAt: null, sleepAtEnd: false, silenceSaved: 0, armed: [], reachA: [], reachS: [], autoSpans: [], armedFor: null, loadingSrc: false,
};
au.volume = P.volume;
let lastSave = 0, objectURL = null;

// ---------- load / play ----------
export async function play(e, list, at) {
  if (list) P.queue = list;
  if (!P.queue.some(x => x.id === e.id)) P.queue = [e];
  if (P.episode?.id === e.id) { if (at != null) { seek(at); if (!P.isPlaying) toggle(); } else toggle(); return; }
  await load(e, at);
  startPlaying();
}
function startPlaying() {
  const p = au.play(); P.isPlaying = true; emit('play');
  if (p) p.catch(err => { if (err.name === 'NotAllowedError') { P.isPlaying = false; emit('play'); } });
}
async function load(e, at) {
  savePosition();
  P.episode = e; P.notice = null; P.listening = new Set(); P.suggestion = null; P.silenceSaved = 0; P.lastSkip = null;
  P.time = at ?? positions.get(e.id); P.duration = e.duration || A.analysis(e.id).duration || 0;
  const r = showPrefs(e).speed; P.rate = r || settings.rate;
  if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
  let src = e.audioURL;
  if (A.isDownloaded(e)) {
    // Service worker streams the cached file with range support; fall back to a blob URL without one.
    if (navigator.serviceWorker?.controller) src = audioKey(e.id);
    else { const c = await caches.open('poden-audio'), r2 = await c.match(audioKey(e.id)); if (r2) src = objectURL = URL.createObjectURL(await r2.blob()); }
  }
  au.src = src;
  au.playbackRate = P.rate; au.defaultPlaybackRate = P.rate;
  if (P.time > 1) { const t = P.time; const go = () => { try { au.currentTime = t; } catch (_) {} }; au.readyState >= 1 ? go() : au.addEventListener('loadedmetadata', go, { once: true }); }
  ls('lastEpisode', e); ls('lastQueue', P.queue.slice(0, 50));
  A.transcript(e);
  rearm(); A.prioritize(e);
  mediaMeta(); emit('episode'); emit('time');
  setTimeout(() => A.prepareAhead(P), 0);
}
function ls(k, v) { try { localStorage.setItem('p.' + k, JSON.stringify(v)); } catch (_) {} }
export function restore() {
  try {
    const e = JSON.parse(localStorage.getItem('p.lastEpisode') || 'null'); if (!e) return;
    const fresh = lib.byId.get(e.id) || e;
    P.queue = (JSON.parse(localStorage.getItem('p.lastQueue') || 'null') || [fresh]).map(x => lib.byId.get(x.id) || x);
    load(fresh);
  } catch (_) {}
}

export function toggle() {
  if (!P.episode) return;
  if (au.paused) startPlaying(); else { au.pause(); P.isPlaying = false; emit('play'); }
  savePosition(); mediaState();
}
export function pause() { if (!au.paused) toggle(); }
const index = () => P.queue.findIndex(x => x.id === P.episode?.id);
export const hasNext = () => lib.upNext.length > 0 || (index() >= 0 && index() + 1 < P.queue.length);
export function next() {
  const q = popUpNext(); if (q) { play(q, [q, ...P.queue.filter(x => x.id !== q.id)]); return; }
  const i = index(); if (i >= 0 && i + 1 < P.queue.length) play(P.queue[i + 1]);
}
export function previous() { const i = index(); if (P.time > 3 || i <= 0) { seek(0); return; } play(P.queue[i - 1]); }
export const back = () => seek(P.time - settings.skipBack);
export const forward = () => seek(P.time + settings.skipForward);

export function seek(t, exact = true, done) {
  t = Math.max(0, P.duration > 0 ? Math.min(t, P.duration - 0.25) : t);
  P.time = t; P.seeking = true; emit('time');
  const finish = () => { P.seeking = false; savePosition(); mediaPos(); done?.(); skipIfInside(P.time); };
  if (au.readyState < 1) { au.addEventListener('loadedmetadata', () => { au.currentTime = t; }, { once: true }); P.seeking = false; return; }
  if (!exact && au.fastSeek) au.fastSeek(t); else au.currentTime = t;
  let doneOnce = false; const f = () => { if (doneOnce) return; doneOnce = true; finish(); };
  au.addEventListener('seeked', f, { once: true }); setTimeout(f, 1200);
}

export function setRate(r, forShow = false) {
  P.rate = r; au.playbackRate = r; au.defaultPlaybackRate = r;
  if (!forShow) set('rate', r);
  mediaPos(); emit('rate'); emit('time');
}
export const faster = () => { const r = OPTIONS.rates.find(x => x > P.rate); if (r) applyRate(r); };
export const slower = () => { const r = [...OPTIONS.rates].reverse().find(x => x < P.rate); if (r) applyRate(r); };
export function applyRate(r) { const id = P.episode?.podcastID, pinned = id && lib.prefs[id]?.speed != null; setRate(r, pinned); if (pinned) setPrefs(id, p => p.speed = r); }
export function setVolume(v) { P.volume = Math.min(1, Math.max(0, v)); au.volume = P.volume; set('volume', P.volume); emit('volume'); }

// ---------- sleep ----------
export function sleep(min) { P.sleepAtEnd = false; P.sleepAt = Date.now() + min * 60000; emit('sleep'); }
export function sleepAtEnd() { P.sleepAt = null; P.sleepAtEnd = true; emit('sleep'); }
export function cancelSleep() { P.sleepAt = null; P.sleepAtEnd = false; emit('sleep'); }
export const sleepRemaining = () => P.sleepAt ? Math.max(0, (P.sleepAt - Date.now()) / 1000) : null;

// ---------- sections / modes ----------
export function sections(k) {
  if (!P.episode) return [];
  const a = A.analysis(P.episode.id);
  return (k === 'music' ? a.music : k === 'trailer' ? a.trailers : k === 'ad' ? a.ads : a.silence) || [];
}
export function mode(s, k) {
  const e = P.episode; if (!e || P.listening.has(s.start)) return 0;
  const sp = showPrefs(e);
  if (k === 'music' && sp.keepIntro && s.start < 120) return 0;
  const o = k === 'music' ? sp.music : k === 'trailer' ? sp.trailers : k === 'ad' ? sp.ads : null;
  return o ?? (k === 'music' ? settings.musicMode : k === 'trailer' ? settings.trailerMode : k === 'ad' ? settings.adMode : 0);
}
export function rearm() {
  P.armed = [];
  const e = P.episode; if (!e) { P.autoSpans = []; return; }
  for (const k of ['music', 'trailer', 'ad']) for (const s of sections(k)) { const m = mode(s, k); if (m) P.armed.push({ start: s.start, end: s.end, kind: k, suggest: m === 1 }); }
  if (settings.skipSilence) for (const s of sections('silence')) if (s.end - s.start - 0.4 > 0.3) P.armed.push({ start: s.start + 0.25, end: s.end - 0.15, kind: 'silence', suggest: false });
  P.armed.sort((a, b) => a.start - b.start);
  let a = -1, s = -1; P.reachA = []; P.reachS = [];
  P.armed.forEach((x, i) => { if (x.suggest) { if (s < 0 || P.armed[s].end < x.end) s = i; } else if (a < 0 || P.armed[a].end < x.end) a = i; P.reachA.push(a); P.reachS.push(s); });
  P.autoSpans = PodenDetect.merge(P.armed.filter(x => !x.suggest), 0);
  P.armedFor = e.id;
  if (P.suggestion && !P.armed.some(x => x.start === P.suggestion.start && x.suggest)) P.suggestion = null;
  emit('marks');
  skipIfInside(P.time);
}
function covering(t, auto) {
  const reach = auto ? P.reachA : P.reachS, arr = P.armed;
  let lo = 0, hi = arr.length - 1, hit = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].start <= t + 0.05) { hit = m; lo = m + 1; } else hi = m - 1; }
  if (hit < 0) return null; const i = reach[hit]; if (i < 0) return null;
  return t < arr[i].end - 0.3 ? arr[i] : null;
}
let fading = 0;
function skipIfInside(t) {
  if (!P.isPlaying || P.seeking || P.episode?.id !== P.armedFor || !P.armed.length) return;
  const s = covering(t, true) || covering(t, false); if (!s) return;
  if (s.suggest) {
    if (P.suggestion?.start === s.start) return;
    P.suggestion = { start: s.start, end: s.end, kind: s.kind }; emit('notice'); return;
  }
  const skipped = s.end - t; recordSkip(skipped, s.kind);
  if (s.kind === 'silence') { P.silenceSaved += skipped; seek(s.end, false); emit('info'); return; }
  // Dip, jump, bring back — no click, no half word. A newer fade always wins.
  P.seeking = true; const id = ++fading, from = au.volume;
  fade(from, 0, 140, id, () => seek(s.end, true, () => fade(0, P.volume, 160, id)));
  P.lastSkip = { start: s.start, end: s.end };
  flash(`Skipped ${Math.round(skipped)}s of ${noun(s.kind)}`, 6000, () => { P.lastSkip = null; });
}
function fade(from, to, ms, id, then) {
  const t0 = performance.now();
  const step = () => { if (id !== fading) return; const k = Math.min(1, (performance.now() - t0) / ms); au.volume = from + (to - from) * k; if (k < 1) setTimeout(step, 16); else then?.(); };
  // setTimeout, not rAF: keeps working with the page hidden (phone in pocket).
  step();
}
let flashT = 0;
function flash(text, ms, then) { P.notice = text; emit('notice'); clearTimeout(flashT); flashT = setTimeout(() => { if (P.notice === text) { P.notice = null; emit('notice'); then?.(); } }, ms); }
export const announce = t => flash(t, 4000);
export function undoSkip() { const s = P.lastSkip; if (!s) return; P.lastSkip = null; P.notice = null; listen(s); }
export function listen(s) { P.listening.add(s.start); rearm(); seek(s.start); if (!P.isPlaying) toggle(); }
export function acceptSuggestion() {
  const s = P.suggestion; if (!s) return; P.suggestion = null;
  const skipped = Math.max(0, s.end - P.time); seek(s.end); P.lastSkip = { start: s.start, end: s.end }; recordSkip(skipped, s.kind);
  flash(`Skipped ${Math.round(skipped)}s of ${noun(s.kind)}`, 6000, () => { P.lastSkip = null; });
}
export function dismissSuggestion() { const s = P.suggestion; if (!s) return; P.suggestion = null; P.listening.add(s.start); rearm(); emit('notice'); }

// ---------- speed-adjusted time ----------
export const real = s => s / Math.max(0.1, P.rate);
export function remainingReal() {
  const now = P.dragTime ?? P.time; if (!(P.duration > 0)) return 0;
  let up = 0; for (const s of P.autoSpans) if (s.end > now) up += s.end - Math.max(s.start, now);
  return real(Math.max(0, P.duration - now - up));
}
export function durationReal() { if (!(P.duration > 0)) return 0; return real(Math.max(0, P.duration - P.autoSpans.reduce((a, s) => a + s.end - s.start, 0))); }

// ---------- audio events ----------
au.addEventListener('timeupdate', () => {
  if (P.seeking) return;
  const t = au.currentTime; if (!isFinite(t)) return;
  P.time = t;
  if (P.isPlaying) {
    skipIfInside(t);
    if (P.suggestion && (t >= P.suggestion.end || t < P.suggestion.start - 1)) { P.suggestion = null; emit('notice'); }
    if (Date.now() - lastSave > 5000) { savePosition(); mediaPos(); }
    if (P.sleepAt && Date.now() >= P.sleepAt) { cancelSleep(); toggle(); }
  }
  emit('time');
});
// Between timeupdates (≈4 Hz) a precise timer catches section starts exactly, like the Mac's boundary observer.
let bT = 0;
function armBoundary() {
  clearTimeout(bT); if (!P.isPlaying || !P.armed.length) return;
  const t = au.currentTime, arr = P.armed;
  let lo = 0, hi = arr.length - 1, nx = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].start > t + 0.05) { nx = m; hi = m - 1; } else lo = m + 1; }
  if (nx < 0) return;
  const wait = (arr[nx].start - t) / Math.max(0.1, au.playbackRate) * 1000;
  if (wait < 30000) bT = setTimeout(() => { skipIfInside(au.currentTime); armBoundary(); }, Math.max(10, wait + 20));
}
au.addEventListener('playing', armBoundary); au.addEventListener('seeked', armBoundary); au.addEventListener('ratechange', armBoundary);
au.addEventListener('durationchange', () => { if (isFinite(au.duration) && au.duration > 0) { P.duration = au.duration; emit('time'); mediaPos(); } });
au.addEventListener('play', () => { P.isPlaying = true; emit('play'); mediaState(); });
au.addEventListener('pause', () => { if (!P.seeking && !au.ended) { P.isPlaying = false; emit('play'); savePosition(); mediaState(); } });
au.addEventListener('ended', () => {
  const e = P.episode; if (!e) return;
  positions.set(e.id, 0); setHeard([e], true); A.removePlayed();
  if (P.sleepAtEnd) { cancelSleep(); P.isPlaying = false; emit('play'); mediaState(); return; }
  if (hasNext()) next(); else { P.isPlaying = false; emit('play'); mediaState(); }
});
au.addEventListener('error', () => { if (P.episode && au.src.includes('/__audio/') && !P.fallbackTried) { P.fallbackTried = true; const t = P.time; au.src = P.episode.audioURL; au.currentTime = t; if (P.isPlaying) au.play().catch(() => {}); } });
au.addEventListener('loadstart', () => { P.fallbackTried = false; });
A.onUpdate.add(id => { if (id === P.episode?.id) rearm(); });

function savePosition() { lastSave = Date.now(); if (P.episode && P.time > 0) positions.set(P.episode.id, P.time); }
addEventListener('pagehide', () => { savePosition(); positions.flush(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { savePosition(); positions.flush(); } });

// ---------- Media Session (lock screen, Control Centre, headphones, notification) ----------
const ms = navigator.mediaSession;
function mediaMeta() {
  if (!ms || !P.episode) return;
  const e = P.episode, art = e.artworkURL ? [{ src: e.artworkURL, sizes: '512x512' }] : [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }];
  try { ms.metadata = new MediaMetadata({ title: e.title, artist: e.podcastTitle || '', album: 'Poden+', artwork: art }); } catch (_) {}
}
function mediaState() { if (ms) ms.playbackState = P.isPlaying ? 'playing' : 'paused'; mediaPos(); }
function mediaPos() { if (!ms?.setPositionState || !(P.duration > 0)) return; try { ms.setPositionState({ duration: P.duration, position: Math.min(P.time, P.duration), playbackRate: P.rate }); } catch (_) {} }
if (ms) {
  const h = (a, f) => { try { ms.setActionHandler(a, f); } catch (_) {} };
  h('play', () => { if (au.paused) toggle(); }); h('pause', () => { if (!au.paused) toggle(); });
  h('seekbackward', d => seek(P.time - (d?.seekOffset || settings.skipBack)));
  h('seekforward', d => seek(P.time + (d?.seekOffset || settings.skipForward)));
  h('previoustrack', previous); h('nexttrack', () => { if (hasNext()) next(); else forward(); });
  h('seekto', d => { if (d.fastSeek && au.fastSeek) au.fastSeek(d.seekTime); seek(d.seekTime); });
  h('stop', () => pause());
}
export { mediaMeta };
