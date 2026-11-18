/**
 * 本地开发用的静态文件服务器（零依赖，Node >= 18）。
 * 用法：npm run dev          默认 http://localhost:4173
 *       PORT=8080 npm run dev
 */
import { createServer } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.epub': 'application/epub+zip',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.icc': 'application/vnd.iccprofile',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// 与线上（vercel.json / .vercelignore）保持一致：这些目录不对外提供
const BLOCKED = ['node_modules', 'scripts', '.testdata', '.git'];

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
// 本地也使用线上同一份 CSP，避免「本地正常、上线后被拦截」
try {
  const conf = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const csp = conf.headers?.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy');
  if (csp) SECURITY_HEADERS['Content-Security-Policy'] = csp.value;
} catch { /* 没有 vercel.json 时不加 CSP */ }

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
  res.end(body);
}

async function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const target = resolve(join(ROOT, decoded));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null; // 防止 ../ 越界

  const rel = target.slice(ROOT.length + 1).split(sep);
  if (rel[0] && (BLOCKED.includes(rel[0]) || rel.some((p) => p.startsWith('.')))) return null;

  try {
    const s = await stat(target);
    if (s.isDirectory()) {
      const index = join(target, 'index.html');
      const si = await stat(index);
      return si.isFile() ? { path: index, size: si.size, mtime: si.mtime } : null;
    }
    return s.isFile() ? { path: target, size: s.size, mtime: s.mtime } : null;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const start = Date.now();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    send(res, 405, 'Method Not Allowed');
    return;
  }

  const { pathname } = new URL(req.url, 'http://localhost');
  const file = await resolveFile(pathname);
  if (!file) {
    send(res, 404, 'Not Found');
    console.log(`404 ${req.method} ${pathname}`);
    return;
  }

  const etag = `W/"${file.size.toString(16)}-${file.mtime.getTime().toString(16)}"`;
  const headers = {
    'Content-Type': MIME[extname(file.path).toLowerCase()] || 'application/octet-stream',
    'Content-Length': file.size,
    'Last-Modified': file.mtime.toUTCString(),
    ETag: etag,
    'Cache-Control': 'no-cache', // 开发时总是拿最新文件（未修改则 304）
    ...SECURITY_HEADERS,
  };

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file.path)
    .on('error', () => res.destroy())
    .on('end', () => console.log(`200 ${pathname} ${Date.now() - start}ms`))
    .pipe(res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，可以用 PORT=xxxx npm run dev 换一个端口`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '127.0.0.1' || HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`一览已启动：http://${shown}:${PORT}/`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
