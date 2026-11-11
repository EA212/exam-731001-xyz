const V = 'v1';
const PAGES = 'zsb.pages.' + V;
const ASSETS = 'zsb.assets.' + V;
const ASSET = /\.(?:css|js|mjs|svg|png|jpe?g|webp|gif|ico|woff2?|ttf)(?:\?|$)/i;

async function syncCurrent(): Promise<void> {
  const origin = location.origin;
  const urls = [location.href, ...performance.getEntriesByType('resource')
    .map((r) => r.name)
    .filter((u) => u.startsWith(origin) && ASSET.test(u))];
  const [pages, assets] = await Promise.all([caches.open(PAGES), caches.open(ASSETS)]);
  await Promise.all(urls.map((u) => (ASSET.test(u) ? assets : pages)
    .add(new Request(u, { cache: 'force-cache' }))
    .catch(() => {})));
}

export function registerOffline(): void {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  if (!sw.controller) {
    sw.addEventListener('controllerchange', () => { void syncCurrent(); }, { once: true });
  }
  window.addEventListener('load', () => {
    void sw.register('/sw.js').catch(() => {});
  }, { once: true });
}
