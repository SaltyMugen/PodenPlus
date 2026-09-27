// Inline SVG icons (SF Symbols look-alikes). One string each; rendered on demand, never fetched.
const P = (d, fill = true) => fill ? `<path fill="currentColor" d="${d}"/>` : `<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`;
const I = {
  play: P('M7 4.8v14.4c0 .9 1 1.4 1.7.9l11-7.2c.7-.4.7-1.4 0-1.8l-11-7.2C8 3.4 7 3.9 7 4.8z'),
  pause: P('M6 4h4v16H6zM14 4h4v16h-4z'),
  prev: P('M6 5h2.5v14H6zM19 5.6v12.8c0 .8-.9 1.3-1.6.8L9 12.8a1 1 0 0 1 0-1.6l8.4-6.4c.7-.5 1.6 0 1.6.8z'),
  next: P('M15.5 5H18v14h-2.5zM5 5.6v12.8c0 .8.9 1.3 1.6.8L15 12.8a1 1 0 0 0 0-1.6L6.6 4.8C5.9 4.3 5 4.8 5 5.6z'),
  back: P('M4.6 8.6A8.5 8.5 0 1 1 3.5 13M4.2 3.8v5.2h5.2', false),
  fwd: P('M19.4 8.6A8.5 8.5 0 1 0 20.5 13M19.8 3.8v5.2h-5.2', false),
  listen: P('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 6.2 6 3.8-6 3.8z'),
  library: P('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'),
  upnext: P('M4 6h16M4 12h10M4 18h13M17.5 13.5l3 2.5-3 2.5', false),
  download: P('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v6.2l2.3-2.3 1.4 1.4L12 17l-4.7-4.7 1.4-1.4 2.3 2.3z'),
  downloadO: P('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v8M8.5 12l3.5 3.5 3.5-3.5', false),
  search: P('M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20', false),
  gear: P('M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z'),
  chevL: P('M15 18l-6-6 6-6', false), chevD: P('M6 9l6 6 6-6', false), chevU: P('M6 15l6-6 6 6', false),
  x: P('M6 6l12 12M18 6 6 18', false),
  check: P('M5 12.5l4.5 4.5L19 7.5', false),
  checkC: P('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-4.3-4.3 1.4-1.4 2.9 2.9 5.9-5.9 1.4 1.4z'),
  circle: P('M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', false),
  plus: P('M12 5v14M5 12h14', false),
  minusC: P('M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8 12h8', false),
  ellipsis: P('M5 10.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zm7 0a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zm7 0a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z'),
  music: P('M9 17.5V6l11-2v11.5M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM20 15.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z', false),
  film: P('M4 5h16v14H4zM8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4', false),
  megaphone: P('M3 10v4c0 .6.4 1 1 1h2l1 5h3l-1-5 9 4V5L9 9H4c-.6 0-1 .4-1 1z'),
  wave: P('M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2M21 12h0', false),
  moon: P('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z', false),
  moonF: P('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'),
  spk0: P('M4 9v6h4l5 4V5L8 9zM16 9l5 5M21 9l-5 5', false),
  spk1: P('M4 9v6h4l5 4V5L8 9zM16 9.5a3.5 3.5 0 0 1 0 5', false),
  spk2: P('M4 9v6h4l5 4V5L8 9zM16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10', false),
  pip: P('M3 5h18v14H3zM12 11h7v6h-7z', false),
  expand: P('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', false),
  shrink: P('M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5', false),
  bubble: P('M4 5h16v11H9l-5 4z', false),
  list: P('M8 6h12M8 12h12M8 18h12M4 6h0M4 12h0M4 18h0', false),
  locate: P('M12 2 4.5 20l7.5-4 7.5 4z'),
  aSmall: P('M4 18 8.5 7h1L14 18M5.7 14.5h6.6', false),
  aLarge: P('M3 20 9 4h1.5l6 16M5 15h9.5M18 8v6M15 11h6', false),
  trash: P('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', false),
  share: P('M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v8h14v-8', false),
  importI: P('M12 15V3M7.5 10.5 12 15l4.5-4.5M5 12v8h14v-8', false),
  pin: P('M9 3h6l-1 6 3 3H7l3-3zM12 12v9', false),
  speed: P('M12 4a9 9 0 0 0-9 9h2a7 7 0 1 1 14 0h2a9 9 0 0 0-9-9zM12 13l4-5', false),
  sparkles: P('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'),
  forwardF: P('M3 5.6v12.8c0 .8.9 1.3 1.6.8L12 14v4.4c0 .8.9 1.3 1.6.8l8.4-6.4a1 1 0 0 0 0-1.6l-8.4-6.4c-.7-.5-1.6 0-1.6.8V10L4.6 4.8C3.9 4.3 3 4.8 3 5.6z'),
  headphones: P('M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z', false),
  refresh: P('M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6', false),
  keep: P('M12 5c-6 0-9 7-9 7s3 7 9 7 9-7 9-7-3-7-9-7zm0 10.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z'),
};
// Skip buttons: circular arrow with the interval inside, like SF Symbols' gobackward.15.
export function skipIcon(forward, seconds, size) {
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" style="width:${size}px;height:${size}px" focusable="false" aria-hidden="true">${I[forward ? 'fwd' : 'back']}<text x="12" y="16.2" text-anchor="middle" font-size="${seconds >= 100 ? 7 : 8.5}" font-weight="800" fill="currentColor" font-family="ui-rounded,-apple-system,system-ui,sans-serif">${seconds}</text></svg>`;
}
const cache = new Map();
export function icon(name, size = 16, cls = '') {
  const k = name + size + cls; let v = cache.get(k);
  if (!v) { v = `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" width="${size}" height="${size}" style="width:${size}px;height:${size}px" focusable="false" aria-hidden="true">${I[name] || ''}</svg>`; cache.set(k, v); }
  return v;
}
