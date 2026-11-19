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

export async function addFromFileList(list) {
  const added = [];
  for (const file of Array.from(list)) {
    const path = file.webkitRelativePath || file.relativePath || file.name;
    if (skipPath(path)) continue;
    if (/\.zip$/i.test(file.name)) {
      added.push(...await addZip(file, path));
      continue;
    }
    added.push(addFile(path, file.size, file.lastModified, () => file));
  }
  return added;
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
    const { files, order } = await res.json();
    if (Array.isArray(order)) state.dirOrder.set(EXAMPLES_ROOT, order.map(String));
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
