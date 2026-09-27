// Poden+ service worker: instant start (app shell from cache, updated in the background),
// offline playback of downloads with proper range requests (needed for seeking), images cached.
const V = 'poden-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'js/app.js', 'js/model.js', 'js/player.js', 'js/views.js', 'js/analyzer.js', 'js/ui.js', 'js/transcript.js',
  'js/store.js', 'js/icons.js', 'js/textlib.js', 'js/detect-core.js', 'js/detect-model.js', 'js/worker.js', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
const AUDIO = 'poden-audio', IMG = 'poden-img';

self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== V && k !== AUDIO && k !== IMG) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin && url.pathname.includes('/__audio/')) { e.respondWith(audio(req)); return; }
  if (url.origin === location.origin) { e.respondWith(shell(req, e)); return; }
  if (req.destination === 'image') { e.respondWith(image(req)); return; }
});

// Stale-while-revalidate for the app shell: opens instantly, picks up new versions next launch.
async function shell(req, e) {
  const c = await caches.open(V);
  const key = req.mode === 'navigate' ? 'index.html' : req;
  const hit = await c.match(key, { ignoreSearch: true });
  const net = fetch(req).then(r => { if (r.ok && r.type === 'basic') c.put(key, r.clone()); return r; }).catch(() => null);
  if (hit) { e.waitUntil(net); return hit; }
  return (await net) || new Response('Offline', { status: 503 });
}

async function image(req) {
  const c = await caches.open(IMG), hit = await c.match(req);
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (r.ok || r.type === 'opaque') {
      c.put(req, r.clone());
      trim(c, 400);
    }
    return r;
  } catch (_) { return new Response('', { status: 504 }); }
}
async function trim(c, max) { const k = await c.keys(); for (let i = 0; i < k.length - max; i++) await c.delete(k[i]); }

// Downloaded audio with byte ranges, so <audio> can seek instantly in a 3-hour file.
async function audio(req) {
  const c = await caches.open(AUDIO), hit = await c.match(req.url);
  if (!hit) return new Response('', { status: 404 });
  const range = req.headers.get('range');
  const blob = await hit.blob(), size = blob.size, type = hit.headers.get('content-type') || 'audio/mpeg';
  if (!range) return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : size - 1;
  if (!m || !m[1] && m[2]) { start = Math.max(0, size - (+m[2])); end = size - 1; }
  end = Math.min(end, size - 1);
  if (start >= size) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), { status: 206, headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' } });
}
