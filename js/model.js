// Library, settings, positions — the app's state. Ported from Library.swift / Settings.swift.
import { ls, idb } from './store.js';
const T = self.PodenText;

// ---------- tiny observable ----------
const subs = new Map();
export function on(topic, fn) { if (!subs.has(topic)) subs.set(topic, new Set()); subs.get(topic).add(fn); return () => subs.get(topic).delete(fn); }
// Batched per frame; when the page is hidden (phone locked, other app) frames don't run, so a timer is used.
let queued = new Set(), raf = 0;
function flushEmit() { raf = 0; const q = queued; queued = new Set(); for (const t of q) for (const f of subs.get(t) || []) f(); for (const f of subs.get('*') || []) f(q); }
export function emit(topic) {
  queued.add(topic);
  if (!raf) raf = document.hidden ? setTimeout(flushEmit, 50) : requestAnimationFrame(flushEmit);
}

// ---------- settings ----------
export const MODES = { off: 0, suggest: 1, auto: 2 };
export const modeTitle = m => m === 2 ? 'Automatic' : m === 1 ? 'Suggest' : 'Off';
export const KINDS = ['music', 'trailer', 'ad', 'silence'];
export const noun = k => k === 'music' ? 'interlude' : k === 'trailer' ? 'extra' : k === 'ad' ? 'ad' : 'silence';
export const plural = k => k === 'silence' ? 'silence' : noun(k) + 's';
const DEF = { skipBack: 15, skipForward: 30, musicMode: 2, trailerMode: 2, adMode: 2, textScale: 1.15, skipSilence: false, autoDownload: 0,
  generateTranscripts: true, transcriptSize: 18, removePlayed: true, theme: 'classic', rate: 1, volume: 1, relay: '', hideHeard: false, npTab: 'transcript', miniTab: 'transcript', follow: true };
export const settings = Object.assign({}, DEF, ls.get('settings', {}));
if (['gamer', 'manga'].includes(settings.theme)) settings.theme = 'mono';
if (!['classic', 'girly', 'mono', 'cover'].includes(settings.theme)) settings.theme = 'classic';
export function set(k, v) { settings[k] = v; ls.set('settings', settings); emit('settings'); emit('settings.' + k); }
export const OPTIONS = { back: [5, 10, 15, 30, 45, 60], forward: [10, 15, 30, 45, 60, 90], downloads: [0, 1, 2, 3, 5, 10], scales: [1, 1.15, 1.3, 1.45], rates: [0.75, 1, 1.25, 1.5, 1.75, 2] };
export const scaleName = s => s <= 1 ? 'Small' : s <= 1.15 ? 'Default' : s <= 1.3 ? 'Large' : 'Larger';
export function mode(k) { return k === 'music' ? settings.musicMode : k === 'trailer' ? settings.trailerMode : k === 'ad' ? settings.adMode : (settings.skipSilence ? 2 : 0); }

// ---------- positions (last listened, recent order) ----------
const pos = ls.get('positions', { t: {}, recent: [] });
export const positions = {
  get: id => pos.t[id] || 0,
  set(id, t) {
    pos.t[id] = t;
    if (pos.recent[0] !== id) { pos.recent = pos.recent.filter(x => x !== id); pos.recent.unshift(id); if (pos.recent.length > 100) pos.recent.length = 100; }
    const keys = Object.keys(pos.t); if (keys.length > 600) { const keep = new Set(pos.recent.slice(0, 500)); for (const k of keys) if (!keep.has(k)) delete pos.t[k]; }
    ls.set('positions', pos);
  },
  recent: () => pos.recent,
  flush: () => ls.now('positions', pos),
};

// ---------- library ----------
export const lib = {
  podcasts: [],                  // loaded from IndexedDB at start
  heard: new Set(ls.get('heard', [])),
  prefs: ls.get('prefs', {}),
  upNext: ls.get('upNext', []),
  skipped: ls.get('skipped', {}),         // month → seconds (music, trailers, ads)
  skippedByKind: ls.get('skippedByKind', {}),
  validators: ls.get('validators', {}),
  results: [], busy: 0, error: null,
  byId: new Map(),               // episode id → episode
};
function reindex() { lib.byId = new Map(); for (const p of lib.podcasts) for (const e of p.episodes) lib.byId.set(e.id, e); }
export async function loadLibrary() {
  lib.podcasts = (await idb.get('kv', 'podcasts')) || [];
  reindex();
}
let saveT = 0;
function saveShows() { clearTimeout(saveT); saveT = setTimeout(() => (self.requestIdleCallback || setTimeout)(() => idb.set('kv', 'podcasts', lib.podcasts), { timeout: 2000 }), 400); }
addEventListener('pagehide', () => { if (saveT) idb.set('kv', 'podcasts', lib.podcasts); });
const saveMeta = () => { ls.set('prefs', lib.prefs); ls.set('upNext', lib.upNext); ls.set('skipped', lib.skipped); ls.set('skippedByKind', lib.skippedByKind); ls.set('validators', lib.validators); };

export const epId = (e, showId) => e.guid ? `${showId || e.podcastID || ''}#${e.guid}` : e.audioURL;
export const podcast = id => lib.podcasts.find(p => p.id === id);
export const isHeard = e => lib.heard.has(e.id);
export const unplayed = p => { let n = 0; for (const e of p.episodes) if (!lib.heard.has(e.id)) n++; return n; };
export const visible = p => settings.hideHeard ? p.episodes.filter(e => !lib.heard.has(e.id)) : p.episodes;
export const listFor = e => { const p = podcast(e.podcastID); return p ? visible(p) : [e]; };
export const showPrefs = e => (e && lib.prefs[e.podcastID]) || {};
export function setPrefs(id, f) { const p = { ...(lib.prefs[id] || {}) }; f(p); for (const k in p) if (p[k] === undefined) delete p[k]; lib.prefs[id] = p; saveMeta(); emit('prefs'); }
export function setHeard(eps, v) { for (const e of eps) v ? lib.heard.add(e.id) : lib.heard.delete(e.id); ls.set('heard', [...lib.heard]); emit('heard'); }
export function older(e) {
  const p = podcast(e.podcastID); if (!p) return [];
  const i = p.episodes.findIndex(x => x.id === e.id); if (i < 0) return [];
  const before = e.date ? p.episodes.filter(x => x.id !== e.id && x.date && x.date < e.date) : p.episodes.slice(i + 1);
  return before.filter(x => !lib.heard.has(x.id));
}
export const markPlayedUpTo = e => setHeard([e, ...older(e)], true);
export function inProgress() {
  const out = [];
  for (const id of pos.recent) { const e = lib.byId.get(id); if (e && !lib.heard.has(id) && positions.get(id) > 10) out.push(e); if (out.length >= 10) break; }
  return out;
}
export const isQueued = e => lib.upNext.some(x => x.id === e.id);
export function queue(e) { if (!isQueued(e)) { lib.upNext.push(e); saveMeta(); emit('queue'); } }
export function queueNext(e) { lib.upNext = [e, ...lib.upNext.filter(x => x.id !== e.id)]; saveMeta(); emit('queue'); }
export function dequeue(e) { lib.upNext = lib.upNext.filter(x => x.id !== e.id); saveMeta(); emit('queue'); }
export function moveQueue(i, d) { const j = i + d; if (j < 0 || j >= lib.upNext.length) return; const q = lib.upNext; [q[i], q[j]] = [q[j], q[i]]; saveMeta(); emit('queue'); }
export function clearQueue() { lib.upNext = []; saveMeta(); emit('queue'); }
export function popUpNext() { const e = lib.upNext.shift(); if (e) { saveMeta(); emit('queue'); } return e; }

const month = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
export function recordSkip(sec, kind) {
  if (!(sec > 0)) return; const m = month();
  (lib.skippedByKind[m] = lib.skippedByKind[m] || {})[kind] = (lib.skippedByKind[m][kind] || 0) + sec;
  if (kind !== 'silence') lib.skipped[m] = (lib.skipped[m] || 0) + sec;
  saveMeta(); emit('stats');
}
export const skippedThisMonth = () => lib.skipped[month()] || 0;
export const skippedTotal = () => Object.values(lib.skipped).reduce((a, b) => a + b, 0);
export const skippedKind = k => Object.values(lib.skippedByKind).reduce((a, m) => a + (m[k] || 0), 0);

// ---------- network ----------
// Most podcast hosts don't send CORS headers, so browsers can't read their feeds directly. Every fetch
// races the direct URL against CORS relays (your own relay from Settings first); the first valid answer
// wins and the rest are cancelled. The relay that worked is remembered per host, so the next fetch
// from that host goes straight to it.
const RELAYS = [
  u => `https://proxy.corsfix.com/?${u}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];
const own = u => settings.relay ? (settings.relay.includes('{url}') ? settings.relay.replace('{url}', encodeURIComponent(u)) : settings.relay + (settings.relay.endsWith('=') || settings.relay.endsWith('?') ? encodeURIComponent(u) : u)) : null;
const winners = ls.get('relayWins', {});
const hostOf = u => { try { return new URL(u).host; } catch (_) { return ''; } };
export function routes(url) {
  const all = [url, own(url), ...RELAYS.map(r => r(url))].filter(Boolean);
  const w = winners[hostOf(url)];
  if (w != null && all[w]) all.unshift(all.splice(w, 1)[0]);
  return all;
}
export async function fetchText(url, { headers, timeout = 15000, valid = t => t.length > 0 } = {}) {
  const all = routes(url), order = [url, own(url), ...RELAYS.map(r => r(url))].filter(Boolean);
  const ctls = all.map(() => new AbortController());
  const kill = setTimeout(() => ctls.forEach(c => c.abort()), timeout);
  const one = async (u, i) => {
    if (i > 0) await new Promise(r => setTimeout(r, i === 1 ? 0 : 250 * (i - 1)));   // stagger: don't hit every relay at once
    if (ctls[i].signal.aborted) throw 0;
    const res = await fetch(u, { headers: u === url ? headers : undefined, signal: ctls[i].signal, cache: 'no-store' });
    if (res.status === 304) return { status: 304 };
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if (!valid(text)) throw new Error('invalid');
    return { status: 200, text, etag: res.headers.get('etag'), modified: res.headers.get('last-modified'), via: order.indexOf(u) };
  };
  try {
    const r = await Promise.any(all.map(one));
    if (r.via >= 0 && winners[hostOf(url)] !== r.via) { winners[hostOf(url)] = r.via; ls.set('relayWins', winners); }
    return r;
  } catch (_) { throw new Error('unreachable'); }
  finally { clearTimeout(kill); ctls.forEach(c => c.abort()); }
}
const isFeed = t => /<rss[\s>]|<channel[\s>]|<feed[\s>]/i.test(t.slice(0, 4000));

// Feed text → show, parsed in the worker (a 4 MB, 950-episode feed takes ~50 ms there, 0 ms on the page).
let parseCall = null; export const setParser = f => parseCall = f;
async function parse(text, url) { return parseCall ? parseCall(text, url) : PodenText.parseFeedXML(text, url); }

// Apple's directory has CORS and every show: used when no route can read the feed itself.
async function viaItunes(url, itunesId) {
  let id = itunesId;
  if (!id) {
    const q = await fetch(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=50&term=${encodeURIComponent(hostOf(url).replace(/^(www|feeds?)\./, '').split('.')[0])}`).then(r => r.json()).catch(() => null);
    id = q?.results?.find(r => r.feedUrl === url)?.collectionId;
  }
  if (!id) throw new Error('not in directory');
  const j = await fetch(`https://itunes.apple.com/lookup?id=${id}&media=podcast&entity=podcastEpisode&limit=300`).then(r => r.json());
  return PodenText.itunesShow(j, url);
}
export async function loadShow(url, { artwork, itunesId, headers } = {}) {
  let r = null;
  try { r = await fetchText(url, { headers, valid: t => isFeed(t) }); } catch (_) {}
  if (r?.status === 304) return { unchanged: true };
  let p;
  if (r) p = await parse(r.text, url); else p = await viaItunes(url, itunesId);
  if (artwork) p.artworkURL = artwork;
  if (itunesId) p.itunesId = itunesId;
  return { show: stamp(p), etag: r?.etag, modified: r?.modified };
}
export function stamp(p) {
  p.id = p.feedURL;
  for (const e of p.episodes) { e.podcastID = p.id; e.podcastTitle = p.title; e.artworkURL = e.artworkURL || p.artworkURL; e.language = p.language; e.id = epId(e, p.id); }
  return p;
}

// Adding is optimistic: the show appears in the Library at once (from the directory result), and fills
// in when the feed arrives — no waiting on a spinner.
export const adding = new Map();          // feedURL → placeholder title
export async function addShow(url, artwork, itunesId, title) {
  url = url.trim();
  const ex = lib.podcasts.find(p => p.feedURL === url); if (ex) return ex;
  if (adding.has(url)) return null;
  adding.set(url, { title: title || hostOf(url), artwork }); lib.error = null; emit('library'); emit('busy');
  try {
    const { show } = await loadShow(url, { artwork, itunesId });
    if (!lib.podcasts.some(p => p.feedURL === url)) lib.podcasts.push(show);
    reindex(); saveShows(); saveMeta();
    return show;
  } catch (e) { lib.error = `Couldn’t load “${title || url}”`; return null; }
  finally { adding.delete(url); emit('library'); emit('busy'); }
}
export function adopt(p) { if (lib.podcasts.some(x => x.feedURL === p.feedURL)) return; lib.podcasts.push(stamp(p)); reindex(); saveShows(); emit('library'); }
export function removeShow(p) { lib.podcasts = lib.podcasts.filter(x => x.id !== p.id); lib.upNext = lib.upNext.filter(e => e.podcastID !== p.id); delete lib.prefs[p.id]; delete lib.validators[p.id]; reindex(); saveShows(); saveMeta(); emit('library'); emit('queue'); }

export async function refreshAll() {
  if (!lib.podcasts.length || !navigator.onLine) return;
  lib.busy++; emit('busy');
  const shows = lib.podcasts.slice(); let i = 0, changed = false;
  const worker = async () => {
    while (i < shows.length) {
      const p = shows[i++], v = lib.validators[p.id] || {};
      const h = {}; if (v.etag) h['If-None-Match'] = v.etag; if (v.modified) h['If-Modified-Since'] = v.modified;
      try {
        const r = await loadShow(p.feedURL, { artwork: p.artworkURL, itunesId: p.itunesId, headers: h });
        if (r.unchanged) continue;
        const fresh = r.show, k = lib.podcasts.findIndex(x => x.id === p.id);
        if (k >= 0 && (fresh.episodes.length !== p.episodes.length || fresh.episodes[0]?.id !== p.episodes[0]?.id || fresh.title !== p.title)) {
          if (fresh.partial && !p.partial) continue;          // never replace a full feed with the directory's shorter list
          lib.podcasts[k] = fresh; changed = true;
        }
        lib.validators[p.id] = { etag: r.etag, modified: r.modified };
      } catch (_) {}
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (changed) { reindex(); saveShows(); emit('library'); }
  saveMeta();
  lib.busy--; emit('busy');
}

let searchSeq = 0;
export async function search(term) {
  const my = ++searchSeq;
  lib.busy++; lib.error = null; emit('busy');
  try {
    const j = await fetch(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=40&term=${encodeURIComponent(term)}`).then(r => r.json());
    if (my !== searchSeq) return;
    lib.results = (j.results || []).filter(x => x.feedUrl);
    if (!lib.results.length) lib.error = `No shows found for “${term}”`;
  } catch (_) { if (my === searchSeq) { lib.error = navigator.onLine ? 'Search failed — try again' : 'You’re offline'; lib.results = []; } }
  finally { lib.busy--; emit('busy'); emit('search'); }
}

export async function importOPML(text, onProgress) {
  const feeds = PodenText.opmlFeeds(text).filter(f => !lib.podcasts.some(p => p.feedURL === f.url));
  let added = 0, failed = 0, i = 0;
  const failedNames = [];
  const w = async () => { while (i < feeds.length) { const f = feeds[i++]; (await addShow(f.url, null, null, f.title)) ? added++ : (failed++, failedNames.push(f.title || f.url)); onProgress?.(added + failed, feeds.length); } };
  await Promise.all(Array.from({ length: 6 }, w));
  return { added, failed, total: feeds.length, failedNames };
}

// ---------- import a Mac-app library export (Poden+ for Mac → "poden-export.json") ----------
export async function importBackup(obj) {
  if (Array.isArray(obj.shows)) for (const s of obj.shows) { const p = { ...s, episodes: (s.episodes || []).map(e => ({ ...e, date: typeof e.date === 'number' ? (e.date < 2e10 ? (e.date + 978307200) * 1000 : e.date) : e.date ? Date.parse(e.date) : null })) }; if (!lib.podcasts.some(x => x.feedURL === p.feedURL)) lib.podcasts.push(stamp(p)); }
  if (obj.heard) for (const h of obj.heard) lib.heard.add(h);
  if (obj.positions?.t) { Object.assign(pos.t, obj.positions.t); pos.recent = [...new Set([...(obj.positions.recent || []), ...pos.recent])].slice(0, 100); ls.set('positions', pos); }
  const m = obj.meta || {};
  if (m.prefs) Object.assign(lib.prefs, m.prefs);
  if (m.skipped) for (const [k, v] of Object.entries(m.skipped)) lib.skipped[k] = Math.max(lib.skipped[k] || 0, v);
  if (m.skippedByKind) for (const [k, v] of Object.entries(m.skippedByKind)) lib.skippedByKind[k] = { ...(lib.skippedByKind[k] || {}), ...v };
  if (m.upNext) for (const e of m.upNext) if (!isQueued(e)) lib.upNext.push(e);
  if (obj.settings) for (const [k, v] of Object.entries(obj.settings)) if (k in DEF) settings[k] = v;
  ls.set('settings', settings); ls.set('heard', [...lib.heard]); reindex(); saveMeta(); ls.flush();
  const jobs = [idb.set('kv', 'podcasts', lib.podcasts)];
  for (const [id, a] of Object.entries(obj.analyses || {})) jobs.push(idb.set('analysis', id, a));
  for (const [id, t] of Object.entries(obj.transcripts || {})) jobs.push(idb.set('transcripts', id, t));
  await Promise.all(jobs);
  emit('library'); emit('heard'); emit('settings'); emit('queue'); emit('stats');
}
export function exportBackup() {
  return { app: 'Poden+', version: 1, shows: lib.podcasts, heard: [...lib.heard], positions: pos, meta: { prefs: lib.prefs, upNext: lib.upNext, skipped: lib.skipped, skippedByKind: lib.skippedByKind }, settings };
}
