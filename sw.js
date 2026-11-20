/**
 * Service Worker：静态资源持久缓存。
 * - /examples/manifest.json 走「网络优先」：清单是索引，部署变更（改名/增删示例）后
 *   绝不能继续用旧清单，否则会请求已不存在的文件，产生 404；离线时回退到缓存。
 * - 其余 examples / vendor 资源「缓存优先 + 24h 后台更新」：只在页面真正用到
 *   （鼠标悬浮预取或点击打开）时才请求并缓存，不做全量主动预取，避免拖慢首屏。
 */
const CACHE = 'yilan-v2';
const PREFIXES = ['/examples/', '/vendor/'];
const MANIFEST = '/examples/manifest.json';
const MAX_AGE = 24 * 60 * 60 * 1000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/** 写入缓存时打上本地时间戳，用于判断是否需要后台更新 */
function stamped(res) {
  const copy = new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: new Headers(res.headers),
  });
  copy.headers.set('x-yilan-cached-at', String(Date.now()));
  return copy;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!PREFIXES.some((p) => url.pathname.startsWith(p))) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // 清单必须拿最新的；拿不到网络时才用旧清单兜底（离线可用）
    if (url.pathname === MANIFEST) {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          await cache.put(req, stamped(copy));
          return res;
        }
      } catch { /* 离线 */ }
      return (await cache.match(req)) || Response.error();
    }

    const cached = await cache.match(req);
    const ts = Number(cached?.headers.get('x-yilan-cached-at') || 0);
    if (cached && Date.now() - ts < MAX_AGE) return cached;

    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        await cache.put(req, stamped(copy));
        return res;
      }
      // 服务器上已下线的示例：删掉缓存，避免旧清单一直命中幽灵文件
      if (res.status === 404) await cache.delete(req);
      return cached || res;
    } catch {
      return cached || Response.error();
    }
  })());
});
