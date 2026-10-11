// Offline support: the app files are stored when this worker installs, then served from the
// store and refreshed in the background. The CACHE name is written by tools/stamp.mjs.
const CACHE = 'skeleton-v14';
const CDN = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'tessdata.projectnaptha.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      // The file list comes from version.json (written by tools/stamp.mjs), fetched fresh.
      const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('version.json ' + res.status);
      const meta = await res.json();
      // Refuse to install a worker whose file list belongs to a different release: stale answers
      // from the host's cache would otherwise leave old files stored under the new name.
      if (CACHE !== 'skeleton-v' + meta.version) throw new Error('release mismatch');
      const cache = await caches.open(CACHE);
      await Promise.all(
        ['./', ...meta.files].map(async (f) => {
          // 'reload' skips the browser's own cache (GitHub Pages lets it keep files for ten minutes),
          // so what we store is what is really published
          const r = await fetch(f, { cache: 'reload' });
          if (!r.ok) throw new Error('could not fetch ' + f);
          await cache.put(f, r);
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !CDN.includes(url.hostname)) return;
  // always ask the network which version is published (the home screen compares it with its own)
  if (sameOrigin && url.pathname.endsWith('/version.json')) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: sameOrigin });
      // refresh in the background; for our own files go past the browser's cache so it is really fresh
      const net = fetch(sameOrigin ? req.url : req, sameOrigin ? { cache: 'no-cache' } : undefined)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
