// Poden+ audio analysis core — pure functions, no DOM. Runs in a Web Worker (and in tests).
// Input: 16 kHz mono Float32 PCM, fed in pieces. Output: music, trailers, silence, fingerprints.
//
// Browsers have no built-in sound classifier, so music vs speech is decided from features that are
// cheap to compute in one pass over 100 ms blocks, scored by a small logistic model that was fitted
// against the Mac app's own results on real episodes (see tools/). Everything downstream — merging,
// trailer cues, loudness growth, silence, repeats — follows the Mac app's rules.
(function (root) {
'use strict';
const SR = 16000, BLOCK = 1600, FFTN = 512;

// ---------- radix-2 FFT (power spectrum) ----------
function makeFFT(n) {
  const lv = Math.log2(n) | 0, cos = new Float32Array(n / 2), sin = new Float32Array(n / 2), rev = new Uint32Array(n), win = new Float32Array(n);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < lv; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  const re = new Float32Array(n), im = new Float32Array(n), pow = new Float32Array(n / 2);
  return function (src, off) {           // windowed power spectrum of src[off .. off+n)
    for (let i = 0; i < n; i++) { re[rev[i]] = src[off + i] * win[i]; im[rev[i]] = 0; }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half, c = cos[k], s = sin[k];
          const tr = re[b] * c + im[b] * s, ti = im[b] * c - re[b] * s;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    for (let i = 0; i < n / 2; i++) pow[i] = re[i] * re[i] + im[i] * im[i];
    return pow;
  };
}

// ---------- streaming block features ----------
// Per 100 ms block: rms, sub-bass rms (<120 Hz), spectral flatness, centroid, flux, 4-band energies.
class Features {
  constructor(capacitySeconds) {
    const n = Math.ceil(capacitySeconds * 10) + 20;
    this.rms = new Float32Array(n); this.low = new Float32Array(n); this.flat = new Float32Array(n);
    this.cent = new Float32Array(n); this.flux = new Float32Array(n); this.hf = new Float32Array(n);
    this.nb = 0; this.fft = makeFFT(FFTN); this.lp = 0; this.a = 1 - Math.exp(-2 * Math.PI * 120 / SR);
    this.prev = new Float32Array(32); this.cur = new Float32Array(32); this.carry = null;
  }
  grow() {
    for (const k of ['rms', 'low', 'flat', 'cent', 'flux', 'hf']) { const o = this[k], x = new Float32Array(o.length * 2); x.set(o); this[k] = x; }
  }
  push(pcm) {                             // pcm: Float32Array, any length (continuation of the stream)
    let data = pcm, o = 0;
    if (this.carry) { const c = new Float32Array(this.carry.length + pcm.length); c.set(this.carry); c.set(pcm, this.carry.length); data = c; this.carry = null; }
    const a = this.a;
    while (o + BLOCK <= data.length) {
      if (this.nb >= this.rms.length) this.grow();
      const b = this.nb++;
      let e = 0, el = 0, lp = this.lp;
      for (let i = o, end = o + BLOCK; i < end; i++) { const x = data[i]; e += x * x; lp += a * (x - lp); el += lp * lp; }
      this.lp = lp;
      const rms = Math.sqrt(e / BLOCK);
      this.rms[b] = rms; this.low[b] = Math.sqrt(el / BLOCK);
      if (rms > 0.002) {
        const p = this.fft(data, o + (BLOCK - FFTN) / 2);
        let lg = 0, ar = 0, cw = 0, cs = 0, hi = 0, tot = 0;
        for (let i = 4; i < 200; i++) { const v = p[i] + 1e-12; lg += Math.log(v); ar += v; cw += i * v; cs += v; }
        for (let i = 4; i < 256; i++) { tot += p[i]; if (i >= 128) hi += p[i]; }
        this.flat[b] = Math.exp(lg / 196) / (ar / 196);
        this.cent[b] = cw / cs / 256;
        this.hf[b] = hi / (tot + 1e-12);
        // flux over 32 log-ish bands, normalised
        const cur = this.cur; let f = 0, s = 0;
        for (let k = 0; k < 32; k++) { const lo = 4 + k * 7, up = lo + 7; let v = 0; for (let i = lo; i < up; i++) v += p[i]; cur[k] = Math.log(v + 1e-9); }
        for (let k = 0; k < 32; k++) { const d = cur[k] - this.prev[k]; f += d > 0 ? d : 0; s++; }
        this.flux[b] = f / s; this.prev.set(cur);
      } else { this.flat[b] = 1; this.cent[b] = 0; this.flux[b] = 0; this.hf[b] = 0; }
      o += BLOCK;
    }
    if (o < data.length) this.carry = data.slice(o);
  }
}

// ---------- per-second window features (3 s context) ----------
const NF = 12;
function windowFeatures(F) {
  const secs = Math.floor(F.nb / 10), X = new Float32Array(secs * NF);
  const db = new Float32Array(F.nb);
  for (let b = 0; b < F.nb; b++) db[b] = 20 * Math.log10(F.rms[b] + 1e-5);
  for (let k = 0; k < secs; k++) {
    const lo = Math.max(0, k * 10 - 10), hi = Math.min(F.nb, k * 10 + 20), n = hi - lo;
    let m = 0, mx = -200, flat = 0, cent = 0, flux = 0, low = 0, tot = 0, hf = 0, rough = 0, quiet = 0, fl2 = 0, c2 = 0;
    for (let b = lo; b < hi; b++) { m += db[b]; if (db[b] > mx) mx = db[b]; tot += F.rms[b]; low += F.low[b]; }
    m /= n;
    for (let b = lo; b < hi; b++) {
      flat += F.flat[b]; fl2 += F.flat[b] * F.flat[b]; cent += F.cent[b]; c2 += F.cent[b] * F.cent[b]; flux += F.flux[b]; hf += F.hf[b];
      if (b > lo) rough += Math.abs(db[b] - db[b - 1]);
      if (db[b] < mx - 15) quiet++;
    }
    flat /= n; cent /= n; flux /= n; hf /= n; rough /= (n - 1);
    const fsd = Math.sqrt(Math.max(0, fl2 / n - flat * flat)), csd = Math.sqrt(Math.max(0, c2 / n - cent * cent));
    const o = k * NF;
    X[o] = m / 40 + 1; X[o + 1] = rough / 5; X[o + 2] = quiet / n; X[o + 3] = flat * 4; X[o + 4] = fsd * 6;
    X[o + 5] = cent * 5; X[o + 6] = csd * 20; X[o + 7] = flux; X[o + 8] = tot > 0 ? low / tot : 0; X[o + 9] = hf * 5;
    X[o + 10] = (mx - m) / 10; X[o + 11] = 1;
  }
  return { X, secs, db };
}

// Small neural model: P(music) per second, from this second's features and the ±4 s around it.
// Weights fitted offline (tools/fit.js) on episodes the Mac app analysed; the Mac's classifier is the teacher.
const NL = NF - 1, NX = NL * 2 + 1;
function context(X, secs) {
  const C = new Float32Array(secs * NX), R = 4;
  const pre = new Float64Array((secs + 1) * NL);           // prefix sums for fast window means
  for (let k = 0; k < secs; k++) for (let i = 0; i < NL; i++) pre[(k + 1) * NL + i] = pre[k * NL + i] + X[k * NF + i];
  for (let k = 0; k < secs; k++) {
    const lo = Math.max(0, k - R), hi = Math.min(secs, k + R + 1), n = hi - lo, o = k * NX;
    for (let i = 0; i < NL; i++) { C[o + i] = X[k * NF + i]; C[o + NL + i] = (pre[hi * NL + i] - pre[lo * NL + i]) / n; }
    C[o + NX - 1] = 1;
  }
  return C;
}
// M = { H, W1: H×NX, W2: 3×(H+1) } → softmax over [speech, music, trailer].
let M = null;
function setModel(m) { M = m && { H: m.H, W1: Float32Array.from(m.W1), W2: Float32Array.from(m.W2) }; if (m && m.threshold) RULES.threshold = m.threshold; }
const hid = new Float32Array(64);
function score(C, k, out) {
  const o = k * NX, H = M.H, W1 = M.W1, W2 = M.W2;
  for (let h = 0; h < H; h++) { let a = 0; const r = h * NX; for (let i = 0; i < NX; i++) a += W1[r + i] * C[o + i]; hid[h] = Math.tanh(a); }
  let z0 = W2[H], z1 = W2[2 * H + 1], z2 = W2[3 * H + 2];
  for (let h = 0; h < H; h++) { z0 += W2[h] * hid[h]; z1 += W2[H + 1 + h] * hid[h]; z2 += W2[2 * H + 2 + h] * hid[h]; }
  const m = Math.max(z0, z1, z2), e0 = Math.exp(z0 - m), e1 = Math.exp(z1 - m), e2 = Math.exp(z2 - m), s = e0 + e1 + e2;
  out[0] = e1 / s; out[1] = e2 / s;                         // P(music), P(trailer)
}
function probabilities(F) {
  const { X, secs } = windowFeatures(F), C = context(X, secs), pm = new Float32Array(secs), pt = new Float32Array(secs), o = [0, 0];
  for (let k = 0; k < secs; k++) { score(C, k, o); pm[k] = o[0] + o[1]; pt[k] = o[1]; }
  return { pm, pt };
}
function smooth(p, r) {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) { let s = 0, c = 0; for (let j = Math.max(0, i - r); j <= Math.min(p.length - 1, i + r); j++) { s += p[j]; c++; } out[i] = s / c; }
  return out;
}

// ---------- segments ----------
function merge(list, gap) {
  const s = list.slice().sort((a, b) => a.start - b.start), out = [];
  for (const x of s) { const l = out[out.length - 1]; if (l && x.start - l.end <= gap) l.end = Math.max(l.end, x.end); else out.push({ start: x.start, end: x.end }); }
  return out;
}
function subtract(segs, cut, minimum) {
  const out = [];
  for (const s of segs) {
    let pieces = [{ start: s.start, end: s.end }];
    for (const c of cut) pieces = pieces.flatMap(p => (c.start < p.end && c.end > p.start) ? [{ start: p.start, end: c.start }, { start: c.end, end: p.end }].filter(x => x.end > x.start) : [p]);
    for (const p of pieces) if (p.end - p.start >= minimum) out.push(p);
  }
  return out;
}
function median(v) { if (!v.length) return null; const s = Float64Array.from(v).sort(); return s[s.length >> 1]; }

const RULES = { threshold: 0.5, bridge: 3, minMusic: 8, trim: 0.5, minTrailer: 12, trailerShare: 0.5, bassCue: 0.55, fluxCue: 0.0, loudCue: 3, maxGrow: 90, absorbGap: 4, quietTolerance: 2, silenceLevel: 0.006, minSilence: 1.2 };

function silenceFrom(F) {
  const out = []; let run = -1; const thr = RULES.silenceLevel;
  for (let b = 0; b <= F.nb; b++) {
    const q = b < F.nb && F.rms[b] < thr;
    if (q && run < 0) run = b;
    if (!q && run >= 0) { if ((b - run) / 10 >= RULES.minSilence) out.push({ start: run / 10, end: b / 10 }); run = -1; }
  }
  return out;
}

function loudnessPerSecond(F) {
  const n = Math.ceil(F.nb / 10), out = new Float64Array(n);
  for (let k = 0; k < n; k++) { let s = 0, c = 0; for (let b = k * 10; b < Math.min(F.nb, k * 10 + 10); b++) { s += F.rms[b] * F.rms[b]; c++; } out[k] = c ? 10 * Math.log10(s / c + 1e-10) : -100; }
  return out;
}

// Trailer cues per section: sub-bass share, voice-over (speech-like seconds inside), loud mix, spectral change.
function isTrailer(seg, F, p, pt, loud, base) {
  if (seg.end - seg.start < RULES.minTrailer) return false;
  let sm = 0, st = 0;
  for (let k = Math.floor(seg.start); k < Math.min(p.length, Math.ceil(seg.end)); k++) { sm += p[k]; st += pt[k]; }
  if (sm > 0 && st / sm >= RULES.trailerShare) return true;
  let tot = 0, low = 0, fx = 0, n = 0, voiced = 0;
  for (let b = Math.floor(seg.start * 10); b < Math.min(F.nb, Math.ceil(seg.end * 10)); b++) { tot += F.rms[b]; low += F.low[b]; fx += F.flux[b]; n++; }
  for (let k = Math.floor(seg.start); k < Math.min(p.length, Math.ceil(seg.end)); k++) if (p[k] < 0.5) voiced++;
  const secs = Math.max(1, seg.end - seg.start);
  const lv = []; for (let k = Math.floor(seg.start); k < Math.min(loud.length, Math.ceil(seg.end)); k++) lv.push(loud[k]);
  const level = median(lv);
  let cues = 0;
  if (tot > 0 && low / tot >= RULES.bassCue) cues++;
  if (voiced / secs >= 0.25) cues++;
  if (base != null && level != null && level - base >= RULES.loudCue) cues++;
  if (n && fx / n >= 0.9) cues++;
  return cues >= 2;
}

function grow(trailers, music, loud, silence) {
  if (!trailers.length) return [trailers, music];
  let t = trailers.map(x => ({ ...x })), changed = true;
  while (changed) {
    changed = false;
    for (const m of music) for (const x of t) {
      if (m.start <= x.end + RULES.absorbGap && m.end >= x.start - RULES.absorbGap && (m.start < x.start || m.end > x.end)) { x.start = Math.min(x.start, m.start); x.end = Math.max(x.end, m.end); changed = true; }
    }
    t = merge(t, 1);
  }
  const n = loud.length;
  const inside = (k, segs) => { const x = k + 0.5; for (const s of segs) if (x >= s.start && x < s.end) return true; return false; };
  const show = []; for (let k = 0; k < n; k++) if (loud[k] > -60 && !inside(k, t) && !inside(k, music)) show.push(loud[k]);
  const base = median(show);
  if (base != null) {
    t = t.map(seg => {
      const lo = Math.max(0, Math.floor(seg.start)), hi = Math.min(n, Math.ceil(seg.end));
      if (lo >= hi) return seg;
      const level = median(Array.from(loud.subarray(lo, hi)));
      if (level == null || level - base < RULES.loudCue) return seg;
      const thr = base + (level - base) / 2;
      const walk = (k0, step, edge) => { let k = k0, last = edge, miss = 0; while (k >= 0 && k < n && Math.abs(k - k0) < RULES.maxGrow && !inside(k, silence)) { if (loud[k] < thr) { if (++miss > RULES.quietTolerance) break; } else { miss = 0; last = k; } k += step; } return last; };
      const first = walk(lo - 1, -1, lo), last = walk(hi, 1, hi - 1);
      return { start: Math.min(seg.start, first), end: Math.max(seg.end, last + 1) };
    });
    t = merge(t, 1);
  }
  return [t, subtract(music, t, RULES.minMusic)];
}

// ---------- fingerprints (Haitsma–Kalker style, 50 ms hop) ----------
const FP = { hop: 800, size: 2048, bands: 33, fps: 20, silent: 0.004 };
const fpEdges = (() => { const e = []; for (let i = 0; i <= FP.bands; i++) e.push(Math.round(300 * Math.pow(10, i / FP.bands) / SR * FP.size)); return e; })();
class Printer {
  constructor(seconds) { this.h = new Uint32Array(Math.ceil(seconds * FP.fps) + 40); this.n = 0; this.fft = makeFFT(FP.size); this.buf = new Float32Array(FP.size * 8); this.len = 0; this.prev = new Float32Array(FP.bands + 1); this.bands = new Float32Array(FP.bands + 1); this.hasPrev = false; }
  push(pcm) {
    for (let o = 0; o < pcm.length;) {
      const take = Math.min(pcm.length - o, this.buf.length - this.len);
      this.buf.set(pcm.subarray(o, o + take), this.len); this.len += take; o += take;
      let p = 0;
      while (p + FP.size <= this.len) { this.frame(p); p += FP.hop; }
      this.buf.copyWithin(0, p, this.len); this.len -= p;
    }
  }
  frame(off) {
    if (this.n >= this.h.length) { const x = new Uint32Array(this.h.length * 2); x.set(this.h); this.h = x; }
    let e = 0; for (let i = off; i < off + FP.size; i += 4) e += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(e / (FP.size / 4));
    let h = 0;
    if (rms >= FP.silent) {
      const pw = this.fft(this.buf, off), b = this.bands;
      for (let k = 0; k < FP.bands; k++) { let s = 0; for (let i = fpEdges[k]; i < Math.max(fpEdges[k] + 1, fpEdges[k + 1]); i++) s += pw[i]; b[k] = s; }
      if (this.hasPrev) { for (let m = 0; m < 32; m++) if ((b[m] - b[m + 1]) - (this.prev[m] - this.prev[m + 1]) > 0) h |= (1 << m); h >>>= 0; if (h === 0) h = 1; }
      const t = this.prev; this.prev = b; this.bands = t;
      this.hasPrev = true;
    } else this.hasPrev = false;
    this.h[this.n++] = h;
  }
  result() { return this.h.slice(0, this.n); }
}
function popcount(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; }
const REP = { min: 5, maxCommon: 12, minHits: 14, runGap: 60, accept: 0.30, extend: 0.34 };
function findRepeats(a, b) {
  if (!a.length || !b.length) return [];
  const index = new Map();
  for (let j = 0; j < b.length; j++) { const h = b[j]; if (!h) continue; let l = index.get(h); if (!l) index.set(h, l = []); l.push(j); }
  const byOff = new Map();
  for (let i = 0; i < a.length; i++) { const h = a[i]; if (!h) continue; const js = index.get(h); if (!js || js.length > REP.maxCommon) continue; for (const j of js) { const d = j - i; let l = byOff.get(d); if (!l) byOff.set(d, l = []); l.push(i); } }
  const ber = (s, e, off) => { let bits = 0, n = 0; for (let i = s; i < e; i++) { const j = i + off; if (i < 0 || i >= a.length || j < 0 || j >= b.length || !a[i] || !b[j]) continue; bits += popcount((a[i] ^ b[j]) >>> 0); n++; } return n >= (e - s) / 3 ? bits / (32 * Math.max(1, n)) : null; };
  const found = [];
  for (const [off, hits] of byOff) {
    if (hits.length < REP.minHits) continue;
    let rs = hits[0], last = hits[0], count = 1;
    const close = () => {
      if (count < REP.minHits / 2 || last - rs < 40) return;
      const r = ber(rs, last + 1, off); if (r == null || r >= REP.accept) return;
      let s = rs, e = last + 1; const st = FP.fps; let q;
      while (s - st >= 0 && s - st + off >= 0 && (q = ber(s - st, s, off)) != null && q < REP.extend) s -= st;
      while (e + st <= a.length && e + st + off <= b.length && (q = ber(e, e + st, off)) != null && q < REP.extend) e += st;
      found.push({ s, e, off });
    };
    for (let k = 1; k < hits.length; k++) { const h = hits[k]; if (h - last <= REP.runGap) { last = h; count++; } else { close(); rs = h; last = h; count = 1; } }
    close();
  }
  found.sort((x, y) => x.s - y.s);
  const m = [];
  for (const f of found) { const l = m[m.length - 1]; if (l && f.s <= l.e && Math.abs(f.off - l.off) <= 4) l.e = Math.max(l.e, f.e); else m.push({ ...f }); }
  const pad = FP.size / SR;
  return m.map(x => ({ a: { start: x.s / FP.fps, end: x.e / FP.fps + pad }, b: { start: (x.s + x.off) / FP.fps, end: (x.e + x.off) / FP.fps + pad } })).filter(x => x.a.end - x.a.start >= REP.min);
}
function applyRepeats(an, reps) {
  if (!reps.length) return an;
  const merged = merge(reps, 1);
  const ov = (a, segs) => segs.reduce((s, x) => s + Math.max(0, Math.min(a.end, x.end) - Math.max(a.start, x.start)), 0);
  let { music, trailers, ads } = an; music = music.slice(); trailers = trailers.slice(); ads = ads.slice();
  for (const r of merged) { const len = r.end - r.start; if (ov(r, trailers) > 0) trailers.push(r); else if (ov(r, music) >= 0.3 * len) music.push(r); else ads.push(r); }
  trailers = merge(trailers, 1.5);
  ads = subtract(merge(ads, 1.5), trailers, REP.min);
  music = subtract(merge(music, 1.5), trailers.concat(ads), REP.min);
  return { ...an, music, trailers, ads, repeats: merge((an.repeats || []).concat(merged), 1) };
}

// ---------- full pass ----------
class Scan {
  constructor(seconds) { this.F = new Features(seconds || 3600); this.P = new Printer(seconds || 3600); }
  push(pcm) { this.F.push(pcm); this.P.push(pcm); }
  finish() {
    const F = this.F, { pm, pt } = probabilities(F), secs = pm.length, raw = pm;
    const p = smooth(raw, 1);
    const hits = []; for (let k = 0; k < secs; k++) if (p[k] >= RULES.threshold) hits.push({ start: k, end: k + 1 });
    const runs = merge(hits, RULES.bridge).map(s => ({ start: s.start + RULES.trim, end: s.end - RULES.trim })).filter(s => s.end - s.start >= RULES.minMusic);
    const silence = silenceFrom(F), loud = loudnessPerSecond(F);
    const inside = (k, segs) => segs.some(s => k + 0.5 >= s.start && k + 0.5 < s.end);
    const show = []; for (let k = 0; k < loud.length; k++) if (loud[k] > -60 && !inside(k, runs)) show.push(loud[k]);
    const base = median(show);
    let music = [], trailers = [];
    for (const s of runs) (isTrailer(s, F, raw, pt, loud, base) ? trailers : music).push(s);
    [trailers, music] = grow(trailers, music, loud, silence);
    this.pm = pm; this.pt = pt;
    const r2 = x => ({ start: Math.round(x.start * 100) / 100, end: Math.round(x.end * 100) / 100 });
    return { music: music.map(r2), trailers: trailers.map(r2), silence: silence.map(r2), duration: F.nb / 10, fingerprint: this.P.result() };
  }
}

// Profile of a stretch of an already-scanned episode, from the stored per-second model output and
// 100 ms loudness — no audio needs to be kept or re-read (for the transcript-voids pass).
function profileRange(scan, start, end) {
  const pm = scan.pm, pt = scan.pt, F = scan.F; if (!pm) return null;
  let m = 0, t = 0, n = 0, q = 0, nb = 0;
  for (let k = Math.max(0, Math.floor(start)); k < Math.min(pm.length, Math.ceil(end)); k++) { m += pm[k]; t += pt[k]; n++; }
  for (let b = Math.max(0, Math.floor(start * 10)); b < Math.min(F.nb, Math.ceil(end * 10)); b++) { if (F.rms[b] < RULES.silenceLevel) q++; nb++; }
  if (!n) return null;
  return { music: m / n, trailer: t / n, speech: 1 - m / n, quiet: q / Math.max(1, nb) };
}
// Profile of one stretch (for the transcript-voids pass): share of music-like seconds, speech-like, quiet.
function profile(pcm) {
  const F = new Features(pcm.length / SR + 2); F.push(pcm);
  const { pm, pt } = probabilities(F), secs = pm.length;
  if (!secs) return null;
  let m = 0, q = 0, tr = 0;
  for (let k = 0; k < secs; k++) { m += pm[k]; tr += pt[k]; }
  for (let b = 0; b < F.nb; b++) if (F.rms[b] < RULES.silenceLevel) q++;
  let tot = 0, low = 0; for (let b = 0; b < F.nb; b++) { tot += F.rms[b]; low += F.low[b]; }
  return { music: m / secs, trailer: tr / secs, speech: 1 - m / secs, quiet: q / Math.max(1, F.nb), bass: tot ? low / tot : 0 };
}

root.PodenDetect = { SR, Features, windowFeatures, context, score, setModel, probabilities, NF, NX, Scan, merge, subtract, grow, silenceFrom, findRepeats, applyRepeats, profile, profileRange, RULES, smooth, FP };
})(typeof self !== 'undefined' ? self : this);
