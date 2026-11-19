// Node.js 内置模块实现的一个小型限流中间件 + 服务
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

/** 令牌桶：每秒补充 rate 个，容量 burst */
function rateLimiter({ rate = 5, burst = 10 } = {}) {
  const buckets = new Map();
  return (ip) => {
    const now = Date.now();
    const b = buckets.get(ip) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
    b.at = now;
    buckets.set(ip, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

const allow = rateLimiter();

const server = createServer(async (req, res) => {
  const ip = req.socket.remoteAddress ?? 'unknown';
  if (!allow(ip)) {
    res.writeHead(429, { 'Retry-After': '1' }).end('Too Many Requests');
    return;
  }
  if (req.url === '/slow') await sleep(500);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, path: req.url, time: new Date().toISOString() }));
});

server.listen(3000, () => console.log('http://localhost:3000'));
process.on('SIGINT', () => server.close(() => process.exit(0)));
