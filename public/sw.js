// Service worker: makes the app open offline after the first visit.
//
//   navigations (HTML)   network-first, cached copy only when offline — so a
//                        new deploy is always picked up immediately
//   /assets/* (hashed)   cache-first — the filename changes when the content does
//   other same-origin    stale-while-revalidate (icons, manifest)
//
// Nothing here ever sees a schema: diagrams live in the URL fragment and
// localStorage, neither of which reaches the network.
const CACHE = 'sqltoerd-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add('/')).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const put = (req, res) => {
  if (res && res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // analytics etc. go straight to the network

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => put(req, res)).catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('/'))
      )
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))));
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => put(req, res)).catch(() => hit);
      return hit || fresh;
    })
  );
});
