// Poden+ analysis worker — everything heavy happens here, never on the page's thread:
// decoding audio, the music / trailer / silence scan, fingerprints, repeats, language ads and transcript voids.
importScripts('detect-core.js', 'detect-model.js', 'textlib.js');
PodenDetect.setModel(self.PodenModel);
const D = PodenDetect, SR = 16000;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'scan') {
      const r = await scan(m);
      self.postMessage({ id: m.id, ok: true, result: r }, [r.fingerprint.buffer]);
    } else if (m.type === 'begin') { begin(m); self.postMessage({ id: m.id, ok: true, result: 1 });
    } else if (m.type === 'push') { push(m); self.postMessage({ id: m.id, ok: true, result: 1 });
    } else if (m.type === 'finish') { const r = finish(); self.postMessage({ id: m.id, ok: true, result: r }, [r.fingerprint.buffer]);
    } else if (m.type === 'repeats') {
      const out = {};
      for (const [oid, ofp] of Object.entries(m.others)) {
        const reps = D.findRepeats(new Uint32Array(m.fp), new Uint32Array(ofp));
        if (reps.length) out[oid] = reps;
      }
      self.postMessage({ id: m.id, ok: true, result: out });
    } else if (m.type === 'post') {                          // transcript passes: ads by language, voids, chapters
      self.postMessage({ id: m.id, ok: true, result: post(m) });
    } else if (m.type === 'timed') {                         // build the reading model for a transcript
      self.postMessage({ id: m.id, ok: true, result: PodenText.timed(m.transcript) });
    } else if (m.type === 'index') {
      self.postMessage({ id: m.id, ok: true, result: PodenText.indexLines(m.transcript) });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};

function progress(id, p) { self.postMessage({ id, progress: p }); }

// Decode with the browser's native decoder in pieces (~10 min each for MP3), so memory stays flat
// on 3-hour episodes and phones: each piece is decoded, folded to 16 kHz mono, scanned, then dropped.
let session = null;
async function scan(m) {
  if (typeof OfflineAudioContext === 'undefined') throw new Error('no-worker-decode');
  const buf = m.buffer; m.buffer = null;
  const s = new D.Scan(m.duration || 3600);
  let done = 0;
  for (const [a, b] of pieces(buf)) {
    try { s.push(await mono16k(await decode(buf.slice(a, b)))); }
    catch (_) { s.push(new Float32Array(Math.round((b - a) / 16000 * SR))); }   // undecodable piece → silence
    done = b; progress(m.id, 0.05 + 0.9 * done / buf.byteLength);
  }
  const r = s.finish(); self.__lastScan = s; return r;
}
// MP3: cut at frame boundaries (a decoder can start at any frame). Anything else: one piece.
function pieces(buf) {
  const u = new Uint8Array(buf), n = u.length, CH = 12 << 20, cuts = [0];
  const mp3 = (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) || (u[0] === 0xff && (u[1] & 0xe0) === 0xe0);
  if (!mp3 || n < CH * 1.5) return [[0, n]];
  const BR = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], SRS = [44100, 48000, 32000];
  const frameLen = k => { const b1 = u[k + 1], b2 = u[k + 2]; if (u[k] !== 0xff || (b1 & 0xe0) !== 0xe0) return 0; const ver = (b1 >> 3) & 3, layer = (b1 >> 1) & 3; if (ver === 1 || layer !== 1) return 0; const bi = b2 >> 4, si = (b2 >> 2) & 3; if (!bi || bi === 15 || si === 3) return 0; const v1 = ver === 3, br = (v1 ? BR[bi] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160][bi]) * 1000, sr = SRS[si] / (ver === 3 ? 1 : ver === 2 ? 2 : 4); return Math.floor((v1 ? 144 : 72) * br / sr) + ((b2 >> 1) & 1); };
  for (let o = CH; o < n - CH / 2; o += CH) for (let k = o, lim = Math.min(n - 8, o + 262144); k < lim; k++) { const L = frameLen(k); if (L > 20 && k + L < n - 4 && frameLen(k + L) > 20) { cuts.push(k); break; } }
  cuts.push(n);
  const out = []; for (let i = 0; i + 1 < cuts.length; i++) out.push([cuts[i], cuts[i + 1]]);
  return out;
}
let dctx; function decode(ab) { dctx = dctx || new OfflineAudioContext(1, 1, SR); return dctx.decodeAudioData(ab); }
async function mono16k(audio) {
  // decodeAudioData already resampled to the context's 16 kHz; fold channels to mono.
  const a = audio.getChannelData(0); if (audio.numberOfChannels < 2) return a;
  const b = audio.getChannelData(1), out = new Float32Array(a.length); for (let k = 0; k < a.length; k++) out[k] = (a[k] + b[k]) * 0.5; return out;
}
// Page-side decoding (Safari without OfflineAudioContext in workers): the page streams mono PCM here.
function begin(m) { session = new D.Scan(m.duration || 3600); }
function push(m) { session.push(m.pcm); }
function finish() { const r = session.finish(); self.__lastScan = session; session = null; return r; }

// Transcript-driven passes (same rules as the Mac app).
function post(m) {
  let a = m.analysis;
  const tr = m.transcript;
  if (tr && tr.lines && tr.lines.length) {
    const words = PodenText.words(tr);
    a.ads = D.subtract(PodenText.languageAds(words), a.music.concat(a.trailers), 4.5);
    a.adsVersion = 3;
    if (tr.generated && self.__lastScan) a = voids(a, tr, self.__lastScan, m.duration);
  }
  self.__lastScan = null;
  let chapters = null;
  if (m.wantChapters && tr && tr.lines && tr.lines.length) chapters = PodenText.autoChapters(tr, a, m.duration);
  return { analysis: a, chapters };
}

function voids(a, tr, scan, duration) {
  const V = PodenText.findVoids(tr, duration || scan.F.nb / 10);
  const labelled = [];
  for (const v of V) {
    const p = D.profileRange(scan, v.start, v.end);
    if (!p) continue;
    const cue = PodenText.cueBefore(v, tr);
    let l = null;
    if (p.quiet > 0.6) l = null;
    else if (p.music >= 0.35 && (p.trailer >= 0.3 || cue)) l = 'trailer';
    else if (p.music >= 0.35) l = 'music';
    else if (p.speech >= 0.6 && p.quiet < 0.3) l = 'ad';
    else if (cue && p.music >= 0.2) l = 'trailer';
    if (l) labelled.push([v, l]);
  }
  return PodenText.applyVoids(labelled, a);
}
