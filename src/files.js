/** 文件列表：添加（文件 / 文件夹 / zip / 粘贴 / 示例）、索引、读取与解码 */
import { state, EXAMPLES_ROOT, SKIP_DIRS } from './state.js';
import { baseName } from './languages.js';
import { toast } from './util.js';
import { loadJSZip } from './libs.js';

/* ---------- 索引：按 id / 路径 O(1) 查找，避免大目录下反复线性扫描 ---------- */
let nextId = 1;
const byId = new Map();
const byPath = new Map();
const pathKey = (path, example) => `${example ? 'e' : 'u'}:${path}`;

export const getFile = (id) => byId.get(id) || null;
export const findByPath = (path, example) => byPath.get(pathKey(path, example)) || null;

/** example: 内置示例。示例和用户文件分两组显示，路径相同也互不覆盖 */
export function addFile(path, size, mtime, getBlob, { example = false } = {}) {
  path = path.replace(/^\/+/, '');
  // 用户自己的顶层文件夹恰好叫「示例」时改个名，免得链接被当成内置示例
  if (!example && (path === EXAMPLES_ROOT || path.startsWith(`${EXAMPLES_ROOT}/`))) path = `${EXAMPLES_ROOT} (1)${path.slice(EXAMPLES_ROOT.length)}`;
  const existing = findByPath(path, example);
  if (existing) {
    Object.assign(existing, { size, mtime, getBlob });
    dropBytes(existing.id);
    return existing;
  }
  const f = { id: nextId++, path, size, mtime, getBlob, example };
  state.files.push(f);
  byId.set(f.id, f);
  byPath.set(pathKey(path, example), f);
  return f;
}

/** 按条件移除文件，返回被移除的列表 */
export function removeFiles(pred) {
  const removed = [];
  state.files = state.files.filter((f) => {
    if (!pred(f)) return true;
    removed.push(f);
    byId.delete(f.id);
    byPath.delete(pathKey(f.path, f.example));
    dropBytes(f.id);
    return false;
  });
  return removed;
}

/* ---------- 读取：字节缓存按 LRU 控制总量，避免打开过的大文件一直占着内存 ---------- */
const CACHE_LIMIT = 96 * 1024 * 1024;
const bytesCache = new Map(); // id → Uint8Array（Map 的插入顺序即最近使用顺序）
let cacheSize = 0;

function dropBytes(id) {
  const b = bytesCache.get(id);
  if (!b) return;
  cacheSize -= b.length;
  bytesCache.delete(id);
}

export async function readBytes(file, blob) {
  const hit = bytesCache.get(file.id);
  if (hit) {
    bytesCache.delete(file.id);
    bytesCache.set(file.id, hit);
    return hit;
  }
  const bytes = new Uint8Array(await (blob || await file.getBlob()).arrayBuffer());
  file.size = bytes.length;
  if (bytes.length <= CACHE_LIMIT / 2) {
    bytesCache.set(file.id, bytes);
    cacheSize += bytes.length;
    for (const [id] of bytesCache) {
      if (cacheSize <= CACHE_LIMIT) break;
      dropBytes(id);
    }
  }
  return bytes;
}

export function looksBinary(bytes) {
  const n = Math.min(bytes.length, 8000);
  if (n === 0) return false;
  // BOM 开头的 UTF-16 文本含大量 0 字节，不算二进制
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return false;
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return true;
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) ctrl++;
  }
  return ctrl / n > 0.1;
}

export function decode(bytes, encoding) {
  if (encoding !== 'auto') {
    try { return { text: new TextDecoder(encoding).decode(bytes), encoding }; } catch { /* 浏览器不支持该编码 */ }
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // 不是合法 UTF-8：中文环境下最常见的是 GBK
    return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'gb18030' };
  }
}

/* ---------- 添加 ---------- */
const skipPath = (path) => path.split('/').some((seg) => SKIP_DIRS.has(seg));

/** 把列表里已有的压缩包（示例、zip 里的 tar 等）解开，加到「我的文件」 */
export const isArchive = (path) => /\.(zip|tar|tgz|tar\.gz|gz)$/i.test(path);
export async function extractArchive(file) {
  const blob = await file.getBlob();
  const name = baseName(file.path);
  return /\.zip$/i.test(name) ? addZip(blob, name) : addTar(blob, name);
}

export async function addFromFileList(list) {
  const added = [];
  for (const file of Array.from(list)) {
    const path = file.webkitRelativePath || file.relativePath || file.name;
    if (skipPath(path)) continue;
    if (/\.zip$/i.test(file.name)) {
      added.push(...await addZip(file, path));
      continue;
    }
    if (/\.(tar|tgz|tar\.gz|gz)$/i.test(file.name)) {
      added.push(...await addTar(file, path));
      continue;
    }
    added.push(addFile(path, file.size, file.lastModified, () => file));
  }
  return added;
}

/* ---------- tar / tar.gz / .gz：浏览器自带 DecompressionStream 解 gzip，tar 格式自己解析 ---------- */
const MAX_ARCHIVE = 512 * 1024 * 1024;

async function gunzip(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function tarEntries(buf) {
  const out = [];
  const dec = new TextDecoder();
  const str = (o, n) => dec.decode(buf.subarray(o, o + n)).replace(/\0[\s\S]*$/, '');
  const oct = (o, n) => parseInt(str(o, n).trim() || '0', 8);
  let longName = null;
  let paxPath = null;
  for (let p = 0; p + 512 <= buf.length;) {
    if (buf[p] === 0 && buf[p + 1] === 0) break; // 两个全 0 块表示结束
    const size = oct(p + 124, 12);
    const type = String.fromCharCode(buf[p + 156] || 48);
    const prefix = str(p + 345, 155);
    let name = longName || paxPath || (prefix ? `${prefix}/${str(p, 100)}` : str(p, 100));
    const mtime = oct(p + 136, 12) * 1000;
    const data = p + 512;
    longName = null;
    if (type !== 'x') paxPath = null;
    if (type === 'L') longName = str(data, size); // GNU 长文件名
    else if (type === 'x') { // PAX 扩展头：path=...
      const m = /\d+ path=([^\n]*)\n/.exec(dec.decode(buf.subarray(data, data + size)));
      paxPath = m ? m[1] : null;
    } else if (type === '0' || type === '\0' || type === '7') {
      name = name.replace(/^\.\//, '');
      if (name && !name.endsWith('/')) out.push({ name, data: buf.subarray(data, data + size), mtime });
    }
    p = data + Math.ceil(size / 512) * 512;
  }
  return out;
}

async function addTar(blob, archivePath) {
  try {
    if (blob.size > MAX_ARCHIVE) throw new Error('压缩包太大');
    const gz = /\.(tgz|gz)$/i.test(archivePath);
    let buf = gz ? await gunzip(blob) : new Uint8Array(await blob.arrayBuffer());
    const root = archivePath.replace(/\.(tar\.gz|tgz|tar|gz)$/i, '');
    // 单独的 .gz（不是 tar）：解出一个文件
    const isTar = buf.length >= 512 && new TextDecoder().decode(buf.subarray(257, 262)) === 'ustar';
    if (gz && !isTar && !/\.(tgz|tar\.gz)$/i.test(archivePath)) {
      const data = buf;
      return [addFile(root, data.length, blob.lastModified || Date.now(), () => new Blob([data]))];
    }
    const entries = tarEntries(buf).filter((e) => !skipPath(e.name) && !/(^|\/)\._/.test(e.name));
    buf = null;
    const tops = new Set(entries.map((e) => e.name.split('/')[0]));
    const single = tops.size === 1 && entries.every((e) => e.name.includes('/')) ? [...tops][0] : null;
    const prefix = single && single === baseName(root) ? root.slice(0, root.length - single.length) : `${root}/`;
    const out = entries.map((e) => addFile(`${prefix}${e.name}`, e.data.length, e.mtime || Date.now(), () => new Blob([e.data])));
    if (!out.length) toast(`「${baseName(archivePath)}」里没有可预览的文件`);
    return out;
  } catch (err) {
    console.warn('tar 解析失败', err);
    toast(`无法打开压缩包「${baseName(archivePath)}」：${err.message || err}`);
    return [];
  }
}

async function addZip(blob, zipPath) {
  try {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(blob);
    const root = zipPath.replace(/\.zip$/i, '');
    const entries = [];
    zip.forEach((rel, entry) => {
      if (entry.dir || skipPath(rel) || /(^|\/)__MACOSX\//.test(rel) || /(^|\/)\._/.test(rel)) return;
      entries.push([rel, entry]);
    });
    // 压缩包里只有一个顶层目录且与包名相同时（常见的 proj.zip → proj/），不再多套一层
    const tops = new Set(entries.map(([rel]) => rel.split('/')[0]));
    const single = tops.size === 1 && entries.every(([rel]) => rel.includes('/')) ? [...tops][0] : null;
    const prefix = single && single === baseName(root) ? root.slice(0, root.length - single.length) : `${root}/`;
    const out = entries.map(([rel, entry]) => {
      const size = entry._data?.uncompressedSize ?? 0;
      const date = entry.date ? entry.date.getTime() : Date.now();
      return addFile(`${prefix}${rel}`, size, date, () => entry.async('blob'));
    });
    if (!out.length) toast(`「${baseName(zipPath)}」里没有可预览的文件`);
    return out;
  } catch (err) {
    console.warn('zip 解析失败', err);
    toast(`无法打开压缩包「${baseName(zipPath)}」`);
    return [];
  }
}

/** 拖放：支持文件夹（webkitGetAsEntry），同一目录下的条目并行读取 */
export async function addFromDataTransfer(dt) {
  const entries = Array.from(dt.items || []).map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return addFromFileList(dt.files || []);
  const files = [];
  const readDir = (dir) => new Promise((resolve) => {
    const reader = dir.createReader();
    const all = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) { resolve(all); return; }
      all.push(...batch);
      next();
    }, () => resolve(all));
    next();
  });
  const walk = async (entry, prefix) => {
    if (SKIP_DIRS.has(entry.name)) return;
    if (entry.isFile) {
      const file = await new Promise((r) => entry.file(r, () => r(null)));
      if (file) {
        Object.defineProperty(file, 'relativePath', { value: prefix + file.name });
        files.push(file);
      }
    } else if (entry.isDirectory) {
      const kids = await readDir(entry);
      await Promise.all(kids.map((child) => walk(child, `${prefix}${entry.name}/`)));
    }
  };
  await Promise.all(entries.map((e) => walk(e, '')));
  return addFromFileList(files);
}

let pasteSeq = 0;
export function addText(text, name) {
  // 没给文件名时不带扩展名，交给内容识别
  const given = (name || '').trim();
  const fname = given || `粘贴 ${++pasteSeq}`;
  const blob = new Blob([text], { type: 'text/plain' });
  const f = addFile(`粘贴/${fname}`, blob.size, Date.now(), () => blob);
  f.pasted = !given;
  f.lang = undefined;
  return f;
}

/** 内置示例：按 examples/manifest.json 列出，点开时才拉取内容 */
export async function fetchExamples() {
  try {
    const res = await fetch('./examples/manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { files, order, subOrder } = await res.json();
    if (Array.isArray(order)) state.dirOrder.set(EXAMPLES_ROOT, order.map(String));
    if (subOrder && typeof subOrder === 'object') {
      for (const [dir, names] of Object.entries(subOrder)) {
        if (Array.isArray(names)) state.dirOrder.set(`${EXAMPLES_ROOT}/${dir}`, names.map(String));
      }
    }
    const now = Date.now();
    // 只接受普通相对路径：每段由字母、数字（含中文）、常见中文标点、. _ - 空格组成，且不能是 . 或 ..
    const safe = (p) => typeof p === 'string' && p.split('/').every((s) => /^[\p{L}\p{N}._ \-、，（）·]+$/u.test(s) && s !== '.' && s !== '..');
    return files
      .filter((f) => safe(f.path))
      .map((f) => {
        const url = `./examples/${f.path.split('/').map(encodeURIComponent).join('/')}`;
        let pending = null; // 同一文件的并发请求（预取 + 点击）只发一次
        return addFile(`${EXAMPLES_ROOT}/${f.path}`, Number(f.size) || 0, now, () => {
          pending ||= fetch(url).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.blob();
          }).catch((err) => { pending = null; throw err; });
          return pending;
        }, { example: true });
      });
  } catch (err) {
    console.warn('示例加载失败', err);
    toast('示例加载失败');
    return [];
  }
}

/** 预取示例文件（只对较小的文件），结果缓存在 getBlob 内 */
export function prefetch(f) {
  if (!f.example || bytesCache.has(f.id) || f.size > 2 * 1024 * 1024) return;
  f.getBlob().catch(() => {});
}

/** 空闲时后台预取全部较小的示例文件，让「首次点开」也接近秒开 */
export function prefetchIdle(files) {
  const conn = navigator.connection;
  if (conn && (conn.saveData || /(^|\b)2g\b/i.test(conn.effectiveType || ''))) return;
  const list = files.filter((f) => f.example && !bytesCache.has(f.id) && f.size <= 2 * 1024 * 1024);
  if (!list.length) return;

  const BUDGET = 16 * 1024 * 1024; // 后台预取总量上限
  let i = 0;
  let used = 0;
  const step = () => {
    // 每次空闲切片只发起 2 个请求，避免抢占用户当前操作的网络
    let n = 0;
    while (i < list.length && n < 2) {
      const f = list[i++];
      if (bytesCache.has(f.id) || used + f.size > BUDGET) continue;
      used += f.size;
      n++;
      f.getBlob().catch(() => {});
    }
    if (i < list.length) schedule();
  };
  const schedule = () => {
    ('requestIdleCallback' in window ? requestIdleCallback(step, { timeout: 3000 }) : setTimeout(step, 800));
  };
  schedule();
}

/** 一次添加多个文件时优先打开 README / index 等 */
export function pickFirst(files) {
  let best = null;
  let bestScore = Infinity;
  for (const f of files) {
    const n = baseName(f.path).toLowerCase();
    const s = /^readme(\.|$)/.test(n) ? 0 : /^(index|main|app)\./.test(n) ? 1 : 2 + f.path.split('/').length;
    if (s < bestScore || (s === bestScore && f.path.localeCompare(best.path, undefined, { numeric: true }) < 0)) {
      best = f;
      bestScore = s;
    }
  }
  return best;
}
