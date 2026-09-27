// Calibration: trains the speech / music / trailer model against the Mac app's analyses, then
// evaluates the whole pipeline (segments, trailers, silence) on episodes it did NOT train on.
//   jsc tools/fit.js -- <path of this file> <audio dir> <cmd> [names]
//   cmd: features  → extract + cache block features (slow part, once)
//        train     → fit on all but the held-out episodes, write js/model.js, evaluate
// Audio dir holds NAME.wav (16 kHz mono s16, e.g. from afconvert) + NAME.json (Mac analysis).
const base = arguments[0].replace(/tools\/fit\.js$/, '');
load(base + 'js/detect-core.js');
const D = PodenDetect;
const dir = arguments[1], cmd = arguments[2] || 'train';
const names = (arguments[3] || '0ff12dea,2910a3d2,44509c7d,b20d6468,a82a1a66,0b976dcd').split(',');
const hold = (arguments[4] || '2910a3d2,0b976dcd').split(',');

function wav(path) {
  const b = readFile(path, 'binary');
  let o = 12; while (o < b.length - 8) { const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); const sz = b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24); if (id === 'data') { o += 8; break; } o += 8 + sz; }
  return new Int16Array(b.buffer.slice(o, o + ((b.length - o) >> 1) * 2));
}
const KEYS = ['rms', 'low', 'flat', 'cent', 'flux', 'hf'];
function extract(n) {
  const v = wav(dir + '/' + n + '.wav'), t0 = Date.now();
  const scan = new D.Scan(v.length / 16000), CH = 16000 * 30, f = new Float32Array(CH);
  for (let o = 0; o < v.length; o += CH) { const m = Math.min(CH, v.length - o); for (let i = 0; i < m; i++) f[i] = v[o + i] / 32768; scan.push(m === CH ? f : f.subarray(0, m)); }
  const ms = Date.now() - t0;
  const F = scan.F, fp = scan.P.result();
  // cache: 6 Float32 arrays of nb + fingerprint
  const nb = F.nb, buf = new Float32Array(1 + nb * KEYS.length);
  buf[0] = nb; KEYS.forEach((k, j) => buf.set(F[k].subarray(0, nb), 1 + j * nb));
  writeFile(dir + '/' + n + '.feat', buf.buffer);
  writeFile(dir + '/' + n + '.fp', fp.buffer);
  print(n, (v.length / 16000 / 60).toFixed(0) + ' min', 'scan', ms, 'ms →', (v.length / 16000 / (ms / 1000)).toFixed(0) + '× real-time (fingerprint + features, 1 thread)');
}
function loadFeat(n) {
  const b = new Float32Array(readFile(dir + '/' + n + '.feat', 'binary').buffer), nb = b[0];
  const F = new D.Features(nb / 10 + 1); F.nb = nb;
  KEYS.forEach((k, j) => F[k] = b.slice(1 + j * nb, 1 + (j + 1) * nb));
  const fp = new Uint32Array(readFile(dir + '/' + n + '.fp', 'binary').buffer.slice(0));
  return { F, fp };
}
const inside = (t, segs) => segs.some(s => t >= s.start && t < s.end);
const overlap = (a, b) => { let s = 0; for (const x of a) for (const y of b) s += Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start)); return s; };
const total = a => a.reduce((s, x) => s + x.end - x.start, 0);

if (cmd === 'features') { for (const n of names) extract(n); quit(); }

// ---------- training data ----------
const eps = names.map(n => { const { F, fp } = loadFeat(n); const { X, secs } = D.windowFeatures(F); return { n, F, fp, X, secs, C: D.context(X, secs), mac: JSON.parse(read(dir + '/' + n + '.json')) }; });
const NX = D.NX, H = +(arguments[5] || 12);
const rows = [], labels = [];
for (const e of eps) {
  if (hold.includes(e.n)) continue;
  const mus = e.mac.music, trl = e.mac.trailers, all = mus.concat(trl);
  for (let k = 0; k < e.secs; k++) {
    const t = k + 0.5;
    if (all.some(s => Math.abs(s.start - t) < 1.2 || Math.abs(s.end - t) < 1.2)) continue;   // fuzzy edges
    rows.push(e.C.subarray(k * NX, k * NX + NX)); labels.push(inside(t, trl) ? 2 : inside(t, mus) ? 1 : 0);
  }
}
const cnt = [0, 0, 0]; for (const y of labels) cnt[y]++;
print('train rows', rows.length, 'speech', cnt[0], 'music', cnt[1], 'trailer', cnt[2]);
const cw = cnt.map(c => Math.pow(rows.length / (3 * Math.max(1, c)), +(arguments[7] || 0.5)));

// ---------- 1-hidden-layer MLP, softmax, Adam ----------
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
const W1 = new Float32Array(H * NX).map(() => rnd() * 0.6), W2 = new Float32Array(3 * (H + 1)).map(() => rnd() * 0.6);
const P = [W1, W2], mA = P.map(p => new Float32Array(p.length)), vA = P.map(p => new Float32Array(p.length));
const h = new Float32Array(H), g1 = new Float32Array(W1.length), g2 = new Float32Array(W2.length);
const order = rows.map((_, i) => i);
let step = 0; const lr = 0.01, B = 256, epochs = +(arguments[6] || 12);
for (let ep = 0; ep < epochs; ep++) {
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor((rnd() + 0.5) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  let loss = 0;
  for (let b0 = 0; b0 < order.length; b0 += B) {
    g1.fill(0); g2.fill(0);
    const bn = Math.min(B, order.length - b0);
    for (let q = 0; q < bn; q++) {
      const r = order[b0 + q], x = rows[r], y = labels[r], w = cw[y];
      for (let j = 0; j < H; j++) { let a = 0; const o = j * NX; for (let i = 0; i < NX; i++) a += W1[o + i] * x[i]; h[j] = Math.tanh(a); }
      const z = [0, 0, 0];
      for (let c = 0; c < 3; c++) { const o = c * (H + 1); let s = W2[o + H]; for (let j = 0; j < H; j++) s += W2[o + j] * h[j]; z[c] = s; }
      const m = Math.max(...z), ex = z.map(v => Math.exp(v - m)), S = ex[0] + ex[1] + ex[2], p = ex.map(v => v / S);
      loss -= w * Math.log(p[y] + 1e-9);
      const dz = p.map((v, c) => w * (v - (c === y ? 1 : 0)));
      for (let c = 0; c < 3; c++) { const o = c * (H + 1); for (let j = 0; j < H; j++) g2[o + j] += dz[c] * h[j]; g2[o + H] += dz[c]; }
      for (let j = 0; j < H; j++) {
        let dh = 0; for (let c = 0; c < 3; c++) dh += dz[c] * W2[c * (H + 1) + j];
        dh *= 1 - h[j] * h[j]; const o = j * NX;
        for (let i = 0; i < NX; i++) g1[o + i] += dh * x[i];
      }
    }
    step++;
    [g1, g2].forEach((g, pi) => { const p = P[pi], m = mA[pi], v = vA[pi];
      for (let i = 0; i < p.length; i++) { const gi = g[i] / bn + 1e-4 * p[i]; m[i] = 0.9 * m[i] + 0.1 * gi; v[i] = 0.999 * v[i] + 0.001 * gi * gi;
        p[i] -= lr * (m[i] / (1 - 0.9 ** step)) / (Math.sqrt(v[i] / (1 - 0.999 ** step)) + 1e-8); } });
  }
  print('epoch', ep, 'loss', (loss / rows.length).toFixed(4));
}
const model = { H, W1: Array.from(W1, x => +x.toFixed(4)), W2: Array.from(W2, x => +x.toFixed(4)) };
D.setModel(model);
writeFile(base + 'js/detect-model.js', '// Generated by tools/fit.js — speech / music / trailer model (' + H + ' hidden units).\nself.PodenModel=' + JSON.stringify(model) + ';\n');

// ---------- pick the threshold on held-out episodes (F-score weighted towards precision) ----------
function finish(e) { const s = new D.Scan(1); s.F = e.F; s.P = { result: () => e.fp }; return s.finish(); }
let best = [0.5, -1];
for (const th of [0.5, 0.6, 0.7, 0.8]) {
  D.RULES.threshold = th; let tp = 0, m = 0, o = 0;
  for (const e of eps) { if (!hold.includes(e.n)) continue; const r = finish(e); const mac = D.merge(e.mac.music.concat(e.mac.trailers), 0), ours = D.merge(r.music.concat(r.trailers), 0); tp += overlap(mac, ours); m += total(mac); o += total(ours); }
  const R = tp / m, Pr = tp / Math.max(1, o), f = 1.25 * R * Pr / (0.25 * R + Pr) - (Pr < 0.84 ? 1 : 0);   // never let precision drop below 84 %
  print('threshold', th, 'held-out recall', (R * 100).toFixed(1), 'precision', (Pr * 100).toFixed(1), 'F0.5', f.toFixed(3));
  if (f > best[1]) best = [th, f];
}
D.RULES.threshold = best[0]; model.threshold = best[0];
writeFile(base + 'js/detect-model.js', '// Generated by tools/fit.js — speech / music / trailer model (' + H + ' hidden units).\nself.PodenModel=' + JSON.stringify(model) + ';\n');
print('chosen threshold', best[0]);
// ---------- evaluate full pipeline ----------
let T = { tp: 0, mac: 0, ours: 0 }, H2 = { tp: 0, mac: 0, ours: 0 };
for (const e of eps) {
  const r = finish(e);
  const mac = D.merge(e.mac.music.concat(e.mac.trailers), 0), ours = D.merge(r.music.concat(r.trailers), 0);
  const hit = overlap(mac, ours), tr = overlap(e.mac.trailers, r.trailers);
  const bucket = hold.includes(e.n) ? H2 : T; bucket.tp += hit; bucket.mac += total(mac); bucket.ours += total(ours);
  print((hold.includes(e.n) ? 'HELD ' : 'train') + ' ' + e.n, '| skip-worthy: mac', total(mac).toFixed(0) + 's ours', total(ours).toFixed(0) + 's  recall', (hit / Math.max(1, total(mac)) * 100).toFixed(0) + '%  precision', (hit / Math.max(1, total(ours)) * 100).toFixed(0) + '%',
    '| trailers mac', e.mac.trailers.length + '/' + total(e.mac.trailers).toFixed(0) + 's ours', r.trailers.length + '/' + total(r.trailers).toFixed(0) + 's overlap', (tr / Math.max(1, total(e.mac.trailers)) * 100).toFixed(0) + '%');
}
print('TRAIN recall', (T.tp / T.mac * 100).toFixed(1) + '% precision', (T.tp / T.ours * 100).toFixed(1) + '%');
print('HELD-OUT recall', (H2.tp / H2.mac * 100).toFixed(1) + '% precision', (H2.tp / H2.ours * 100).toFixed(1) + '%');

// Repeats across two Pixel Bento episodes (same show): the Mac found ~160 s of repeats in each.
const pb = eps.filter(e => ['0ff12dea', '2910a3d2'].includes(e.n));
if (pb.length === 2) { const t0 = Date.now(); const reps = D.findRepeats(pb[0].fp, pb[1].fp); print('repeats PB68↔PB64:', reps.length, 'sections,', total(reps.map(r => r.a)).toFixed(0) + 's, in', Date.now() - t0, 'ms; mac repeats PB68', total(pb[0].mac.repeats || []).toFixed(0) + 's'); }
