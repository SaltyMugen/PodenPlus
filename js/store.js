// Storage: small state in localStorage (instant, synchronous), bulky data in IndexedDB,
// downloaded audio in Cache Storage (streamable with range requests via the service worker).
const DB_NAME = 'poden', DB_VER = 1, STORES = ['kv', 'analysis', 'transcripts', 'chapters', 'fingerprints'];
let dbp;
function db() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store), out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  });
}
export const idb = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  set: (store, key, val) => tx(store, 'readwrite', s => { s.put(val, key); }),
  del: (store, key) => tx(store, 'readwrite', s => { s.delete(key); }),
  keys: (store) => tx(store, 'readonly', s => s.getAllKeys()),
  all: async (store) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store), s = t.objectStore(store), out = new Map(); const c = s.openCursor(); c.onsuccess = () => { const x = c.result; if (x) { out.set(x.key, x.value); x.continue(); } else res(out); }; c.onerror = () => rej(c.error); }); },
  clear: (store) => tx(store, 'readwrite', s => { s.clear(); }),
};

// Debounced JSON in localStorage: many writes per second collapse into one.
const pending = new Map(); let timer = 0;
export const ls = {
  get(k, d) { try { const v = localStorage.getItem('p.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { pending.set(k, v); if (!timer) timer = setTimeout(ls.flush, 400); },
  now(k, v) { pending.delete(k); try { localStorage.setItem('p.' + k, JSON.stringify(v)); } catch (_) {} },
  flush() { clearTimeout(timer); timer = 0; for (const [k, v] of pending) { try { localStorage.setItem('p.' + k, JSON.stringify(v)); } catch (_) {} } pending.clear(); },
};
addEventListener('pagehide', ls.flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) ls.flush(); });

// SHA-256 hex (ids → file keys, same as the Mac app's hashKey).
export async function hashKey(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
}

export const AUDIO_CACHE = 'poden-audio';
export const audioKey = id => new URL('./__audio/' + encodeURIComponent(id), location.href).href;
