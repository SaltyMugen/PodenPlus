// Analyzer (page side): queues episodes, fetches audio, hands work to the worker, stores results.
// Downloads (Cache Storage) and chapters also live here — they share the audio fetch.
import { idb, ls, AUDIO_CACHE, audioKey } from './store.js';
import { lib, settings, emit, podcast, isHeard, inProgress, fetchText, routes, setParser } from './model.js';
const T = self.PodenText;

// ---------- worker ----------
let worker, seq = 0; const calls = new Map();
function w() {
  if (worker) return worker;
  worker = new Worker('./js/worker.js');
  worker.onmessage = e => { const m = e.data, c = calls.get(m.id); if (!c) return; if ('progress' in m) { c.onp?.(m.progress); return; } calls.delete(m.id); m.ok ? c.res(m.result) : c.rej(new Error(m.error)); };
  worker.onerror = e => { for (const c of calls.values()) c.rej(new Error('worker')); calls.clear(); worker = null; };
  return worker;
}
setParser((text, url) => call('feed', { text, url }));
export function call(type, data, transfer = [], onp) { const id = ++seq; return new Promise((res, rej) => { calls.set(id, { res, rej, onp }); w().postMessage({ ...data, type, id }, transfer); }); }

// ---------- state ----------
export const an = {
  analyses: new Map(),        // id → analysis
  transcripts: new Map(),     // id → transcript (raw)
  timed: new Map(),           // id → reading model
  chapters: new Map(),        // id → [{start,title}]
  autoChapters: new Map(),    // id → [{start,title}] made here
  status: new Map(),          // id → "Scanning audio 40%"
  index: new Map(),           // id → { l: [folded lines], s: [starts] }
  downloads: new Map(ls.get('downloads', [])),   // id → { size, date }
  progress: new Map(),        // id → 0..1 while downloading
  blocked: new Set(),         // ids whose host blocks web pages from reading the audio
};
const saveDownloads = () => ls.set('downloads', [...an.downloads]);
export const analysis = id => an.analyses.get(id) || { music: [], trailers: [], ads: [], silence: [], repeats: [], scanned: false };
const CURRENT = 5;
export const upToDate = id => { const a = an.analyses.get(id); return !!(a && a.scanned && a.version >= CURRENT); };

export async function loadAll() {
  const [a, c, ix] = await Promise.all([idb.all('analysis'), idb.all('chapters'), idb.get('kv', 'index')]);
  an.analyses = a;
  for (const [k, v] of c) (v.auto ? an.autoChapters : an.chapters).set(k, v.list);
  if (ix) an.index = new Map(ix);
  emit('analysis');
}
let ixT = 0; const saveIndex = () => { clearTimeout(ixT); ixT = setTimeout(() => idb.set('kv', 'index', [...an.index]), 1000); };

// Transcripts are big: loaded on demand, parsed into the reading model in the worker.
const loadingT = new Map();
export function transcript(e) {
  if (an.transcripts.has(e.id)) return an.transcripts.get(e.id);
  if (!loadingT.has(e.id)) loadingT.set(e.id, (async () => {
    let t = await idb.get('transcripts', e.id);
    if (!t && e.transcriptURL) t = await fetchPublished(e);
    if (t) { an.transcripts.set(e.id, t); await buildTimed(e.id, t); if (!an.index.has(e.id)) { an.index.set(e.id, T.indexLines(t)); saveIndex(); } emit('transcript'); }
    else an.transcripts.set(e.id, null);
  })());
  return undefined;
}
async function buildTimed(id, t) { an.timed.set(id, t.lines.length > 400 ? await call('timed', { transcript: t }) : T.timed(t)); }
async function fetchPublished(e) {
  try {
    const r = await fetchText(e.transcriptURL); let lines = [];
    if (/json/.test(e.transcriptType) || r.text.trim().startsWith('{')) lines = T.parseTranscriptJSON(JSON.parse(r.text));
    else if (/vtt|srt|subrip/.test(e.transcriptType) || r.text.includes('-->')) lines = T.parseCues(r.text);
    else lines = T.plain(r.text).split(/\n+/).filter(Boolean).map(text => ({ start: -1, end: -1, text }));
    if (!lines.length) return null;
    const t = { lines, generated: false };
    await idb.set('transcripts', e.id, t);
    return t;
  } catch (_) { return null; }
}
export async function storeTranscript(id, t) {
  an.transcripts.set(id, t); await idb.set('transcripts', id, t); await buildTimed(id, t);
  an.index.set(id, T.indexLines(t)); saveIndex(); emit('transcript');
}

// ---------- chapters: published JSON › show-note timestamps › automatic ----------
const loadingC = new Set();
export function chapters(e) {
  if (an.chapters.has(e.id)) return an.chapters.get(e.id);
  if (e.chaptersURL && !loadingC.has(e.id)) {
    loadingC.add(e.id);
    fetchText(e.chaptersURL).then(r => {
      const d = JSON.parse(r.text), list = (d.chapters || []).filter(c => c.toc !== false).map(c => ({ start: +c.startTime || 0, title: c.title || 'Chapter' })).sort((a, b) => a.start - b.start);
      if (list.length) { an.chapters.set(e.id, list); idb.set('chapters', e.id, { list }); emit('chapters'); }
    }).catch(() => {});
  }
  const notes = noteChapters(e);
  if (notes.length >= 2 || e.chaptersURL) return notes;
  return an.autoChapters.get(e.id) || [];
}
const noteCache = new Map();
function noteChapters(e) { let c = noteCache.get(e.id); if (!c) { c = T.noteChapters(e.summary); noteCache.set(e.id, c); } return c; }
export const isAutoChapters = e => !an.chapters.has(e.id) && !e.chaptersURL && noteChapters(e).length < 2 && an.autoChapters.has(e.id);
export function currentChapter(list, t) { let i = -1; for (let k = 0; k < list.length; k++) if (list[k].start <= t + 0.25) i = k; else break; return i < 0 ? null : i; }

// ---------- scanning queue ----------
const queue = []; let running = false;
export const onUpdate = new Set();
export function prioritize(e) { if (!e) return; const i = queue.findIndex(x => x.id === e.id); if (i >= 0) queue.splice(i, 1); if (needsWork(e)) { queue.unshift(e); pump(); } }
export function enqueue(e) { if (!queue.some(x => x.id === e.id) && needsWork(e)) { queue.push(e); pump(); } }
export function prepare(list) { for (const e of list.slice(0, 3)) enqueue(e); }
const noScan = new Set();
function needsWork(e) { if (noScan.has(e.id) && !settings.relay) return false; return !upToDate(e.id) || (an.transcripts.get(e.id) == null && !analysis(e.id).transcriptTried && e.transcriptURL); }

async function pump() {
  if (running || !queue.length) return;
  running = true;
  const e = queue.shift();
  try { await process(e); } catch (err) { an.lastError = String(err && (err.stack || err.message || err)); console.warn('Poden scan failed:', an.lastError); an.status.set(e.id, 'Couldn’t scan'); emit('status'); setTimeout(() => { an.status.delete(e.id); emit('status'); }, 4000); }
  running = false;
  setTimeout(pump, 50);
}
const setStatus = (id, s) => { s ? an.status.set(id, s) : an.status.delete(id); emit('status'); };

async function process(e) {
  const id = e.id;
  if (transcript(e) === undefined) await loadingT.get(id);
  let a = { ...analysis(id) };
  if (!upToDate(id)) {
    setStatus(id, 'Fetching audio to scan');
    const buf = await audioBuffer(e, p => setStatus(id, `Fetching audio ${Math.round(p * 100)}%`));
    if (!buf) {
      // This host doesn't let web pages read its audio (it still plays fine). Remember it so we don't
      // retry on every play; a relay in Settings, or a Mac library import, brings the scan.
      noScan.add(e.id); setStatus(id, null); an.blocked.add(id); emit('status'); return;
    }
    setStatus(id, 'Scanning audio');
    let r;
    const onp = p => setStatus(id, `Scanning audio ${Math.round(p * 100)}%`);
    const dur = e.duration || 0;
    try { r = await call('scan', { buffer: buf, duration: dur }, [buf], onp); }
    catch (err) {
      if (!/no-worker-decode/.test(err.message)) throw err;
      // Older Safari: decode on the page in pieces (native decoder), scan in the worker.
      r = await decodeHere(await audioBuffer(e), dur, onp);
    }
    a = { ...a, music: r.music, trailers: r.trailers, silence: r.silence, scanned: true, version: CURRENT, duration: r.duration };
    const tr = an.transcripts.get(id);
    const wantAuto = !!(tr && !e.chaptersURL && noteChapters(e).length < 2);
    const post = await call('post', { analysis: a, transcript: tr || null, duration: r.duration, wantChapters: wantAuto });
    a = post.analysis;
    if (post.chapters?.length) { an.autoChapters.set(id, post.chapters); idb.set('chapters', id, { list: post.chapters, auto: true }); emit('chapters'); }
    // repeats: compare with this show's recent fingerprints
    await repeats(e, r.fingerprint, a);
  } else if (an.transcripts.get(id) && (a.adsVersion || 0) < 3) {
    const post = await call('post', { analysis: a, transcript: an.transcripts.get(id) });
    a = post.analysis;
  }
  a.transcriptTried = true;
  an.analyses.set(id, a); await idb.set('analysis', id, a);
  setStatus(id, null);
  emit('analysis'); for (const f of onUpdate) f(id);
}

async function repeats(e, fp, a) {
  const show = e.podcastID; if (!show || !fp?.length) return;
  const idxKey = 'show:' + show;
  const recent = ((await idb.get('fingerprints', idxKey)) || []).filter(x => x !== e.id);
  const others = {};
  for (const oid of recent.slice(0, 6)) { const f = await idb.get('fingerprints', oid); if (f) others[oid] = f; }
  if (Object.keys(others).length) {
    const res = await call('repeats', { fp: fp.buffer.slice(0), others });
    const mine = [];
    for (const [oid, reps] of Object.entries(res)) {
      for (const r of reps) mine.push(r.a);
      const oa = an.analyses.get(oid);
      if (oa && oa.scanned) { const na = PodenDetect.applyRepeats(oa, reps.map(r => r.b)); an.analyses.set(oid, na); idb.set('analysis', oid, na); for (const f of onUpdate) f(oid); }
    }
    Object.assign(a, PodenDetect.applyRepeats(a, mine));
  }
  await idb.set('fingerprints', e.id, fp.buffer);
  const ids = [e.id, ...recent];
  for (const old of ids.slice(12)) idb.del('fingerprints', old);
  await idb.set('fingerprints', idxKey, ids.slice(0, 12));
}

// Decode on the page (browsers without OfflineAudioContext in workers, e.g. Safari) in ~12 MB pieces
// cut at MP3 frame starts; each piece goes to the worker as 16 kHz mono and is released. A piece that
// won't decode is replaced by silence of the same length, so one bad frame never loses the whole scan.
async function decodeHere(buf, dur, onp) {
  const Ctx = self.OfflineAudioContext || self.webkitOfflineAudioContext, SR = 16000;
  await call('begin', { duration: dur });
  const cuts = mp3Cuts(new Uint8Array(buf));
  // One decoding context for every piece (WebKit caps how many can exist). decodeAudioData resamples to
  // the context's rate, so asking for 16 kHz mono gives the scan's input directly — no second render pass.
  const ctx = new Ctx(1, 1, SR);
  const dec = ab => new Promise((res, rej) => { try { const p = ctx.decodeAudioData(ab, res, e => rej(e || new Error('decode'))); if (p && p.then) p.then(res, e => rej(e || new Error('decode'))); } catch (e) { rej(e); } });
  let bytesPerSec = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    let pcm;
    try {
      const audio = await dec(buf.slice(cuts[i], cuts[i + 1]));
      bytesPerSec = (cuts[i + 1] - cuts[i]) / audio.duration;
      pcm = audio.getChannelData(0);
      if (audio.numberOfChannels > 1) { pcm = pcm.slice(); const r = audio.getChannelData(1); for (let k = 0; k < pcm.length; k++) pcm[k] = (pcm[k] + r[k]) * 0.5; }
      else pcm = pcm.slice();
    } catch (_) { pcm = new Float32Array(Math.round((cuts[i + 1] - cuts[i]) / (bytesPerSec || 16000) * SR)); }
    await call('push', { pcm }, [pcm.buffer]);
    onp?.(0.05 + 0.9 * cuts[i + 1] / buf.byteLength);
  }
  return call('finish', {});
}
// Piece boundaries at real MP3 frame headers (checked by frame length → next header), ~12 MB apart.
function mp3Cuts(u) {
  const n = u.length, CH = 12 << 20, cuts = [0];
  const mp3 = (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) || (u[0] === 0xff && (u[1] & 0xe0) === 0xe0);
  if (!mp3 || n < CH * 1.5) return [0, n];
  const BR = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], SRS = [44100, 48000, 32000];
  const frameLen = k => { const b1 = u[k + 1], b2 = u[k + 2]; if (u[k] !== 0xff || (b1 & 0xe0) !== 0xe0) return 0; const ver = (b1 >> 3) & 3, layer = (b1 >> 1) & 3; if (ver === 1 || layer !== 1) return 0; const bi = b2 >> 4, si = (b2 >> 2) & 3; if (!bi || bi === 15 || si === 3) return 0; const v1 = ver === 3, br = (v1 ? BR[bi] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160][bi]) * 1000, sr = SRS[si] / (ver === 3 ? 1 : ver === 2 ? 2 : 4); return Math.floor((v1 ? 144 : 72) * br / sr) + ((b2 >> 1) & 1); };
  for (let o = CH; o < n - CH / 2; o += CH) {
    for (let k = o, lim = Math.min(n - 8, o + 262144); k < lim; k++) { const L = frameLen(k); if (L > 20 && k + L < n - 4 && frameLen(k + L) > 20) { cuts.push(k); break; } }
  }
  cuts.push(n);
  return cuts;
}

// ---------- audio: downloaded copy, or fetch to scan ----------
async function audioBuffer(e, onp) {
  const c = await caches.open(AUDIO_CACHE), hit = await c.match(audioKey(e.id));
  if (hit) return hit.arrayBuffer();
  if (!navigator.onLine) return null;
  try { const r = await fetchAudio(e.audioURL, onp); return r ? await r.blob().then(b => b.arrayBuffer()) : null; } catch (_) { return null; }
}
async function fetchAudio(url, onp, signal) {
  // Audio: direct first (most CDNs allow it), then your own relay. Public relays cap file sizes, so
  // they're only used for small files.
  const tries = routes(url).filter((u, i) => i === 0 || u === url || (settings.relay && !/corsfix|codetabs|allorigins/.test(u)));
  if (!tries.includes(url)) tries.unshift(url);
  for (const u of tries) {
    try {
      const res = await fetch(u, { signal, mode: 'cors' });
      if (res.type === 'opaque') continue;
      if (!res.ok) continue;
      const len = +res.headers.get('content-length') || 0;
      if (!onp || !res.body || !len) return res;
      const reader = res.body.getReader(), parts = []; let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onp(Math.min(1, got / len)); }
      return new Response(new Blob(parts, { type: res.headers.get('content-type') || 'audio/mpeg' }));
    } catch (err) { if (signal?.aborted) throw err; }
  }
  return null;
}

// ---------- downloads ----------
const active = new Map(); const dlQueue = [];
export const isDownloaded = e => an.downloads.has(e.id);
export const isDownloading = e => an.progress.has(e.id);
export function download(e, quiet) {
  if (isDownloaded(e) || active.has(e.id) || dlQueue.some(x => x.id === e.id)) return;
  an.progress.set(e.id, 0); emit('downloads');
  e.__quiet = !!quiet; dlQueue.push(e); pumpDL();
}
function pumpDL() {
  while (active.size < 3 && dlQueue.length) {
    const e = dlQueue.shift(), ctl = new AbortController(); active.set(e.id, ctl);
    (async () => {
      try {
        const res = await fetchAudio(e.audioURL, p => { an.progress.set(e.id, p); emit('downloads'); }, ctl.signal);
        if (!res) throw new Error('fetch');
        const blob = await res.blob();
        const c = await caches.open(AUDIO_CACHE);
        await c.put(audioKey(e.id), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg', 'Content-Length': String(blob.size) } }));
        an.downloads.set(e.id, { size: blob.size, date: Date.now() }); saveDownloads();
        enqueue(e);
      } catch (_) { if (!ctl.signal.aborted && !e.__quiet) toastFail(e); }
      active.delete(e.id); an.progress.delete(e.id); emit('downloads'); pumpDL();
    })();
  }
}
let failHook = () => {}; export const onDownloadFail = f => failHook = f; const toastFail = e => failHook(e);
export function cancelDownload(e) { const c = active.get(e.id); if (c) c.abort(); const i = dlQueue.findIndex(x => x.id === e.id); if (i >= 0) dlQueue.splice(i, 1); an.progress.delete(e.id); emit('downloads'); }
export async function deleteDownload(e) { const c = await caches.open(AUDIO_CACHE); await c.delete(audioKey(e.id)); an.downloads.delete(e.id); saveDownloads(); emit('downloads'); }
export async function deleteAllDownloads() { await caches.delete(AUDIO_CACHE); an.downloads.clear(); saveDownloads(); emit('downloads'); }
export const bytesOnDisk = () => { let s = 0; for (const v of an.downloads.values()) s += v.size || 0; return s; };
export function autoDownload() {
  const n = settings.autoDownload; if (!n) return;
  for (const p of lib.podcasts) { let k = 0; for (const e of p.episodes) { if (isHeard(e)) continue; if (k++ >= n) break; download(e, true); } }
}
export function removePlayed() { if (!settings.removePlayed) return; for (const id of [...an.downloads.keys()]) { const e = lib.byId.get(id); if (e && isHeard(e)) deleteDownload(e); } }
export async function persist() { try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (_) {} }

// ---------- transcript search ----------
export function searchTranscripts(q) {
  const f = T.fold(q.trim()); if (f.length < 2) return [];
  const hits = [];
  for (const [id, ix] of an.index) {
    if (!lib.byId.has(id)) continue;
    for (let i = 0; i < ix.l.length; i++) { const at = ix.l[i].indexOf(f); if (at >= 0) { hits.push({ id, line: i, at, len: f.length, start: ix.s[i] }); if (hits.length >= 200) return hits; } }
  }
  return hits;
}
export async function hitText(h) {
  const t = an.transcripts.get(h.id) || await idb.get('transcripts', h.id);
  return t?.lines[h.line]?.text || '';
}

export function catchUp() { for (const id of an.downloads.keys()) { const e = lib.byId.get(id); if (e) enqueue(e); } }
export function prepareAhead(player) {
  const likely = lib.upNext.slice();
  if (player.episode) { const i = player.queue.findIndex(x => x.id === player.episode.id); if (i >= 0 && i + 1 < player.queue.length) likely.push(player.queue[i + 1]); }
  for (const e of inProgress()) if (e.id !== player.episode?.id) likely.push(e);
  prepare(likely);
}
