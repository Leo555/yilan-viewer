/**
 * Service Worker：examples / vendor 走「缓存优先 + 后台更新」（stale-while-revalidate）。
 * 静态示例资源几乎不变，命中后秒开；后台异步刷新到最新。
 */
const CACHE = 'yilan-v1';
const PREFIXES = ['/examples/', '/vendor/'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!PREFIXES.some((p) => url.pathname.startsWith(p))) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: false });

    // 后台刷新：失败或离线时静默忽略
    const refresh = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (cached) {
      refresh.catch(() => {});
      return cached;
    }
    const res = await refresh;
    if (res) return res;
    const fallback = await cache.match(req);
    return fallback || new Response('offline', { status: 504 });
  })());
});
