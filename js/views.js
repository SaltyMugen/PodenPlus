// Screens. Each renders a string (fast, one innerHTML), then live parts (time, highlight) are updated
// in place by the tick loop — pages never re-render while audio plays.
import { icon, skipIcon } from './icons.js';
import * as M from './model.js';
import * as A from './analyzer.js';
import * as PL from './player.js';
import { P } from './player.js';
import { esc, fmt, long, short, date, dateLong, bytes, cover, iconBtn, pill, seg, sw, empty, marquee, listenLength, rateStr } from './ui.js';
const { lib, settings } = M;
const T = self.PodenText;

// ---------- navigation ----------
export const nav = { tab: 'listenNow', path: [], query: '', nowPlaying: false, mini: false, expanded: new Set(), expandedKind: null };
export const TABS = [['listenNow', 'Listen Now', 'listen'], ['library', 'Library', 'library'], ['upNext', 'Up Next', 'upnext'], ['downloads', 'Downloads', 'download'], ['search', 'Search', 'search']];
export const route = () => nav.path[nav.path.length - 1] || null;

// ---------- shared pieces ----------
export function epRow(e, listKey, showShow = false) {
  const cur = P.episode?.id === e.id, playing = cur && P.isPlaying, played = M.isHeard(e);
  const pos = M.positions.get(e.id), total = e.duration || 0;
  const meta = [showShow && e.podcastTitle, e.date && date(e.date), total > 0 && listenLength(total, e)].filter(Boolean).join(' · ');
  const dl = A.an.progress.get(e.id), down = A.isDownloaded(e);
  const dlBtn = dl != null
    ? `<button class="icon-btn press hov keep" data-act="dl-cancel" data-id="${esc(e.id)}" title="Cancel download" aria-label="Downloading ${Math.round(dl * 100)} percent, cancel"><svg class="ring" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" style="stroke:var(--surface-strong)" stroke-width="2.5"/><circle cx="10" cy="10" r="8" fill="none" style="stroke:var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${Math.max(0.03, dl) * 50.3} 60" transform="rotate(-90 10 10)"/><rect x="7.5" y="7.5" width="5" height="5" rx="1" style="fill:var(--accent)"/></svg></button>`
    : down ? iconBtn('download', 'Remove download', 'dl-del', { size: 16, cls: 'hov keep', attrs: `data-id="${esc(e.id)}"` })
      : iconBtn('downloadO', 'Download', 'dl', { size: 16, cls: 'hov touchhide', attrs: `data-id="${esc(e.id)}"` });
  return `<div class="ep ${cur ? 'current' : ''} ${played ? 'played' : ''}" data-ep="${esc(e.id)}" data-list="${listKey}">
    <button class="play press" data-act="play" aria-label="${playing ? 'Pause' : 'Play'} ${esc(e.title)}">${cover(e.artworkURL)}<span class="pp"><i>${icon(playing ? 'pause' : 'play', 11)}</i></span></button>
    <button class="info press" data-act="open-ep">
      <span class="meta">${M.isQueued(e) ? `<b class="sec heavy">${icon('upnext', 9).replace('<svg', '<svg style="display:inline;vertical-align:-1px"')} Up Next</b> · ` : ''}${esc(meta)}</span>
      <span class="t clamp2">${esc(e.title)}</span>
      ${e.summary ? `<span class="sum clamp2">${esc(e.summary.slice(0, 240))}</span>` : ''}
      ${!played && pos > 10 && total > 0 ? `<span class="left"><span class="progress"><i style="width:${Math.min(100, pos / total * 100)}%"></i></span>${esc(listenLength(total - pos, e))} left</span>` : ''}
    </button>
    <span class="acts">${dlBtn}
      <button class="icon-btn press hov ${played ? 'keep' : ''}" data-act="played" data-id="${esc(e.id)}" title="${played ? 'Played · mark as unplayed' : 'Mark as played'}" aria-label="${played ? 'Mark as unplayed' : 'Mark as played'}" style="color:${played ? 'var(--primary)' : 'var(--secondary)'}">${icon(played ? 'checkC' : 'circle', 16)}</button>
      <button class="icon-btn press" data-act="ep-menu" data-id="${esc(e.id)}" title="More" aria-label="More actions">${icon('ellipsis', 16)}</button>
    </span></div>`;
}
const title = t => `<h1 class="title">${esc(t)}</h1>`;
const header = (t, trailing = '') => `<div class="header"><h2>${esc(t)}</h2>${trailing}</div>`;
// Lists are registered so row clicks know which queue to play from.
export const lists = new Map();
const reg = (key, eps) => { lists.set(key, eps); return key; };

// ---------- Listen Now ----------
function listenNow() {
  const cont = M.inProgress();
  const latest = lib.podcasts.flatMap(p => p.episodes.slice(0, 3).filter(e => !M.isHeard(e))).sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 24);
  if (!lib.podcasts.length) return `<div class="page stack gap34">${title('Listen Now')}${empty('wave', 'Welcome to Poden+', 'Add a show to start. Poden+ finds and skips interludes and extras, and transcribes episodes — all on this device.', ['Find a Show', 'go:search'])}
    <div class="empty" style="padding-top:0"><p class="cap">Coming from Poden+ for Mac? Import your library from <b>Settings → Library</b>.</p></div></div>`;
  const hero = cont[0] || latest[0];
  let h = `<div class="page stack gap34">${title('Listen Now')}`;
  if (hero) h += heroCard(hero);
  if (M.skippedTotal() >= 60) h += savedCard();
  if (cont.length > 1) h += `<div class="stack gap12">${header('Continue Listening')}<div class="hscroll">${cont.slice(1).map(contCard).join('')}</div></div>`;
  reg('latest', latest);
  h += `<div class="stack gap6">${header('Latest Episodes')}<div>${latest.map(e => epRow(e, 'latest', true)).join('')}</div></div></div>`;
  return h;
}
function heroCard(e) {
  const pos = M.positions.get(e.id), total = e.duration || 0, playing = P.episode?.id === e.id && P.isPlaying;
  reg('hero', M.listFor(e));
  return `<div class="hero" data-ep="${esc(e.id)}" data-list="hero">${cover(e.artworkURL, 0, 'shadow')}
    <div class="stack gap6 grow"><span class="eyebrow">${pos > 10 ? 'Pick up where you left off' : 'New episode'}</span>
      <h3 class="clamp3">${esc(e.title)}</h3><span class="sec">${esc(e.podcastTitle || '')}</span>
      ${pos > 10 && total > 0 ? `<div class="row g10"><span class="progress" style="width:150px"><i style="width:${pos / total * 100}%"></i></span><span class="cap sec">${esc(listenLength(total - pos, e))} left</span></div>` : ''}
      <div class="row g10" style="margin-top:12px">${pill(playing ? 'Pause' : pos > 10 ? 'Resume' : 'Play', 'play', { sym: playing ? 'pause' : 'play', prominent: true })}${pill('Details', 'open-ep')}</div></div></div>`;
}
function contCard(e) {
  const pos = M.positions.get(e.id), total = e.duration || 0;
  reg('c:' + e.id, M.listFor(e));
  return `<button class="ccard press" data-ep="${esc(e.id)}" data-list="c:${esc(e.id)}" data-act="play" data-ctx="ep-menu">${cover(e.artworkURL)}
    <span class="stack gap6 grow"><span class="bold callout clamp2">${esc(e.title)}</span><span class="cap sec">${total > 0 ? esc(listenLength(total - pos, e)) + ' left' : fmt(pos)}</span>
    <span class="progress" style="width:120px"><i style="width:${total > 0 ? pos / total * 100 : 0}%"></i></span></span></button>`;
}
function savedCard() {
  const parts = ['music', 'trailer', 'ad'].map(k => { const s = M.skippedKind(k); return s >= 1 ? `${short(s)} ${M.plural(k)}` : null; }).filter(Boolean);
  return `<div class="saved"><span class="ic">${icon('forwardF', 22)}</span><div class="stack"><b style="font-size:var(--fs-title3)">${long(M.skippedThisMonth())} skipped this month</b>
    <span class="callout sec">${long(M.skippedTotal())} saved in total${parts.length ? ' · ' + parts.join(' · ') : ''}</span></div></div>`;
}

// ---------- Library ----------
function library() {
  const pend = [...M.adding].filter(([u]) => !lib.podcasts.some(p => p.feedURL === u));
  if (!lib.podcasts.length && !pend.length) return `<div class="page stack gap24">${title('Library')}${empty('library', 'No shows yet', 'Shows you add appear here.', ['Find a Show', 'go:search'])}</div>`;
  return `<div class="page stack gap24">${title('Library')}<div class="grid">${lib.podcasts.map(p => { const n = M.unplayed(p);
    return `<button class="tile press" data-act="open-show" data-show="${esc(p.id)}" data-ctx="show-menu">${cover(p.artworkURL, 0).replace('</div>', n ? `<span class="count mono">${n}</span></div>` : '</div>')}<span class="bold callout clamp2">${esc(p.title)}</span></button>`; }).join('')}
    ${pend.map(([u, x]) => `<div class="tile" aria-busy="true" style="opacity:.6">${cover(x.artwork, 0).replace('</div>', '<span class="count"><span class="spinner"></span></span></div>')}<span class="bold callout clamp2">${esc(x.title)}</span><span class="cap sec">Adding…</span></div>`).join('')}</div></div>`;
}

// ---------- Up Next ----------
function upNext() {
  let h = `<div class="page stack gap24"><div class="header">${title('Up Next')}${lib.upNext.length ? pill('Clear', 'queue-clear', { sym: 'x' }) : ''}</div>`;
  if (P.episode) { reg('np', [P.episode]); h += `<div class="stack gap6">${header('Now Playing')}${epRow(P.episode, 'np', true)}</div>`; }
  if (!lib.upNext.length) h += empty('upnext', 'Nothing queued', 'Use ••• or right-click on any episode and choose Play Next or Add to Up Next. Queued episodes play before the rest of the list.');
  else {
    reg('queue', lib.upNext);
    h += `<div class="stack gap6">${header('Queue · ' + lib.upNext.length)}${lib.upNext.map((e, i) => `<div class="row g6">
      <div class="stack">${iconBtn('chevU', 'Move up', 'q-up', { size: 11, attrs: `data-i="${i}" ${i === 0 ? 'disabled' : ''}` })}${iconBtn('chevD', 'Move down', 'q-down', { size: 11, attrs: `data-i="${i}" ${i === lib.upNext.length - 1 ? 'disabled' : ''}` })}</div>
      <div class="grow">${epRow(e, 'queue', true)}</div>${iconBtn('minusC', 'Remove from Up Next', 'q-remove', { size: 15, attrs: `data-id="${esc(e.id)}"` })}</div>`).join('')}</div>`;
  }
  return h + '</div>';
}

// ---------- Downloads ----------
function downloads() {
  const all = lib.podcasts.flatMap(p => p.episodes);
  const act = all.filter(e => A.an.progress.has(e.id)), done = all.filter(e => A.isDownloaded(e));
  let h = `<div class="page stack gap28"><div class="header">${title('Downloads')}<span class="callout semi sec">${bytes(A.bytesOnDisk())}</span></div>`;
  if (!act.length && !done.length) h += empty('downloadO', 'Nothing downloaded', 'Downloads play offline and are scanned for interludes and extras automatically. Choose how many download per show in Settings.');
  if (act.length) { reg('dl-act', act); h += `<div class="stack gap6">${header('Downloading')}${act.map(e => epRow(e, 'dl-act', true)).join('')}</div>`; }
  if (done.length) { reg('dl-done', done); h += `<div class="stack gap6">${header('On This Device', pill('Remove All', 'dl-all', { sym: 'trash' }))}${done.map(e => epRow(e, 'dl-done', true)).join('')}</div>`; }
  return h + '</div>';
}

// ---------- Search ----------
function search() {
  const q = nav.query;
  return `<div class="page stack gap20">${title('Search')}
    <label class="search">${icon('search', 18)}<input id="q" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search shows, transcripts, or paste an RSS link" value="${esc(q)}" aria-label="Search shows and transcripts">${lib.busy ? '<span class="spinner"></span>' : ''}</label>
    <div id="tr-results"></div>
    ${lib.error ? `<p class="sec">${esc(lib.error)}</p>` : ''}
    ${lib.results.length ? header('Shows') + `<div class="grid">${lib.results.map(r => { const added = lib.podcasts.find(p => p.feedURL === r.feedUrl), busy = M.adding.has(r.feedUrl);
      return `<div class="tile">${cover(r.artworkUrl600 || r.artworkUrl100)}<span class="bold callout clamp2">${esc(r.collectionName)}</span><span class="cap sec nowrap">${esc(r.artistName || '')}</span>
      ${added ? pill('Added', 'open-show', { sym: 'check', attrs: `data-show="${esc(added.id)}"` }) : busy ? `<span class="pill" aria-busy="true"><span class="spinner"></span>Adding…</span>` : pill('Add', 'add-show', { sym: 'plus', prominent: true, attrs: `data-url="${esc(r.feedUrl)}" data-art="${esc(r.artworkUrl600 || '')}" data-itunes="${r.collectionId || ''}" data-title="${esc(r.collectionName)}"` })}</div>`; }).join('')}</div>`
      : q.length >= 2 && !/^https?:/.test(q) ? `<p class="callout ter">Press Return to search the podcast directory for “${esc(q)}”.</p>` : ''}</div>`;
}
let trSeq = 0;
export async function renderTranscriptHits(q) {
  const el = document.getElementById('tr-results'); if (!el) return;
  if (/^https?:/.test(q) || q.trim().length < 2) { el.innerHTML = ''; return; }
  const my = ++trSeq, hits = A.searchTranscripts(q);
  if (!hits.length) { el.innerHTML = A.an.index.size ? `<p class="callout sec">No transcript mentions “${esc(q)}”.</p>` : ''; return; }
  const groups = new Map(); for (const h of hits) { if (!groups.has(h.id)) groups.set(h.id, []); groups.get(h.id).push(h); }
  const parts = [];
  for (const [id, hs] of [...groups].slice(0, 20)) {
    const e = lib.byId.get(id); if (!e) continue;
    const rows = [];
    for (const h of hs.slice(0, 5)) {
      const text = await A.hitText(h); if (my !== trSeq) return;
      const f = T.fold(text), at = f.indexOf(T.fold(q.trim())), a = Math.max(0, at - 60), b = Math.min(text.length, at + h.len + 90);
      const snip = (a > 0 ? '…' : '') + esc(text.slice(a, at)) + '<mark>' + esc(text.slice(at, at + h.len)) + '</mark>' + esc(text.slice(at + h.len, b)) + (b < text.length ? '…' : '');
      rows.push(`<button class="hit press" data-act="hit" data-id="${esc(id)}" data-t="${h.start}"><b class="cap heavy sec mono" style="min-width:52px">${h.start >= 0 ? fmt(h.start) : '—'}</b><span class="grow">${snip}</span>${icon('play', 10)}</button>`);
    }
    parts.push(`<div class="card stack gap6" style="padding:12px"><div class="row g10">${cover(e.artworkURL, 36)}<div class="grow"><div class="bold callout nowrap">${esc(e.title)}</div><div class="cap sec nowrap">${esc(e.podcastTitle || '')}</div></div></div>${rows.join('')}
      ${hs.length > 5 ? `<button class="cap bold sec press" style="text-align:left" data-act="open-tr" data-id="${esc(id)}">${hs.length - 5} more in this episode</button>` : ''}</div>`);
  }
  if (my === trSeq) el.innerHTML = `<div class="stack gap12">${header(`In Transcripts · ${hits.length}${hits.length >= 200 ? '+' : ''}`)}${parts.join('')}</div>`;
}

// ---------- Show ----------
function show(id) {
  const p = M.podcast(id); if (!p) return `<div class="page">${empty('x', 'Show not found', 'It may have been removed.')}</div>`;
  const eps = M.visible(p); reg('show', eps);
  const first = eps.find(e => M.positions.get(e.id) > 10 && !M.isHeard(e)) || eps.find(e => !M.isHeard(e)) || eps[0];
  const open = nav.expanded.has(p.id), prefs = lib.prefs[p.id] || {};
  const ml = [`Interludes: ${M.modeTitle(prefs.music ?? settings.musicMode)}`, `Extras: ${M.modeTitle(prefs.trailers ?? settings.trailerMode)}`, `Ads: ${M.modeTitle(prefs.ads ?? settings.adMode)}`].join(' · ') + (prefs.keepIntro ? ' · keep intro' : '');
  const custom = prefs.music != null || prefs.trailers != null || prefs.ads != null || prefs.keepIntro;
  let h = `<div class="page stack gap28"><div class="headline">${cover(p.artworkURL, 0, 'shadow')}<div class="stack gap6 grow">
    <h1>${esc(p.title)}</h1>${p.author ? `<div class="sec" style="font-size:var(--fs-title3)">${esc(p.author)}</div>` : ''}
    ${p.summary ? `<div class="sec ${open ? '' : 'clamp3'}" style="white-space:pre-wrap">${esc(p.summary)}</div><button class="callout semi sec press" style="text-align:left" data-act="expand" data-show="${esc(p.id)}">${open ? 'Show Less' : 'Show More'}</button>` : ''}
    <div class="row g10" style="margin-top:6px">${first ? pill(M.positions.get(first.id) > 10 ? 'Resume' : 'Play Latest', 'play-first', { sym: 'play', prominent: true, attrs: `data-id="${esc(first.id)}"` }) : ''}
      <button class="icon-btn press" style="background:var(--surface-strong)" data-act="show-menu" data-show="${esc(p.id)}" aria-label="More actions">${icon('ellipsis', 16)}</button></div>
    <div class="row g8" style="flex-wrap:wrap"><button class="chip press" data-act="show-skip" data-show="${esc(p.id)}" style="color:${custom ? 'var(--primary)' : 'var(--secondary)'}" aria-label="Skipping for this show">${icon('music', 12)}${esc(ml)}</button>
      ${prefs.speed != null ? `<span class="chip" title="This show always plays at ${rateStr(prefs.speed)}. Change it from the speed menu while playing.">${icon('speed', 12)}${rateStr(prefs.speed)}</span>` : ''}</div>
  </div></div>
  <div class="stack gap6">${header(eps.length + ' Episodes', `<label class="row g8 callout" style="cursor:pointer">Hide played ${sw(settings.hideHeard, 'hide-heard', 'Hide played')}</label>`)}
  <div data-vlist="show"></div>${!eps.length ? empty('checkC', 'All caught up', 'Played episodes are hidden.') : ''}</div></div>`;
  return h;
}

// ---------- Episode ----------
function episode(e) {
  const list = M.listFor(e); reg('ep', list);
  const played = M.isHeard(e), playing = P.episode?.id === e.id && P.isPlaying, older = M.older(e).length;
  const chs = A.chapters(e), dl = A.an.progress.get(e.id);
  const meta = [dateLong(e.date), e.duration > 0 && listenLength(e.duration, e)].filter(Boolean).join(' · ');
  A.transcript(e);
  return `<div class="page narrow stack gap28" data-ep="${esc(e.id)}" data-list="ep"><div class="headline ep">${cover(e.artworkURL, 0, 'shadow')}<div class="stack gap6 grow">
    ${e.podcastTitle ? `<button class="callout semi sec press" style="text-align:left" data-act="open-show" data-show="${esc(e.podcastID)}">${esc(e.podcastTitle)}</button>` : ''}
    <h1 class="t2">${esc(e.title)}</h1><span class="callout sec">${esc(meta)}</span>
    <div class="row g10" style="flex-wrap:wrap;margin-top:8px">${pill(playing ? 'Pause' : M.positions.get(e.id) > 10 ? 'Resume' : 'Play', 'play', { sym: playing ? 'pause' : 'play', prominent: true })}
      ${pill(played ? 'Played' : 'Mark Played', 'played', { sym: played ? 'checkC' : 'circle', attrs: `data-id="${esc(e.id)}"` })}
      ${older ? pill(`Mark ${older} Older as Played`, 'older', { sym: 'checkC', attrs: `data-id="${esc(e.id)}" title="Marks this episode and every episode released before it as played"` }) : ''}
      ${dl != null ? pill(Math.round(dl * 100) + '%', 'dl-cancel', { sym: 'x', attrs: `data-id="${esc(e.id)}"` }) : A.isDownloaded(e) ? pill('Downloaded', 'dl-del', { sym: 'check', attrs: `data-id="${esc(e.id)}" title="Remove download"` }) : pill('Download', 'dl', { sym: 'downloadO', attrs: `data-id="${esc(e.id)}"` })}
      <button class="icon-btn press" style="background:var(--surface-strong)" data-act="ep-menu" data-id="${esc(e.id)}" aria-label="More actions">${icon('ellipsis', 16)}</button></div></div></div>
    ${P.episode?.id === e.id ? `<div class="panel stack gap6" style="padding:10px 14px"><div data-scrub="26"></div><div class="times" data-times="info"></div></div>` : ''}
    ${chs.length ? `<div class="stack gap6">${header('Chapters', A.isAutoChapters(e) ? `<span class="cap ter row g6">${icon('sparkles', 11)} Made on this device</span>` : '')}<div class="chapters" data-chapters="${esc(e.id)}"></div></div>` : ''}
    <div class="stack gap12">${header('Transcript', A.an.transcripts.get(e.id) ? pill('Open', 'open-tr', { sym: 'expand', attrs: `data-id="${esc(e.id)}"` }) : '')}
      <div class="panel" style="height:280px;padding:0 14px;display:flex;flex-direction:column"><div class="tr fade-y" data-tr="${esc(e.id)}" data-size="15"></div></div></div>
    ${e.summary ? `<div class="stack gap12">${header('Show Notes')}<div class="notes">${linkify(e.summary, e.id)}</div></div>` : ''}</div>`;
}
function linkify(s, id) {
  const marks = [];
  for (const m of T.timestamps(s)) marks.push([m.index, m.length, `<a href="#" data-act="seek-note" data-id="${esc(id)}" data-t="${m.seconds}">`]);
  for (const m of s.matchAll(/\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g)) marks.push([m.index, m[0].length, `<a href="${esc(m[0])}" target="_blank" rel="noopener noreferrer">`]);
  marks.sort((a, b) => a[0] - b[0]);
  let out = '', i = 0;
  for (const [at, len, tag] of marks) { if (at < i) continue; out += esc(s.slice(i, at)) + tag + esc(s.slice(at, at + len)) + '</a>'; i = at + len; }
  return out + esc(s.slice(i));
}

// ---------- Transcript page ----------
function transcriptPage(e) {
  const playing = P.episode?.id === e.id && P.isPlaying; A.transcript(e); reg('trp', M.listFor(e));
  return `<div class="page narrow stack gap12" style="height:100%;display:flex;flex-direction:column;padding-bottom:0" data-ep="${esc(e.id)}" data-list="trp">
    <div class="row g14" style="flex-wrap:wrap">${cover(e.artworkURL, 56)}<div class="grow stack"><span class="cap semi sec">${esc(e.podcastTitle || '')}</span><b class="clamp2" style="font-size:var(--fs-title2);font-weight:900">${esc(e.title)}</b>
      ${A.an.transcripts.get(e.id)?.generated ? '<span class="cap ter">Transcribed on this device</span>' : ''}</div>${transcriptTools()}${pill(playing ? 'Pause' : 'Play', 'play', { sym: playing ? 'pause' : 'play', prominent: true })}</div>
    <div class="tr fade-y" data-tr="${esc(e.id)}" data-size="${settings.transcriptSize}" style="flex:1"></div></div>`;
}
export const transcriptTools = () => `<span class="row g6">${iconBtn('aSmall', 'Smaller text', 'tr-smaller', { size: 13 })}${iconBtn('aLarge', 'Larger text', 'tr-larger', { size: 13 })}
  <button class="icon-btn press ${settings.follow ? 'active' : ''}" data-act="follow" title="Follow playback: ${settings.follow ? 'On' : 'Off'}" aria-label="Follow playback" aria-pressed="${settings.follow}" style="${settings.follow ? '' : 'background:var(--surface)'}">${icon('locate', 12)}</button></span>`;

// ---------- Settings ----------
function settingsPage() {
  const s = settings, g = (t, body, foot) => `<div class="group stack gap6"><span class="eyebrow">${esc(t)}</span><div class="card">${body}</div>${foot ? `<p class="foot">${foot}</p>` : ''}</div>`;
  const row = (l, c) => `<div class="srow"><span class="lbl">${l}</span>${c}</div>`;
  const themes = [['classic', 'Poden+', '#000', '#000', '#fff', '#ffd100', 'rgba(255,255,255,.13)'], ['girly', 'Blossom', '#ffdbed', '#fae6ff', '#5c0d38', '#b80f66', 'rgba(204,26,115,.13)'], ['mono', 'Mono', '#000', '#000', '#fff', '#dbdbdb', 'rgba(255,255,255,.13)'], ['cover', 'Cover', 'var(--cv-bg2,#1a1300)', 'var(--cv-bg3,#0a0700)', 'var(--cv-ink,#fff)', 'var(--cv-accent,#ffd100)', 'rgba(255,255,255,.13)']];
  const modeSeg = k => seg([2, 1, 0], s[k], 'set-' + k, M.modeTitle);
  return `<div class="page settings stack gap28">${title('Settings')}
  ${g('Theme', `<div class="themes" style="padding:6px">${themes.map(([id, name, b1, b2, ink, acc, surf]) => `<button class="tp press ${s.theme === id ? 'on' : ''}" data-act="theme" data-v="${id}" aria-pressed="${s.theme === id}" title="${id === 'cover' ? 'Colours from the cover of the episode that’s playing' : name}" style="--pv-accent:${acc}">
    <span class="pv" style="background:linear-gradient(135deg,${b1},${b2})"><b style="background:${id === 'cover' ? acc : surf}"></b><span class="stack" style="gap:4px"><i style="width:46px;background:${ink}"></i><i style="width:32px;background:${ink};opacity:.7"></i></span><u style="background:${acc}"></u><s style="background:${acc}"></s></span>
    <span class="callout bold" style="color:${s.theme === id ? 'var(--primary)' : 'var(--secondary)'}">${name}</span></button>`).join('')}</div>`)}
  ${g('Text', row('Text size', seg(M.OPTIONS.scales, s.textScale, 'set-textScale', M.scaleName)), 'Makes the text across Poden+ larger or smaller. The transcript has its own size below.')}
  ${g('Playback', row('Skip back', seg(M.OPTIONS.back, s.skipBack, 'set-skipBack', v => v + 's')) + row('Skip forward', seg(M.OPTIONS.forward, s.skipForward, 'set-skipForward', v => v + 's')))}
  ${g('Smart skipping', row('Interludes', modeSeg('musicMode')) + row('Extras', modeSeg('trailerMode')) + row('Ads (other languages)', modeSeg('adMode')) + row('Skip silence', sw(s.skipSilence, 'set-skipSilence', 'Skip silence')),
    'Interludes (music), extras (trailers, teasers and clips), ads and pauses over a second are found on this device. Ads are stretches of more than 4.5 seconds in another language, in an episode that’s at least 65 % one language. Automatic skips them as you listen; Suggest shows a Skip button while they play; Off plays everything. Each show can override these on its page.')}
  ${g('Downloads', row('Auto-download', seg(M.OPTIONS.downloads, s.autoDownload, 'set-autoDownload', v => v ? String(v) : 'Off')) + row('Remove played downloads', sw(s.removePlayed, 'set-removePlayed', 'Remove played downloads')) + row('Storage · ' + bytes(A.bytesOnDisk()), pill('Remove All', 'dl-all', { sym: 'trash' })),
    'Newest unplayed episodes kept per show. Every download is scanned for interludes and extras. Downloads are kept in this browser’s storage.')}
  ${g('Subscriptions', row(lib.podcasts.length + ' shows', `<span class="row g8">${pill('Import…', 'opml-import', { sym: 'importI' })}${pill('Export…', 'opml-export', { sym: 'share' })}</span>`), 'OPML is the standard file other podcast apps use to move your shows.')}
  ${g('Library', row('Back up or move', `<span class="row g8">${pill('Import…', 'backup-import', { sym: 'importI' })}${pill('Export…', 'backup-export', { sym: 'share' })}</span>`), 'Moves shows, played state, positions, per-show settings, time saved — and scans and transcripts made by Poden+ for Mac — between devices in one file.')}
  ${g('Transcripts', row('Text size · ' + s.transcriptSize + ' pt', `<span class="row g6">${iconBtn('aSmall', 'Smaller text', 'tr-smaller')}${iconBtn('aLarge', 'Larger text', 'tr-larger')}</span>`), 'Published transcripts are used automatically. Transcripts made by Poden+ for Mac come across with a library import.')}
  ${g('Network', `<div class="srow" style="flex-wrap:wrap"><span class="lbl">Feed relay</span><input id="relay" class="search" style="min-height:40px;flex:1;min-width:220px;font-size:var(--fs-callout)" placeholder="https://your-relay.example/?url=" value="${esc(s.relay)}" spellcheck="false" autocapitalize="off"></div>`,
    'Many podcast hosts don’t let web pages read their feeds or audio directly. Poden+ tries directly first, then public relays. Your own relay (e.g. a free Cloudflare Worker) is the most reliable; it’s tried second. Use {url} to place the address, otherwise it’s appended.')}
  ${g('App', row('Install Poden+', `<span class="cap sec" style="max-width:340px;text-align:right">${isStandalone() ? 'Installed — running as an app.' : /iPhone|iPad/.test(navigator.userAgent) ? 'Safari: Share → Add to Home Screen' : 'Browser menu → Install Poden+'}</span>`) + row('Keyboard shortcuts', pill('Show', 'shortcuts', { sym: 'list' })))}
  <p class="foot" style="text-align:center">Poden+ web · everything stays on this device</p></div>`;
}
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;

export function renderPage() {
  const r = route(); lists.clear();
  if (r) return r.type === 'show' ? show(r.id) : r.type === 'episode' ? episode(r.ep) : r.type === 'transcript' ? transcriptPage(r.ep) : settingsPage();
  return { listenNow, library, upNext, downloads, search }[nav.tab]();
}

// ---------- Now Playing / mini ----------
export function panel(e, big) {
  return `<div class="pnl">${cover(e.artworkURL, big, P.isPlaying ? '' : 'paused').replace('class="cover', 'data-npcover class="cover')}
    <div class="ttl">${marquee(e.title, '', true)}</div><div class="sub" data-sub></div>
    <div class="prog"><div data-scrub="${big > 200 ? 26 : 18}"></div><div class="times" data-times="info"></div></div>
    <div class="transport large" data-transport="full"></div>
    <div class="sec-row" data-secrow></div>
    <div class="detected" data-detected="${esc(e.id)}"></div></div>`;
}
export function transport(full) {
  const hn = PL.hasNext(), L = full === 'large', sk = L ? 30 : 22;
  return `${full ? iconBtn('prev', 'Previous episode', 'prev', { size: L ? 16 : 13 }) : ''}
    <button class="icon-btn press" data-act="back" title="Back ${settings.skipBack} seconds" aria-label="Back ${settings.skipBack} seconds">${skipIcon(false, settings.skipBack, sk)}</button>
    <button class="playbtn press" data-act="toggle" aria-label="${P.isPlaying ? 'Pause' : 'Play'}">${icon(P.isPlaying ? 'pause' : 'play', L ? 26 : 17)}</button>
    <button class="icon-btn press" data-act="fwd" title="Forward ${settings.skipForward} seconds" aria-label="Forward ${settings.skipForward} seconds">${skipIcon(true, settings.skipForward, sk)}</button>
    ${full ? iconBtn('next', 'Next episode', 'next', { size: L ? 16 : 13, attrs: hn ? '' : 'disabled' }) : ''}`;
}
export function speedBtn() {
  const pinned = P.episode && lib.prefs[P.episode.podcastID]?.speed != null;
  return `<button class="speed press ${P.rate !== 1 || pinned ? 'set' : ''}" data-act="speed-menu" title="${pinned ? 'Playback speed (saved for this show)' : 'Playback speed'}" aria-label="Playback speed ${rateStr(P.rate)}">${rateStr(P.rate)}${pinned ? icon('pin', 8) : ''}</button>`;
}
export function sleepBtn() {
  const on = P.sleepAt || P.sleepAtEnd, r = PL.sleepRemaining();
  return `<button class="sleep press ${on ? 'on' : ''}" data-act="sleep-menu" title="Sleep timer" aria-label="Sleep timer ${r ? Math.ceil(r / 60) + ' minutes left' : P.sleepAtEnd ? 'end of episode' : 'off'}">${icon(on ? 'moonF' : 'moon', 14)}${r != null ? `<span data-sleep class="mono">${Math.ceil(r / 60)}m</span>` : P.sleepAtEnd ? 'End' : ''}</button>`;
}
export function modeChips() {
  const s = settings, chip = (sym, label, m, act, two) => { const t = x => two ? (x === 2 ? 'Skip' : 'Off') : M.modeTitle(x); const nx = two ? (m === 2 ? 0 : 2) : [1, 2, 0][m];
    return `<button class="mode press ${m === 2 ? 'auto' : m === 1 ? 'suggest' : ''}" data-act="${act}" title="${label}: ${t(m)} · click for ${t(nx)}" aria-label="${label} skipping, ${t(m)}">${icon(sym, 12)}</button>`; };
  return `<span class="modes">${chip('music', 'Interludes', s.musicMode, 'cycle-music')}${chip('film', 'Extras', s.trailerMode, 'cycle-trailer')}${chip('megaphone', 'Ads', s.adMode, 'cycle-ad')}${chip('wave', 'Silence', s.skipSilence ? 2 : 0, 'cycle-silence', true)}</span>`;
}
export function volume(w = 96) {
  const v = P.volume;
  return `<span class="vol">${iconBtn(v === 0 ? 'spk0' : v < 0.5 ? 'spk1' : 'spk2', v === 0 ? 'Unmute' : 'Mute', 'mute', { size: 13 })}<input type="range" min="0" max="1" step="0.01" value="${v}" data-act="volume" aria-label="Volume" style="--w:${w}px;--v:${v * 100}%"></span>`;
}
export function detected(e) {
  const a = A.analysis(e.id), st = A.an.status.get(e.id);
  if (st) return `<div class="det"><span class="status">${esc(st)}</span></div>`;
  if (A.an.blocked.has(e.id)) return `<div class="det"><span class="status" title="The podcast host doesn’t let web pages read its audio. Add a relay in Settings → Network, or import from Poden+ for Mac.">Skipping unavailable for this host · plays normally</span></div>`;
  if (!A.upToDate(e.id)) return `<div class="det"><span class="status">Scanning for interludes and extras…</span></div>`;
  const kinds = [['music', a.music || [], 'var(--music)'], ['trailer', a.trailers || [], 'var(--trailer)']];
  const openK = kinds.find(k => nav.expandedKind === k[0] && k[1].length);
  let h = `<div class="det">${kinds.map(([k, items, c]) => { const n = items.length, tot = items.reduce((s, x) => s + x.end - x.start, 0);
    return `<button class="press ${openK?.[0] === k ? 'open' : ''}" data-act="kind" data-k="${k}" ${n ? '' : 'disabled'} aria-expanded="${openK?.[0] === k}"><i class="sw" style="background:${c};opacity:${n ? 1 : .4}"></i>${n ? `${n} ${n === 1 ? M.noun(k) : M.plural(k)} · ${fmt(tot)}` : 'No ' + M.plural(k)}${n ? icon(openK?.[0] === k ? 'chevU' : 'chevD', 9) : ''}</button>`; }).join('')}</div>`;
  if (openK) h += `<div class="chips">${openK[1].map(s => { const inside = P.episode?.id === e.id && P.time >= s.start && P.time < s.end, heard = P.listening.has(s.start);
    return `<button class="press ${inside ? 'in' : ''}" data-act="listen" data-k="${openK[0]}" data-s="${s.start}" title="Play this ${M.noun(openK[0])}">${icon(heard ? 'spk2' : 'play', 10)}${fmt(s.start)} · ${Math.round(s.end - s.start)}s</button>`; }).join('')}</div>`;
  return h;
}
export function npTabs() {
  return `<div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap">${seg(['chapters', 'transcript'], settings.npTab, 'np-tab', v => v[0].toUpperCase() + v.slice(1))}<span data-trtools>${settings.npTab === 'transcript' ? transcriptTools() : ''}</span></div>`;
}
