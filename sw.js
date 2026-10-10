// Offline support: stale-while-revalidate for the app shell and for the library files
// fetched from CDNs (OCR engine, PDF reader, word list, fonts).
const CACHE = 'skeleton-v2';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest',
  'js/main.js', 'js/model.js', 'js/solver.js', 'js/solverWorker.js', 'js/solverClient.js',
  'js/clueParser.js', 'js/storage.js', 'js/gridDetect.js', 'js/imageImport.js', 'js/ocr.js',
  'js/importFlow.js', 'js/play.js', 'js/ui/dom.js', 'js/ui/grid.js', 'js/ui/clues.js',
  'js/ui/keyboard.js', 'js/ui/wordFinder.js', 'samples/sample-skeleton.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const CDN = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'tessdata.projectnaptha.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
  if (url.origin !== location.origin && !CDN.includes(url.hostname)) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: url.origin === location.origin });
      const net = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
