const V = 'v1';
const PAGES = 'zsb.pages.' + V;
const ASSETS = 'zsb.assets.' + V;
const OFFLINE = '/offline.html';
const LIMIT = 200;
const ASSET = /\.(?:css|js|mjs|svg|png|jpe?g|webp|gif|ico|woff2?|ttf)(?:\?|$)/i;
const KEEP = new Set([PAGES, ASSETS]);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('zsb.') && !KEEP.has(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - LIMIT; i++) await cache.delete(keys[i]);
}

async function networkFirst(event, cache, url, request) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(request, { signal: ctrl.signal });
    if (res.ok && res.type === 'basic') {
      event.waitUntil(cache.put(url, res.clone()).then(() => trim(cache)));
    }
    return res;
  } catch {
    return (await cache.match(url)) || null;
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(event, cache, url, request) {
  return (await cache.match(url)) || networkFirst(event, cache, url, request);
}

async function handle(event, request, nav) {
  const asset = ASSET.test(new URL(request.url).pathname);
  const cache = await caches.open(asset ? ASSETS : PAGES);
  const res = asset
    ? await cacheFirst(event, cache, request.url, request)
    : await networkFirst(event, cache, request.url, request);
  if (res) return res;
  if (nav) {
    const fallback = await caches.open(PAGES).then((c) => c.match(OFFLINE));
    if (fallback) return fallback;
  }
  return Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(handle(e, req, req.mode === 'navigate'));
});
