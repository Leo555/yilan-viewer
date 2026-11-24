/**
 * 「我的文件」持久化：把打开过的本机文件写进 IndexedDB，刷新后仍留在「我的文件」里。
 * 只保存用户自己的文件；内置示例按 URL 取，不占浏览器存储。
 * meta / data 分开存：启动时只读元数据（几十条小记录），文件内容点开时才取，不拖慢首屏。
 */
const DB_NAME = 'yilan-files';
const META = 'meta';
const DATA = 'data';

export const MAX_FILE = 50 * 1024 * 1024; // 单个文件上限
export const MAX_TOTAL = 200 * 1024 * 1024; // 总量上限
export const MAX_COUNT = 100; // 最多保存的文件数

let dbPromise = null;
let unavailable = false;

function openDB() {
  if (unavailable) return Promise.reject(new Error('IndexedDB 不可用'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'path' });
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('无法打开 IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB 被其他标签页占用'));
  }).catch((err) => {
    dbPromise = null;
    unavailable = true;
    throw err;
  });
  return dbPromise;
}

function runTx(db, stores, mode, run) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error || new Error('存储事务失败'));
    t.onabort = () => reject(t.error || new Error('存储事务被中断'));
    run(t);
  });
}

function asPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('读取存储失败'));
  });
}

/** 启动恢复用：只取元数据，按保存时间升序 */
export async function listSaved() {
  try {
    const db = await openDB();
    const rows = await asPromise(db.transaction(META, 'readonly').objectStore(META).getAll());
    return (Array.isArray(rows) ? rows : [])
      .filter((m) => m && typeof m.path === 'string' && Number.isFinite(m.size))
      .sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  } catch (err) {
    console.warn('读取浏览器存储失败', err);
    return [];
  }
}

/** 文件内容按需读取：Blob 只在真正打开时从 IndexedDB 取出来 */
export async function getSavedBlob(path) {
  const db = await openDB();
  const blob = await asPromise(db.transaction(DATA, 'readonly').objectStore(DATA).get(path));
  if (!(blob instanceof Blob)) throw new Error('文件内容已不在浏览器存储中');
  return blob;
}

/** 保存（同路径覆盖）。超限淘汰最早保存的文件；太大或存储不可用时静默跳过 */
export async function saveFile(file) {
  if (file.example || file.saved || unavailable) return false;
  let blob;
  try { blob = await file.getBlob(); } catch { return false; }
  if (!(blob instanceof Blob) || blob.size > MAX_FILE) return false;
  try {
    const db = await openDB();
    const metas = await listSaved();
    const others = metas.filter((m) => m.path !== file.path);
    let total = blob.size + others.reduce((s, m) => s + m.size, 0);
    let count = others.length + 1;
    const victims = [];
    for (const m of others) { // others 已按 savedAt 升序，最旧的先淘汰
      if (count <= MAX_COUNT && total <= MAX_TOTAL) break;
      victims.push(m.path);
      total -= m.size;
      count--;
    }
    const meta = {
      path: file.path,
      size: blob.size,
      mtime: file.mtime || Date.now(),
      savedAt: Date.now(),
      lang: file.lang || null,
      pasted: !!file.pasted,
    };
    await runTx(db, [META, DATA], 'readwrite', (t) => {
      const ms = t.objectStore(META);
      const ds = t.objectStore(DATA);
      for (const p of victims) { ms.delete(p); ds.delete(p); }
      ms.put(meta);
      ds.put(blob, file.path);
    });
    file.saved = true;
    return true;
  } catch (err) {
    console.warn('保存到浏览器失败', err);
    return false;
  }
}

export async function deleteSaved(paths) {
  if (!paths.length || unavailable) return;
  try {
    const db = await openDB();
    await runTx(db, [META, DATA], 'readwrite', (t) => {
      const ms = t.objectStore(META);
      const ds = t.objectStore(DATA);
      for (const p of paths) { ms.delete(p); ds.delete(p); }
    });
  } catch (err) { console.warn('删除浏览器存储失败', err); }
}

export async function clearSaved() {
  if (unavailable) return;
  try {
    const db = await openDB();
    await runTx(db, [META, DATA], 'readwrite', (t) => {
      t.objectStore(META).clear();
      t.objectStore(DATA).clear();
    });
  } catch (err) { console.warn('清空浏览器存储失败', err); }
}
