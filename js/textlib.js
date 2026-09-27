// Poden+ text logic — shared by the page and the worker. No DOM needed (except parseFeed, page only).
(function (root) {
'use strict';
const T = {};

// ---------- words / reading model ----------
function lineWords(l) {
  const parts = String(l.text || '').split(/\s+/).filter(Boolean);
  if (l.words && l.words.length) {
    let toks = [];
    for (const w of l.words) {
      const ps = String(w.text).split(/\s+/).filter(Boolean);
      if (ps.length <= 1) { toks.push({ start: w.start, end: w.end, text: ps[0] || w.text, confidence: w.confidence }); continue; }
      const tot = ps.reduce((s, p) => s + p.length + 1, 0), span = Math.max(0, w.end - w.start); let t = w.start;
      for (const p of ps) { const d = w.start >= 0 ? span * (p.length + 1) / tot : 0; toks.push({ start: w.start >= 0 ? t : -1, end: w.start >= 0 ? t + d : -1, text: p, confidence: w.confidence }); t += d; }
    }
    if (toks.length === parts.length || !parts.length) return toks;
    // join pieces ("Pod" + "cast") so tokens match the words of the text
    const out = []; let i = 0;
    for (const w of parts) {
      if (i >= toks.length) return toks;
      const m = { ...toks[i] }; let n = m.text.length; i++;
      while (n < w.length && i < toks.length) { n += toks[i].text.length; m.end = toks[i].end; i++; }
      if (n !== w.length) return toks;
      m.text = w; out.push(m);
    }
    return i === toks.length ? out : toks;
  }
  if (!(l.start >= 0) || !(l.end > l.start) || !parts.length) return parts.map(p => ({ start: -1, end: -1, text: p }));
  const tot = parts.reduce((s, p) => s + p.length + 1, 0); let t = l.start;
  return parts.map(p => { const d = (l.end - l.start) * (p.length + 1) / tot; const w = { start: t, end: t + d, text: p }; t += d; return w; });
}
T.lineWords = lineWords;
T.words = tr => tr.lines.flatMap(lineWords);

const ABBR = new Set(['mr.', 'mrs.', 'ms.', 'dr.', 'st.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'jr.', 'sr.', 'prof.', 'no.']);
function endsSentence(w) {
  const c = w.replace(/["”’')\]»]+$/, '');
  return /[.!?…]$/.test(c) && !ABBR.has(c.toLowerCase());
}
// One row per sentence, grouped into paragraphs at pauses. Compact typed arrays for fast lookup.
T.timed = function (tr) {
  const timed = tr.lines.some(l => l.start >= 0);
  const lines = []; let cur = [], inPara = 0, lastEnd = -1, srcBreak = true;
  const flush = () => {
    if (!cur.length) return;
    const s = cur[0].start, e = cur[cur.length - 1].end;
    const pause = timed && lastEnd >= 0 && s >= 0 && s - lastEnd >= 1.5;
    const opens = !lines.length || srcBreak || pause || inPara >= 5;
    lines.push({ s, e, p: opens ? 1 : 0, w: cur.map(x => x.text), ws: cur.map(x => x.start) });
    inPara = opens ? 1 : inPara + 1; if (e >= 0) lastEnd = e; cur = []; srcBreak = false;
  };
  for (const l of tr.lines) {
    if (!timed) { flush(); srcBreak = true; }
    for (const w of lineWords(l)) { cur.push(w); if (endsSentence(w.text) || cur.length >= 60) flush(); }
  }
  flush();
  return { timed, lines };
};
T.position = function (tt, t) {
  if (!tt.timed || !tt.lines.length) return null;
  let lo = 0, hi = tt.lines.length - 1, line = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (tt.lines[m].s <= t) { line = m; lo = m + 1; } else hi = m - 1; }
  if (line < 0) return null;
  const L = tt.lines[line];
  if (L.e > L.s && t > L.e + 1) return { line, word: L.w.length };
  let w = -1; const ws = L.ws;
  lo = 0; hi = ws.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ws[m] >= 0 && ws[m] <= t) { w = m; lo = m + 1; } else hi = m - 1; }
  return { line, word: w };
};

// ---------- language ads (other-language stretches in a ≥ 65 % single-language episode) ----------
// A compact trigram language identifier for the languages podcasts here use. Scores are relative.
const PROFILES = {
  fr: ' de|es |le | la|de |ent|la | le| et|et |les|re |que|ue | qu| pa|ion| co|on |nt | un|ne | ce|ai | c\'| on|des| vo|ous|ais|est| es|st | je| se|t d|men|e d|out| pr|our|tai|ait|s d|e l|ne | ou|oui|pas|ça |mai|en |e p|t l|s l|qui|a c|ans|ell|ien|eux|ure|voi|dan| da',
  en: ' th|the|he |ing|ng | an|and|nd | to|to | of|of |ed | in|in |er |is | a |at |ou |it | is|re |on |you| yo| it|hat|tha|es |for| fo|thi|or | wa|as |ll |e t|t t| be|en |s a|st |was|his|ver| he|e a|wit|ith|th | we|are| ar|ere|ave|hav|but| bu',
  es: ' de|de | la|la |os |que|el | qu| el|ue |es |en | en|as | lo|ent| co|los|do | se|ado|nte|ien| es|ar |con|on |por| po|ra |ion|ón | un|una|o d|s d|e l|no |mos|est|ero|ta |par|ara|pue|ues|era|o e| pa|dad|ida|cia|aqu|más|mue|hay',
  de: 'en |er |ch |der|die| di|ie | de|ein|ich| ei|und|nd | un|sch|cht|den|in | ge| in|te |gen|ine|ter|ten|es |das| da|ist| is|st | zu|ung|eit|zu | wi|ber|mit| mi|auf|ach|nic|ich|sie|auc|uch|wir|icht|sin|hab|ben| au|abe',
  it: ' di|di |che|he | ch|to |la | la|re | co|el |e d|del| de|ell|lla|ent| il|il |no |one|ne |to | e |a d|con|ra |per| pe|ato|ion|zio| no|o d|non|ess|ere|nte| un|sta|ch |ono|mo |ice|tto|com|ame|qua|cos|sia|anc|ali',
  pt: ' de|de |os | qu|que| co|ue |do |da |ent|ão | a | se|es |nte|ar |com|ra |o d|se |as |o e|em |ção|ado| do| da|men| pa|par|con|est|ara|um |uma|ma |não|mos| no|a d|s d|e d|ter|por|ela|tem|mas|isso|sso|voc|ocê|eu ',
  ja: 'ます|です|して|した|ている|いる|ない|こと|この|その|ので|から|ました|って|ても|では|まし|ませ|ありが|けど|よね|ってい|けれ|れど|なん|それ|これ|ちょ|ょっと|っと',
};
const PROF = {};
for (const [lang, s] of Object.entries(PROFILES)) { const m = new Map(); s.split('|').forEach((g, i) => m.set(g, 300 - i)); PROF[lang] = m; }
function identify(text) {
  const t = ' ' + text.toLowerCase().replace(/[^\p{L}' ]+/gu, ' ').replace(/\s+/g, ' ') + ' ';
  if (t.length < 12) return null;
  const sc = {}; let tot = 0;
  for (const lang in PROF) sc[lang] = 0;
  for (let i = 0; i < t.length - 2; i++) {
    const g = t.substr(i, 3), g2 = t.substr(i, 2);
    for (const lang in PROF) { const p = PROF[lang]; const v = p.get(g) || (lang === 'ja' ? p.get(g2) : 0); if (v) sc[lang] += v; }
    tot++;
  }
  let best = null, bv = 0, second = 0;
  for (const l in sc) { if (sc[l] > bv) { second = bv; bv = sc[l]; best = l; } else if (sc[l] > second) second = sc[l]; }
  if (!best || bv < tot * 20) return null;
  return { lang: best, conf: bv / (bv + second + 1e-9) };
}
T.identify = identify;
T.languageAds = function (words) {
  const w = words.filter(x => x.start >= 0 && x.end >= x.start).sort((a, b) => a.start - b.start);
  if (!w.length) return [];
  const CH = 24, chunks = [], time = {};
  for (let lo = 0; lo < w.length; lo += CH) {
    const hi = Math.min(w.length, lo + CH);
    const r = hi - lo >= 5 ? identify(w.slice(lo, hi).map(x => x.text).join(' ')) : null;
    const top = r && r.conf >= 0.62 ? r.lang : null;
    chunks.push({ lo, hi, r });
    if (top) time[top] = (time[top] || 0) + Math.max(0.1, w[hi - 1].end - w[lo].start);
  }
  const lab = Object.values(time).reduce((a, b) => a + b, 0);
  const main = Object.keys(time).sort((a, b) => time[b] - time[a])[0];
  if (!lab || !main || time[main] / lab < 0.65) return [];
  const check = chunks.map(() => false);
  chunks.forEach((c, i) => { if (c.r && (c.r.lang !== main || c.r.conf < 0.7)) for (let j = Math.max(0, i - 1); j <= Math.min(chunks.length - 1, i + 1); j++) check[j] = true; });
  const votes = new Map();
  for (let i = 0; i < chunks.length; i++) {
    if (!check[i]) continue;
    let j = i; while (j + 1 < chunks.length && check[j + 1]) j++;
    const from = chunks[i].lo, to = chunks[j].hi; let lo = from, hi = from;
    for (let t = w[from].start; t < w[to - 1].end; t += 1) {
      while (lo < to && w[lo].start < t) lo++;
      if (hi < lo) hi = lo;
      while (hi < to && w[hi].start < t + 3) hi++;
      if (hi - lo >= 5) { const r = identify(w.slice(lo, hi).map(x => x.text).join(' ')); if (r && r.conf >= 0.66) for (let k = lo; k < hi; k++) { let v = votes.get(k); if (!v) votes.set(k, v = {}); v[r.lang] = (v[r.lang] || 0) + 1; } }
    }
    i = j;
  }
  const other = [];
  for (const [k, v] of votes) { const s = Object.entries(v).sort((a, b) => b[1] - a[1]); if (s[0][0] === main) continue; if (s[1] && s[1][1] === s[0][1]) continue; other.push({ start: w[k].start, end: w[k].end }); }
  return PodenDetect.merge(other, 1.5).filter(s => s.end - s.start > 4.5);
};

// ---------- transcript voids ----------
T.speech = function (tr) {
  const out = [];
  for (const l of tr.lines) {
    if (l.words && l.words.length) { for (const w of l.words) if (w.start >= 0 && w.end >= w.start) out.push([w.start, w.end]); }
    else if (l.start >= 0 && l.end > l.start) out.push([l.start, l.end]);
  }
  return out.sort((a, b) => a[0] - b[0]);
};
T.findVoids = function (tr, duration) {
  const sp = T.speech(tr); if (!sp.length) return [];
  const gaps = []; let prev = 0;
  for (const [s, e] of sp) { if (s - prev >= 1) gaps.push({ start: prev, end: s }); prev = Math.max(prev, e); }
  if (duration - prev >= 1) gaps.push({ start: prev, end: duration });
  const merged = []; let j = 0;
  for (const g of gaps) {
    const last = merged[merged.length - 1];
    if (last && g.start - last.end <= 1.5) {
      while (j < sp.length && sp[j][0] < last.end) j++;
      let n = 0, k = j; while (k < sp.length && sp[k][0] < g.start) { n++; k++; }
      if (n <= 3) { last.end = g.end; continue; }
    }
    merged.push({ ...g });
  }
  return merged.map(v => ({ start: v.start === 0 ? 0 : v.start + 0.12, end: v.end >= duration ? duration : v.end - 0.12 })).filter(v => v.end - v.start >= 4.5);
};
const CUES = ['trailer', 'teaser', 'bande-annonce', 'bande annonce', 'extrait', 'on écoute', 'écoutons', "let's listen", 'take a listen', 'have a listen', 'clip', 'tráiler', 'avance', 'escuchamos', 'hören wir', 'anhören', 'spot', 'publicité', 'pub ', 'sponsor'];
T.cueBefore = function (v, tr) {
  const txt = tr.lines.filter(l => l.end <= v.start + 0.5 && l.end >= v.start - 25).map(l => l.text).join(' ').slice(-240).toLowerCase();
  return CUES.some(c => txt.includes(c));
};
T.applyVoids = function (labelled, a) {
  const D = PodenDetect, near = (v, segs, g = 3) => segs.some(s => s.start <= v.end + g && s.end >= v.start - g);
  let music = a.music.slice(), trailers = a.trailers.slice(), ads = (a.ads || []).slice();
  for (const [v, l] of labelled) {
    if (music.some(m => m.end - m.start > 60 && m.start <= v.start + 1 && m.end >= v.end - 1)) continue;
    if (near(v, trailers) || l === 'trailer') trailers.push(v); else if (l === 'ad') ads.push(v); else music.push(v);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of music) if (m.end - m.start <= 60 && near(m, trailers, 1.5) && !trailers.some(t => t.start <= m.start && t.end >= m.end)) { trailers.push(m); changed = true; }
    trailers = D.merge(trailers, 1.5);
  }
  const outAds = D.subtract(D.merge(ads, 1.5), trailers, 4.5);
  return { ...a, trailers, ads: outAds, music: D.subtract(D.merge(music, 1.5), trailers.concat(outAds), 4.5) };
};

// ---------- automatic chapters ----------
const FILLER = new Set(['donc', 'mais', 'voilà', 'ouais', 'alors', 'truc', 'trucs', 'chose', 'choses', 'gens', 'fois', 'temps', 'moment', 'accord', 'genre', 'vous', 'elle', 'nous', 'euh', 'bref', 'enfin', 'quoi', 'machin', 'yeah', 'okay', 'thing', 'things', 'stuff', 'people', 'time', 'kind', 'sort', 'guys', 'like', 'well', 'right',
  'that', 'this', 'with', 'have', 'they', 'what', 'there', 'about', 'just', 'really', 'going', 'know', 'think', 'from', 'were', 'been', 'would', 'could', 'because', 'dans', 'pour', 'avec', 'était', 'c\'est', 'très', 'aussi', 'comme', 'plus', 'tout', 'tous', 'fait', 'faire', 'bien', 'même', 'peut', 'parce', 'était', 'être', 'avoir', 'juste', 'vraiment', 'quand', 'leur', 'cette', 'sont', 'suis', 'avait', 'encore', 'après', 'avant', 'moins', 'beaucoup', 'petit', 'petite', 'deux', 'trois', 'premier', 'faut', 'dire', 'jeux', 'voir', 'rien', 'autre', 'autres', 'chez', 'depuis', 'sans', 'sous', 'entre', 'toujours', 'jamais', 'ailleurs', 'effectivement', 'exactement', 'justement', 'carrément', 'forcément']);
T.autoChapters = function (tr, a, duration) {
  const D = PodenDetect, MIN = 240, MAX = 1500;
  if (!(duration > MIN * 1.5)) return [];
  const breaks = D.merge(a.music.concat(a.trailers, a.ads || []), 2).filter(s => s.end - s.start >= 6);
  let cuts = [0].concat(breaks.map(b => b.end).filter(c => c > 30 && c < duration - 60).sort((x, y) => x - y));
  const sp = T.speech(tr), pauses = [];
  for (let i = 1; i < sp.length; i++) if (sp[i][0] - sp[i - 1][1] >= 4) pauses.push({ at: sp[i][0], len: sp[i][0] - sp[i - 1][1] });
  const merged = [];
  for (const c of cuts) { if (merged.length && c - merged[merged.length - 1] < MIN) continue; merged.push(c); }
  if (merged.length > 1 && duration - merged[merged.length - 1] < MIN / 2) merged.pop();
  const starts = [];
  for (let i = 0; i < merged.length; i++) {
    const s = merged[i], e = i + 1 < merged.length ? merged[i + 1] : duration; starts.push(s);
    let st = s;
    while (e - st > MAX) {
      const lo = st + MIN, hi = Math.min(e - MIN, st + MAX); if (hi <= lo) break;
      const cand = pauses.filter(p => p.at > lo && p.at < hi).sort((x, y) => y.len - x.len)[0];
      let at = cand && cand.at;
      if (at == null) { const mid = (st + Math.min(e, st + MAX)) / 2; const ls = tr.lines.filter(l => l.start >= lo && l.start <= hi); ls.sort((x, y) => Math.abs(x.start - mid) - Math.abs(y.start - mid)); at = ls[0] && ls[0].start; }
      if (at == null) break; starts.push(at); st = at;
    }
  }
  if (starts.length < 2) return [];
  const count = s => { const c = new Map(); for (const m of s.matchAll(/[\p{L}][\p{L}'’-]{3,}/gu)) { const w = m[0], k = w.toLowerCase(); if (FILLER.has(k)) continue; c.set(k, (c.get(k) || 0) + (w[0] !== w[0].toLowerCase() ? 1.6 : 1)); } return c; };
  const textOf = (s, e) => tr.lines.filter(l => l.start >= s && l.start < e).map(l => l.text).join(' ');
  const all = count(textOf(0, duration + 1)); const totalN = [...all.values()].reduce((x, y) => x + y, 0) || 1;
  const used = new Set();
  return starts.map((s, i) => {
    const e = i + 1 < starts.length ? starts[i + 1] : duration;
    const here = count(textOf(s, e)); const localN = [...here.values()].reduce((x, y) => x + y, 0) || 1;
    const scored = [...here].filter(([, n]) => n >= 2).map(([w, n]) => [w, n * Math.log(1 + (n / localN) / ((all.get(w) || n) / totalN))]).sort((x, y) => y[1] - x[1]);
    const top = []; for (const [w] of scored) { if (top.length >= 2) break; if (i > 0 && used.has(w) && scored.length > 3) continue; top.push(w); }
    top.forEach(w => used.add(w));
    const title = top.map(w => w[0].toUpperCase() + w.slice(1)).join(' & ') || (i === 0 ? 'Introduction' : 'Part ' + (i + 1));
    return { start: s, title };
  });
};

// ---------- show notes ----------
const TS = /(?<![\d:])(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)(?![\d:])/g;
T.timestamps = function (s) { const out = []; for (const m of String(s || '').matchAll(TS)) out.push({ index: m.index, length: m[0].length, seconds: (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) }); return out; };
T.noteChapters = function (s) {
  const trim = /^[\s\-–—:|()\[\]•·*.\t]+|[\s\-–—:|()\[\]•·*.\t]+$/g, out = [];
  for (const line of String(s || '').split(/\n/)) {
    const m = T.timestamps(line)[0]; if (!m) continue;
    const after = line.slice(m.index + m.length).replace(trim, ''), before = line.slice(0, m.index).replace(trim, '');
    const title = after || before; if (title) out.push({ start: m.seconds, title });
  }
  return out;
};
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };
T.plain = function (s) {
  let t = String(s || '').replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>|<\/div>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '');
  t = t.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, n) => n[0] === '#' ? (() => { try { return String.fromCodePoint(n[1] === 'x' || n[1] === 'X' ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10)); } catch (_) { return m; } })() : (NAMED[n] ?? m));
  return t.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};

// ---------- transcripts: VTT / SRT / JSON ----------
function tsec(s) { const p = s.trim().replace(',', '.').split(':').map(Number); return p.reduce((a, b) => a * 60 + b, 0); }
T.parseCues = function (s) {
  const out = [];
  for (const block of String(s).replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n'); const i = lines.findIndex(l => l.includes('-->')); if (i < 0) continue;
    const [a, b] = lines[i].split('-->'); const text = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (text) out.push({ start: tsec(a), end: tsec(b.trim().split(' ')[0]), text });
  }
  return out;
};
T.parseTranscriptJSON = function (d) {
  const segs = d.segments || d.transcript || [];
  return segs.map(s => ({ start: +s.startTime || 0, end: +s.endTime || 0, text: String(s.body || '').trim() })).filter(s => s.text);
};

// ---------- search index ----------
T.fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
T.indexLines = function (tr) { return { l: tr.lines.map(l => T.fold(l.text)), s: tr.lines.map(l => l.start) }; };

// ---------- OPML ----------
T.opmlFeeds = function (xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<outline\b[^>]*>/gi)) {
    const a = m[0].match(/\b(?:xmlUrl|xmlurl|url)\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!a) continue;
    const u = T.plain(a[2] ?? a[3]).trim();
    if (/^https?:/i.test(u) && !out.includes(u)) out.push(u);
  }
  return out;
};
T.opmlExport = function (shows) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Poden+ subscriptions</title><dateCreated>' + new Date().toISOString() + '</dateCreated></head>\n  <body>\n' +
    shows.map(p => '    <outline type="rss" text="' + esc(p.title) + '" title="' + esc(p.title) + '" xmlUrl="' + esc(p.feedURL) + '"/>\n').join('') + '  </body>\n</opml>\n';
};

root.PodenText = T;
})(typeof self !== 'undefined' ? self : this);
