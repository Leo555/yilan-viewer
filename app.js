/**
 * 一览 — 在线预览代码、文档与各类文件。纯前端，文件只在本机浏览器中处理。
 */
import { LANGS, AUTO_LANGS, langById, detectLang, viewKind, extOf, baseName, IMAGE_EXT, DOC_KINDS } from './languages.js';

const APP_NAME = '一览';
let docMod = null;
const loadDocViewers = () => (docMod ||= import('./docviewers.js').catch((e) => { docMod = null; throw e; }));

/* ============================== 常量 ============================== */
const MAX_HIGHLIGHT = 1.5 * 1024 * 1024; // 超过这个大小的文本不做语法高亮，避免卡顿
const WORKER_THRESHOLD = 60 * 1024; // 超过这个大小在后台线程高亮
const MAX_TEXT = 30 * 1024 * 1024; // 超过这个大小不读取内容
const MAX_RENDER_LINES = 200000;
const MAX_CSV_ROWS = 5000;
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'dist', 'build', '.next', '.nuxt', 'target', '.gradle', 'Pods', '.DS_Store']);
const SIZES = [11, 12, 13, 14, 15, 16, 18, 20];
const PREVIEW_KINDS = ['markdown', 'csv', 'tsv', 'html', 'svg', 'json'];
const BADGE = {
  javascript: ['JS', '#f1e05a', '#000'], typescript: ['TS', '#3178c6'], json: ['{}', '#cb8a00'], xml: ['<>', '#e34c26'],
  css: ['#', '#563d7c'], scss: ['S', '#c6538c'], less: ['L', '#1d365d'], markdown: ['MD', '#083fa1'], yaml: ['Y', '#cb171e'],
  python: ['PY', '#3572a5'], java: ['J', '#b07219'], kotlin: ['KT', '#a97bff'], go: ['GO', '#00add8'], rust: ['RS', '#dea584', '#000'],
  c: ['C', '#555'], cpp: ['C+', '#f34b7d'], csharp: ['C#', '#178600'], swift: ['SW', '#f05138'], php: ['PHP', '#4f5d95'],
  ruby: ['RB', '#701516'], bash: ['$', '#3d4a52'], shell: ['$', '#3d4a52'], sql: ['DB', '#e38c00'], dockerfile: ['🐳', 'transparent'],
  plaintext: ['TXT', '#8c959f'], log: ['LOG', '#8c959f'], ini: ['⚙', '#6e7781'], diff: ['±', '#6e7781'],
};
const DOC_BADGE = {
  pdf: ['PDF', '#d93025'], epub: ['EPB', '#7cb342'], docx: ['DOC', '#2b579a'], sheet: ['XLS', '#217346'],
  pptx: ['PPT', '#d24726'], audio: ['♪', '#e8590c'], video: ['▶', '#ae3ec9'], font: ['Ff', '#495057'],
};
const MAX_DOC = 200 * 1024 * 1024; // 文档类文件的大小上限

/* ============================== 状态 ============================== */
const state = {
  files: [], // { id, path, size, mtime, getBlob, text?, buffer? }
  activeId: null,
  current: null, // { file, text, lang, kind, mode, encoding, highlighted }
  settings: loadSettings(),
  openDirs: new Set(),
  dirOrder: new Map(), // 目录路径 → 子目录的显示顺序
  closedGroups: new Set(), // 侧边栏中收起的分组（mine / example）
  selLines: null, // [起始行, 结束行]
  find: { query: '', caseSensitive: false, regex: false, marks: [], index: -1 },
  langLoads: new Map(),
};
let nextId = 1;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function loadSettings() {
  const def = { theme: 'auto', size: 13, wrap: false, sideW: 260, sideHidden: false };
  try {
    const s = { ...def, ...JSON.parse(localStorage.getItem('cv.settings') || '{}') };
    if (!['auto', 'light', 'dark'].includes(s.theme)) s.theme = 'auto';
    if (!SIZES.includes(s.size)) s.size = 13;
    s.sideW = clamp(Number(s.sideW) || 260, 180, 600);
    return s;
  } catch {
    return def;
  }
}
function saveSettings() {
  try { localStorage.setItem('cv.settings', JSON.stringify(state.settings)); } catch { /* 隐私模式 */ }
}

let toastTimer = null;
function toast(msg, ms = 1800) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================== 主题 ============================== */
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function effectiveTheme() {
  return state.settings.theme === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : state.settings.theme;
}
function applyTheme() {
  const t = effectiveTheme();
  const root = document.documentElement;
  if (state.settings.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state.settings.theme);
  // 自动模式下 CSS 变量也要跟随系统
  if (state.settings.theme === 'auto' && t === 'dark') root.setAttribute('data-theme-auto', 'dark');
  else root.removeAttribute('data-theme-auto');
  $('#hl-light').disabled = t === 'dark';
  $('#hl-dark').disabled = t !== 'dark';
  $('#btn-theme').title = { auto: '主题：跟随系统', light: '主题：浅色', dark: '主题：深色' }[state.settings.theme];
  if (state.current?.kind === 'html' && state.current.mode === 'preview') renderCurrent();
  state.docCtl?.theme?.(t === 'dark');
}
function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  state.settings.theme = order[(order.indexOf(state.settings.theme) + 1) % order.length];
  saveSettings();
  applyTheme();
  toast($('#btn-theme').title);
}

function applyFontSize() {
  document.documentElement.style.setProperty('--code-size', `${state.settings.size}px`);
}
function changeFontSize(dir) {
  // PDF / EPUB 有自己的缩放；其余（代码、Markdown、Word、表格、幻灯片）共用字号设置
  if (state.current?.doc && state.docCtl?.zoom) { state.docCtl.zoom(dir); return; }
  const i = SIZES.indexOf(state.settings.size);
  state.settings.size = SIZES[clamp(i + dir, 0, SIZES.length - 1)];
  saveSettings();
  applyFontSize();
  const cur = state.current;
  const reading = cur && ((cur.mode === 'preview' && cur.kind === 'markdown') || ['docx', 'pptx'].includes(cur.kind));
  toast(reading ? `字号 ${state.settings.size + (cur.kind === 'pptx' ? 1 : 3)}px` : `字号 ${state.settings.size}px`, 900);
}

/* ============================== 读取文件 ============================== */
function looksBinary(bytes) {
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

function decode(bytes, encoding) {
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

/* ============================== 添加文件 ============================== */
/** example: 内置示例。示例和用户文件分两组显示，路径相同也互不覆盖 */
function addFile(path, size, mtime, getBlob, { example = false } = {}) {
  path = path.replace(/^\/+/, '');
  // 用户自己的顶层文件夹恰好叫「示例」时改个名，免得链接被当成内置示例
  if (!example && (path === EXAMPLES_ROOT || path.startsWith(`${EXAMPLES_ROOT}/`))) path = `${EXAMPLES_ROOT} (1)${path.slice(EXAMPLES_ROOT.length)}`;
  const existing = state.files.find((f) => f.path === path && !!f.example === example);
  if (existing) {
    Object.assign(existing, { size, mtime, getBlob, bytes: undefined });
    return existing;
  }
  const f = { id: nextId++, path, size, mtime, getBlob, example };
  state.files.push(f);
  return f;
}

function skipPath(path) {
  return path.split('/').some((seg) => SKIP_DIRS.has(seg));
}

async function addFromFileList(list) {
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

/** 拖放：支持文件夹（webkitGetAsEntry） */
async function addFromDataTransfer(dt) {
  const items = Array.from(dt.items || []);
  const entries = items.map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
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
      for (const child of await readDir(entry)) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  for (const e of entries) await walk(e, '');
  return addFromFileList(files);
}

let pasteSeq = 0;
function addText(text, name) {
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
const EXAMPLES_ROOT = '示例';
let examplesLoading = null;
async function loadExamples({ open = true } = {}) {
  if (!examplesLoading) {
    examplesLoading = fetchExamples().finally(() => { examplesLoading = null; });
    renderTree(); // 显示「正在加载示例…」
  }
  const added = await examplesLoading;
  if (open) state.closedGroups.delete('example');
  // 示例目录默认折叠，只展开打开的 README 所在的那一层
  if (open && added.length) await afterAdd(added, { expand: false, quiet: true });
  else renderTree();
}

async function fetchExamples() {
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
      .map((f) => addFile(`${EXAMPLES_ROOT}/${f.path}`, Number(f.size) || 0, now, async () => {
        const r = await fetch(`./examples/${f.path.split('/').map(encodeURIComponent).join('/')}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      }, { example: true }));
  } catch (err) {
    console.warn('示例加载失败', err);
    toast('示例加载失败');
    return [];
  }
}

async function afterAdd(added, { expand = true, quiet = false } = {}) {
  if (!added.length) return;
  for (const f of expand ? added : []) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      // 默认只展开前两层，避免大目录一打开就铺满
      if (i <= 2 || added.length <= 30) state.openDirs.add(parts.slice(0, i).join('/'));
    }
  }
  renderTree();
  // 一次添加多个文件时优先打开 README / index 等；只添加一个就打开它
  const first = added.length === 1 ? added[0] : pickFirst(added);
  if (first) await openFile(first.id);
  if (added.length > 1 && !quiet) toast(`已添加 ${added.length} 个文件`);
}

function pickFirst(files) {
  const score = (f) => {
    const n = baseName(f.path).toLowerCase();
    if (/^readme(\.|$)/.test(n)) return 0;
    if (/^(index|main|app)\./.test(n)) return 1;
    return 2 + f.path.split('/').length;
  };
  const byName = (a, b) => a.path.localeCompare(b.path, undefined, { numeric: true });
  return [...files].sort((a, b) => score(a) - score(b) || byName(a, b))[0];
}

/* ============================== 文件树 ============================== */
function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { dirs: new Map(), files: [], path: parts.slice(0, i + 1).join('/') });
      node = node.dirs.get(parts[i]);
    }
    node.files.push(f);
  }
  return root;
}

function badgeFor(path, langOverride) {
  const ext = extOf(path);
  if (IMAGE_EXT.has(ext) || ext === 'svg') return ['IMG', '#8250df'];
  const kind = viewKind(path);
  if (DOC_BADGE[kind]) return DOC_BADGE[kind];
  const lang = langOverride || detectLang(path) || 'plaintext';
  return BADGE[lang] || [lang.slice(0, 2).toUpperCase(), '#6e7781'];
}

function refreshTreeBadge(file) {
  const badge = document.querySelector(`.tree-row.file[data-id="${file.id}"] .badge`);
  if (!badge) return;
  const [txt, bg, fg] = badgeFor(file.path, file.lang);
  badge.textContent = txt;
  badge.classList.toggle('long', txt.length > 2);
  badge.style.background = bg;
  badge.style.color = fg || '';
}

/** 侧边栏分组：用户自己打开的文件在上，内置示例在下 */
const GROUPS = [
  { id: 'mine', title: '我的文件', match: (f) => !f.example },
  { id: 'example', title: '示例', match: (f) => !!f.example },
];

function groupHeader(g, count, open, onToggle) {
  const head = document.createElement('div');
  head.className = `tree-group${open ? ' open' : ''}`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tree-group-toggle';
  btn.innerHTML = '<svg class="chev" viewBox="0 0 12 12" width="12" height="12"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="tree-group-title"></span><span class="tree-group-count"></span>';
  btn.querySelector('.tree-group-title').textContent = g.title;
  btn.querySelector('.tree-group-count').textContent = String(count);
  btn.setAttribute('aria-expanded', String(open));
  btn.addEventListener('click', onToggle);
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'x';
  x.title = g.id === 'example' ? '移除全部示例' : '移除我的全部文件';
  x.textContent = '×';
  x.addEventListener('click', () => removeGroup(g.id));
  head.append(btn, x);
  return head;
}

function renderTree() {
  const tree = $('#tree');
  const q = $('#filter').value.trim().toLowerCase();
  const files = q ? state.files.filter((f) => f.path.toLowerCase().includes(q)) : state.files;
  // 两个分组始终显示，空状态在分组内提示；只有筛选无结果时才用底部提示
  $('#side-empty').hidden = !(q && state.files.length && !files.length);
  $('#side-empty').textContent = '没有匹配的文件';
  const frag = document.createDocumentFragment();
  const walk = (node, depth, parent) => {
    // 有指定顺序的目录（如示例的四个分类）按指定顺序，其余按名称
    const order = state.dirOrder.get(node.path ?? '') || [];
    const rank = (d) => { const i = order.indexOf(baseName(d.path)); return i < 0 ? order.length : i; };
    const dirs = [...node.dirs.values()].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
    for (const d of dirs) {
      // 只有一个子目录且没有文件时合并显示（a/b/c）
      let cur = d;
      let label = baseName(d.path);
      while (cur.files.length === 0 && cur.dirs.size === 1) {
        cur = [...cur.dirs.values()][0];
        label += '/' + baseName(cur.path);
      }
      const open = q ? true : state.openDirs.has(cur.path);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `tree-row dir${open ? ' open' : ''}`;
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.innerHTML = `<svg class="chev" viewBox="0 0 12 12" width="12" height="12"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="ico">📁</span><span class="label"></span>`;
      row.querySelector('.label').textContent = label;
      row.title = cur.path;
      const kids = document.createElement('div');
      kids.className = `tree-children${open ? ' open' : ''}`;
      row.addEventListener('click', () => {
        const nowOpen = !kids.classList.contains('open');
        kids.classList.toggle('open', nowOpen);
        row.classList.toggle('open', nowOpen);
        if (nowOpen) state.openDirs.add(cur.path); else state.openDirs.delete(cur.path);
      });
      parent.append(row, kids);
      walk(cur, depth + 1, kids);
    }
    const fs = [...node.files].sort((a, b) => baseName(a.path).localeCompare(baseName(b.path), undefined, { numeric: true }));
    for (const f of fs) {
      const row = document.createElement('div');
      row.className = `tree-row file${f.id === state.activeId ? ' active' : ''}`;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.dataset.id = String(f.id);
      row.style.paddingLeft = `${26 + depth * 14}px`;
      row.title = `${f.path}（${formatSize(f.size)}）`;
      const [txt, bg, fg] = badgeFor(f.path, f.lang);
      const ico = document.createElement('span');
      ico.className = 'ico';
      const badge = document.createElement('span');
      badge.className = txt.length > 2 ? 'badge long' : 'badge';
      badge.textContent = txt;
      badge.style.background = bg;
      if (fg) badge.style.color = fg;
      ico.appendChild(badge);
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = baseName(f.path);
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'x';
      x.title = '从列表中移除';
      x.textContent = '×';
      x.addEventListener('click', (e) => { e.stopPropagation(); removeFile(f.id); });
      row.append(ico, label, x);
      row.addEventListener('click', () => openFile(f.id));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openFile(f.id); });
      parent.appendChild(row);
    }
  };
  for (const g of GROUPS) {
    const list = files.filter(g.match);
    if (q && !list.length) continue; // 筛选时隐藏没有匹配的分组
    const open = q ? true : !state.closedGroups.has(g.id);
    const body = document.createElement('div');
    body.className = `tree-children${open ? ' open' : ''}`;
    const head = groupHeader(g, list.length, open, () => {
      const nowOpen = !body.classList.contains('open');
      body.classList.toggle('open', nowOpen);
      head.classList.toggle('open', nowOpen);
      head.firstElementChild.setAttribute('aria-expanded', String(nowOpen));
      if (nowOpen) state.closedGroups.delete(g.id); else state.closedGroups.add(g.id);
      // 第一次展开示例时才去拉清单（启动时已在后台预加载，一般已经就绪）
      if (nowOpen && g.id === 'example' && !list.length) loadExamples({ open: false });
    });
    frag.append(head, body);
    if (!list.length) {
      body.appendChild(groupEmpty(g.id));
      continue;
    }
    const root = buildTree(list);
    // 示例都在「示例/」下，分组标题已经说明了，直接展示它的子目录
    const exRoot = g.id === 'example' ? root.dirs.get(EXAMPLES_ROOT) : null;
    if (exRoot && root.dirs.size === 1 && !root.files.length) walk(exRoot, 0, body);
    else walk(root, 0, body);
  }
  tree.replaceChildren(frag);
}

/** 分组为空时的提示 */
function groupEmpty(id) {
  const box = document.createElement('div');
  box.className = 'tree-empty';
  const link = (text, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-btn';
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  };
  if (id === 'mine') {
    box.append('拖入文件，或 ', link('打开文件', () => $('#file-input').click()), ' / ', link('粘贴', () => openPaste()));
  } else if (examplesLoading) {
    box.textContent = '正在加载示例…';
  } else {
    box.append(link('加载示例', () => loadExamples({ open: false })));
  }
  return box;
}

function removeGroup(id) {
  const g = GROUPS.find((x) => x.id === id);
  const removed = state.files.filter(g.match);
  if (!removed.length) return;
  const activeRemoved = removed.some((f) => f.id === state.activeId);
  state.files = state.files.filter((f) => !g.match(f));
  if (activeRemoved) {
    openToken++; // 取消正在进行的打开
    const next = state.files.find((f) => !f.example);
    if (next) openFile(next.id); else showWelcome();
  }
  renderTree();
  toast(`已移除 ${removed.length} 个${id === 'example' ? '示例' : '文件'}`);
}

function removeFile(id) {
  const i = state.files.findIndex((f) => f.id === id);
  if (i < 0) return;
  state.files.splice(i, 1);
  if (state.activeId === id) {
    const next = state.files[i] || state.files[i - 1];
    if (next) openFile(next.id); else showWelcome();
  }
  renderTree();
}

function clearAll() {
  // 清空「我的文件」；示例只是一份清单，不占内存，保留在侧边栏
  if (!state.files.some((f) => !f.example)) return;
  removeGroup('mine');
}

/** 启动时在后台列出示例（只取清单，不下载文件内容），示例分组默认收起 */
function preloadExamples() {
  if (state.files.some((f) => f.example)) return;
  state.closedGroups.add('example');
  loadExamples({ open: false });
}

/* ============================== 打开文件 ============================== */
let openToken = 0;
async function openFile(id, opts = {}) {
  const file = state.files.find((f) => f.id === id);
  if (!file) return;
  const token = ++openToken;
  state.activeId = id;
  state.selLines = null;
  $$('.tree-row.file').forEach((r) => r.classList.toggle('active', Number(r.dataset.id) === id));
  revealInTree(file);
  closeFind();

  const kind = viewKind(file.path);
  const cur = { file, kind, text: null, lang: null, encoding: opts.encoding || 'auto', mode: 'code', binary: false, tooBig: false, at: opts.at || null };

  if (kind === 'image') {
    cur.mode = 'preview';
  } else if (DOC_KINDS.has(kind)) {
    cur.mode = 'preview';
    cur.doc = true;
    if (file.size > MAX_DOC) cur.tooBig = true;
  } else if (file.size > MAX_TEXT) {
    cur.tooBig = true;
  } else {
    let bytes = file.bytes;
    if (!bytes) {
      const blob = await file.getBlob();
      bytes = new Uint8Array(await blob.arrayBuffer());
      if (token !== openToken) return;
      file.bytes = bytes;
      file.size = bytes.length;
    }
    if (looksBinary(bytes) && !opts.forceText) {
      cur.binary = true;
    } else {
      const d = decode(bytes, cur.encoding);
      cur.text = d.text;
      cur.detectedEncoding = d.encoding;
      cur.lang = opts.lang || file.lang || detectLang(file.path);
      if (!cur.lang) cur.lang = autoDetect(cur.text);
      file.lang = cur.lang; // 记住识别结果，树上的图标也随之更新
      if (file.pasted) refreshTreeBadge(file);
      cur.mode = PREVIEW_KINDS.includes(kind) ? 'preview' : 'code';
      // 超大 JSON 生成树会很慢，直接看源码
      if (kind === 'json' && cur.text.length > 2 * 1024 * 1024) cur.mode = 'code';
    }
  }
  cur.defaultMode = cur.mode;
  if (opts.mode && (opts.mode === 'code' || (PREVIEW_KINDS.includes(kind) && cur.text !== null))) cur.mode = opts.mode;
  state.current = cur;
  await renderCurrent();
  if (token !== openToken) return;
  if (opts.line && cur.mode === 'code') jumpToLine(opts.line);
  syncRoute();
}

function autoDetect(text) {
  const sample = text.slice(0, 20000);
  const first = sample.split('\n', 1)[0];
  const shebang = /^#!\S*?(?:\/env\s+(?:-\S+\s+)*)?\/?(?:\S*\/)?(python|node|deno|bun|bash|sh|zsh|ksh|dash|ruby|perl|php|lua|Rscript)[\d.]*\b/.exec(first);
  if (shebang) {
    const m = { node: 'javascript', deno: 'typescript', bun: 'javascript', sh: 'bash', zsh: 'bash', ksh: 'bash', dash: 'bash', Rscript: 'r' }[shebang[1]] || shebang[1];
    if (langById(m)) return m;
  }
  if (/^\s*[[{]/.test(sample)) {
    try { JSON.parse(text); return 'json'; } catch { /* 不是 JSON */ }
  }
  if (/^\s*(<\?xml|<!doctype html|<html[\s>])/i.test(sample)) return 'xml';
  if (/^(diff --git|--- a\/|Index: )/m.test(sample.slice(0, 2000))) return 'diff';
  const head = sample.slice(0, 4000);
  const logLines = (head.match(/^\[?\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/gm) || []).length;
  if (logLines >= 2 && /\b(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\b/.test(head)) return 'log';
  // 少数几种语言有非常明确的标志，highlight.js 的打分区分不开时直接判断（短片段也适用）
  const sig = signatureLang(sample);
  if (sig) return sig;
  if (sample.trim().length < 20) return 'plaintext';
  // 大段自然语言（如中文）不当作代码
  const cjk = (sample.match(/[\u3400-\u9fff]/g) || []).length;
  const symbols = (sample.match(/[{}();=<>[\]]/g) || []).length;
  if (cjk > sample.length * 0.3 && symbols < sample.length * 0.02) return 'plaintext';
  try {
    const r = hljs.highlightAuto(sample, AUTO_LANGS);
    // 置信度按长度放宽：短代码片段的 relevance 天然偏低
    const lines = countLines(sample);
    const need = lines < 15 ? 5 : 8;
    const margin = (r.relevance || 0) - (r.secondBest?.relevance || 0);
    if (!r.language || r.relevance < need) return 'plaintext';
    if (margin >= 1) return r.language;
    // JS 与 TS 打分常常相同：没有类型标注时按 JavaScript 处理
    const pair = [r.language, r.secondBest?.language].sort().join(',');
    if (pair === 'javascript,typescript') {
      return /:\s*(string|number|boolean|any|void|unknown|never)\b|\binterface\s+\w+|\btype\s+\w+\s*=|<\w+>\(/.test(sample) ? 'typescript' : 'javascript';
    }
    return 'plaintext';
  } catch {
    return 'plaintext';
  }
}

function signatureLang(s) {
  const head = s.slice(0, 6000);
  if (/^\s*package\s+[a-z_]\w*\s*$/m.test(head) && /\bfunc\s+(\(\w+\s+\*?\w+\)\s*)?\w+\s*\(/.test(head)) return 'go';
  if (/^\s*package\s+[\w.]+;\s*$/m.test(head) || /\bpublic\s+static\s+void\s+main\s*\(\s*String/.test(head)
    || (/\b(public|private|protected)\s+(final\s+)?class\s+\w+/.test(head) && /System\.out\.|@Override|import\s+java\./.test(head))) return 'java';
  if (/^\s*using\s+System(\.\w+)*;\s*$/m.test(head) || /\bnamespace\s+[\w.]+\s*[{;]/.test(head) && /\bpublic\s+(class|record|interface)\b/.test(head)) return 'csharp';
  if (/^\s*<\?php\b/.test(head)) return 'php';
  if (/^\s*#include\s*<(iostream|vector|string|map|memory|algorithm)>/m.test(head) || /\bstd::\w+/.test(head)) return 'cpp';
  if (/^\s*#include\s*[<"][\w/.]+\.h[>"]/m.test(head) && !/\b(class|template|namespace)\b/.test(head)) return 'c';
  if (/^\s*fun\s+main\s*\(/m.test(head) || (/^\s*(data\s+class|object)\s+\w+/m.test(head) && /\bval\s+\w+/.test(head))) return 'kotlin';
  if (/^\s*import\s+(SwiftUI|UIKit|Foundation)\s*$/m.test(head)) return 'swift';
  // Python：def/class 行以冒号结尾，且有缩进块
  if (/^\s*(async\s+)?def\s+\w+\s*\(.*\)\s*(->\s*[^:]+)?:\s*$/m.test(head) || /^\s*from\s+[\w.]+\s+import\s+\w/m.test(head)
    || (/^\s*(if|for|while|elif|else|try|except|with)\b.*:\s*$/m.test(head) && /^\s*(print|import|return)\b/m.test(head) && !/[{};]\s*$/m.test(head))) return 'python';
  return null;
}

/** 主包没有的语言，按需从 vendor/hljs/languages 加载 */
function ensureLanguage(id) {
  const lang = langById(id);
  if (!lang || !lang.extra || hljs.getLanguage(id)) return Promise.resolve(true);
  if (state.langLoads.has(id)) return state.langLoads.get(id);
  const p = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `./vendor/hljs/languages/${id}.min.js`;
    s.onload = () => resolve(!!hljs.getLanguage(id));
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  state.langLoads.set(id, p);
  return p;
}

/* ============================== 渲染 ============================== */
function showWelcome() {
  destroyDoc();
  state.activeId = null;
  state.selLines = null;
  $$('.tree-row.file.active').forEach((r) => r.classList.remove('active'));
  state.current = null;
  $('#welcome').hidden = false;
  $('#content').hidden = true;
  $('#content').replaceChildren();
  $('#file-tools').hidden = true;
  $('#file-name').textContent = '';
  $('#file-meta').textContent = '';
  $('#st-left').textContent = '';
  $('#st-right').textContent = '';
  document.title = `${APP_NAME} · 在线预览任何文件`;
  closeFind();
  syncRoute();
}

/** 当前文件能否用查找：文本、可搜索的文档（Word / 表格…）、自带查找的文档（PDF） */
function canFind(cur = state.current) {
  if (!cur) return false;
  if (cur.text !== null) return true;
  return !!(cur.doc && (state.docCtl?.searchable || state.docCtl?.find));
}

function syncToolbar() {
  const cur = state.current;
  const { file } = cur;
  $('#welcome').hidden = true;
  $('#content').hidden = false;
  $('#file-tools').hidden = false;
  $('#file-name').textContent = baseName(file.path);
  $('#file-name').title = file.path;
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
  $('#file-meta').textContent = dir;
  document.title = `${baseName(file.path)} — ${APP_NAME}`;

  const hasPreview = PREVIEW_KINDS.includes(cur.kind) && cur.text !== null;
  $('#mode-seg').hidden = !hasPreview;
  $$('#mode-seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === cur.mode));
  const isText = cur.text !== null;
  $('#lang-select').hidden = !isText || cur.mode !== 'code';
  $('#enc-select').hidden = !isText;
  $('#btn-wrap').hidden = !isText || cur.mode !== 'code';
  $('#btn-search').hidden = !canFind(cur);
  $('#btn-copy').hidden = !isText;
  if (isText) {
    $('#lang-select').value = cur.lang;
    $('#enc-select').value = cur.encoding;
    $('#enc-select').title = `文本编码（当前：${cur.detectedEncoding || cur.encoding}）`;
  }
  $('#btn-wrap').classList.toggle('on', state.settings.wrap);
}

function updateStatus(extra = '') {
  const cur = state.current;
  if (!cur) return;
  const left = [];
  const right = [];
  if (cur.text !== null) {
    const lines = countLines(cur.text);
    left.push(`${lines.toLocaleString()} 行`, `${cur.text.length.toLocaleString()} 字符`);
    right.push(langById(cur.lang)?.name || cur.lang);
    right.push((cur.detectedEncoding || cur.encoding).toUpperCase());
    right.push(/\r\n/.test(cur.text.slice(0, 10000)) ? 'CRLF' : 'LF');
  } else if (cur.doc && docMod) {
    docMod.then((m) => { if (state.current === cur) $('#st-right').textContent = m.DOC_NAMES[cur.kind] || ''; });
  }
  left.push(formatSize(cur.file.size));
  if (cur.file.mtime) left.push(new Date(cur.file.mtime).toLocaleString('zh-CN', { hour12: false }));
  if (cur.statusText) left.push(cur.statusText);
  if (extra) left.push(extra);
  $('#st-left').textContent = left.join('  ·  ');
  $('#st-right').textContent = right.join('  ·  ');
}

function countLines(text) {
  if (!text) return 0;
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  if (text.endsWith('\n')) n--;
  return n;
}

async function renderCurrent() {
  const cur = state.current;
  if (!cur) return;
  const token = openToken;
  destroyDoc();
  syncToolbar();
  const content = $('#content');
  content.classList.remove('fill');
  $('#viewer').scrollTop = 0;
  $('#viewer').scrollLeft = 0;

  if (cur.doc && !cur.tooBig) {
    await renderDocument(content, cur, token);
    return;
  }
  if (cur.kind === 'image') {
    const blob = await cur.file.getBlob();
    if (token !== openToken) return;
    const url = URL.createObjectURL(blob);
    const wrap = document.createElement('div');
    wrap.className = 'media';
    const img = new Image();
    img.alt = baseName(cur.file.path);
    img.onload = () => { updateStatus(`${img.naturalWidth} × ${img.naturalHeight}`); };
    img.src = url;
    wrap.appendChild(img);
    content.replaceChildren(wrap);
    updateStatus();
    return;
  }
  if (cur.tooBig || cur.binary) {
    const box = document.createElement('div');
    box.className = 'binary';
    box.innerHTML = cur.tooBig
      ? `<div>文件太大（${formatSize(cur.file.size)}），超过 ${formatSize(cur.doc ? MAX_DOC : MAX_TEXT)} 的文件不在页面里显示。</div>`
      : '<div>这看起来是二进制文件，无法以文本显示。</div>';
    if (cur.binary) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.type = 'button';
      btn.textContent = '仍然以文本打开';
      btn.addEventListener('click', () => openFile(cur.file.id, { forceText: true }));
      box.appendChild(btn);
    }
    content.replaceChildren(box);
    updateStatus();
    return;
  }

  if (cur.mode === 'preview') {
    if (cur.kind === 'markdown') renderMarkdown(content, cur.text);
    else if (cur.kind === 'csv' || cur.kind === 'tsv') renderCsv(content, cur.text, cur.kind === 'tsv' ? '\t' : null);
    else if (cur.kind === 'html' || cur.kind === 'svg') renderHtmlFrame(content, cur.text, cur.kind);
    else if (cur.kind === 'json') renderJsonTree(content, cur.text);
    updateStatus();
    return;
  }
  await renderCode(content, cur);
  if (token === openToken) updateStatus();
}

/* ---------- 文档（PDF / EPUB / Word / 表格 / 演示文稿 / 音视频 / 字体） ---------- */
function destroyDoc() {
  const ctl = state.docCtl;
  state.docCtl = null;
  if (ctl?.destroy) { try { ctl.destroy(); } catch (err) { console.warn(err); } }
}

async function renderDocument(content, cur, token) {
  const loading = document.createElement('div');
  loading.className = 'doc-loading';
  loading.textContent = '正在打开…';
  content.replaceChildren(loading);
  content.classList.add('fill');
  updateStatus();
  const host = document.createElement('div');
  host.className = 'doc-host';
  try {
    const mod = await loadDocViewers();
    const blob = await cur.file.getBlob();
    let bytes = null;
    if (mod.needsBytes(cur.kind)) {
      bytes = cur.file.bytes || new Uint8Array(await blob.arrayBuffer());
      cur.file.bytes = bytes;
      cur.file.size = bytes.length;
    }
    if (token !== openToken) return;
    content.replaceChildren(host);
    const ctl = await mod.renderDoc(cur.kind, host, { bytes, blob, name: baseName(cur.file.path) }, {
      at: cur.at,
      dark: effectiveTheme() === 'dark',
      onPosition(at) {
        if (state.current !== cur) return;
        cur.at = at;
        syncRoute();
      },
      status(text) {
        if (state.current !== cur) return;
        cur.statusText = text;
        updateStatus();
      },
    });
    if (token !== openToken || state.current !== cur) { ctl.destroy?.(); return; }
    state.docCtl = ctl;
    syncToolbar();
  } catch (err) {
    if (token !== openToken) return;
    console.warn('文档预览失败', err);
    const box = document.createElement('div');
    box.className = 'binary';
    const msg = document.createElement('div');
    msg.textContent = `无法预览这个文件：${err?.message || err}`;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = '下载文件';
    btn.addEventListener('click', download);
    box.append(msg, btn);
    content.classList.remove('fill');
    content.replaceChildren(box);
  }
}

async function renderCode(content, cur) {
  const text = cur.text;
  const token = openToken;
  let html = null;
  let notice = '';
  if (text.length > MAX_HIGHLIGHT) {
    notice = `文件较大（${formatSize(text.length)}），已关闭语法高亮以保证流畅。`;
  } else if (cur.lang === 'log') {
    html = highlightLog(text);
  } else if (cur.lang && cur.lang !== 'plaintext') {
    if (text.length > WORKER_THRESHOLD) {
      // 先显示无高亮的内容，后台高亮完成后再替换
      fillCodeTable(content, splitHighlighted(escapeHtml(text)), notice, cur);
      $('#st-left').textContent = '正在高亮…';
      html = await highlightInWorker(text, cur.lang);
      if (token !== openToken || state.current !== cur) return;
    } else {
      await ensureLanguage(cur.lang);
      if (hljs.getLanguage(cur.lang)) {
        try {
          html = hljs.highlight(text, { language: cur.lang, ignoreIllegals: true }).value;
        } catch (err) {
          console.warn('高亮失败', err);
        }
      }
    }
  }
  if (html === null) html = escapeHtml(text);
  const lines = splitHighlighted(html);
  if (lines.length > MAX_RENDER_LINES) {
    lines.length = MAX_RENDER_LINES;
    notice = `文件有 ${countLines(text).toLocaleString()} 行，只显示前 ${MAX_RENDER_LINES.toLocaleString()} 行；完整内容可以下载查看。`;
  }
  // 保留查找栏状态与滚动位置（后台高亮完成后替换内容时不打断阅读）
  const viewer = $('#viewer');
  const { scrollTop, scrollLeft } = viewer;
  const findOpen = !$('#findbar').hidden;
  fillCodeTable(content, lines, notice, cur);
  viewer.scrollTop = scrollTop;
  viewer.scrollLeft = scrollLeft;
  if (state.selLines) markLines(state.selLines);
  if (findOpen && state.find.query) runFind();
}

function fillCodeTable(content, lines, notice, cur) {
  const parts = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    parts[i] = `<tr id="L${i + 1}"><td class="ln" data-n="${i + 1}"></td><td class="lc">${lines[i] || ' '}</td></tr>`;
  }
  const wrap = document.createElement('div');
  wrap.innerHTML = `${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}<table class="code-table hljs${state.settings.wrap ? ' wrap' : ''}"><tbody>${parts.join('')}</tbody></table>`;
  content.replaceChildren(...wrap.childNodes);
  cur.lineCount = lines.length;
}

let worker = null;
let workerSeq = 0;
const workerJobs = new Map();
function highlightInWorker(text, lang) {
  if (!worker) {
    try {
      worker = new Worker('./highlight-worker.js');
      worker.onmessage = (e) => {
        const job = workerJobs.get(e.data.id);
        if (!job) return;
        workerJobs.delete(e.data.id);
        if (e.data.error) console.warn('后台高亮失败', e.data.error);
        job(e.data.html ?? null);
      };
      worker.onerror = () => {
        for (const job of workerJobs.values()) job(null);
        workerJobs.clear();
        worker = null;
      };
    } catch {
      return Promise.resolve(null);
    }
  }
  // 只保留最新的任务：切换文件时丢弃旧任务的结果
  for (const job of workerJobs.values()) job(null);
  workerJobs.clear();
  const id = ++workerSeq;
  return new Promise((resolve) => {
    workerJobs.set(id, resolve);
    worker.postMessage({ id, text, lang, extra: !!langById(lang)?.extra });
  });
}

/**
 * 把高亮后的 HTML 按行切开，并在行尾关闭、行首重新打开跨行的 <span>，
 * 这样多行注释、多行字符串在逐行表格里也能保持正确颜色。
 */
function splitHighlighted(html) {
  const out = [];
  const open = [];
  let line = '';
  const re = /<span[^>]*>|<\/span>|\n|[^<\n]+|</g;
  let m;
  while ((m = re.exec(html))) {
    const tok = m[0];
    if (tok === '\n') {
      out.push(line.replace(/\r$/, '') + '</span>'.repeat(open.length));
      line = open.join('');
    } else if (tok.startsWith('<span')) {
      open.push(tok);
      line += tok;
    } else if (tok === '</span>') {
      open.pop();
      line += tok;
    } else {
      line += tok;
    }
  }
  if (line !== open.join('') || !out.length) out.push(line + '</span>'.repeat(open.length));
  if (out.length > 1 && /^(<span[^>]*>)*(<\/span>)*$/.test(out[out.length - 1])) out.pop(); // 末尾换行不产生空行
  return out;
}

function highlightLog(text) {
  return escapeHtml(text)
    .replace(/^(\[?\d{4}-\d{2}-\d{2}[ T][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?\]?)/gm, '<span class="hljs-comment">$1</span>')
    .replace(/\b(ERROR|FATAL|CRITICAL|SEVERE|Exception|Traceback)\b/g, '<span class="hljs-deletion">$1</span>')
    .replace(/\b(WARN|WARNING)\b/g, '<span class="hljs-built_in">$1</span>')
    .replace(/\b(INFO|NOTICE)\b/g, '<span class="hljs-string">$1</span>')
    .replace(/\b(DEBUG|TRACE)\b/g, '<span class="hljs-meta">$1</span>');
}

/* ---------- Markdown ---------- */
function renderMarkdown(content, text) {
  const raw = marked.parse(text, { gfm: true, breaks: false });
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'] });
  const div = document.createElement('article');
  div.className = 'md';
  div.innerHTML = clean;
  // 只保留 GFM 任务列表的只读勾选框，其他 input 一律移除
  div.querySelectorAll('input').forEach((el) => {
    if (el.type === 'checkbox' && el.closest('li')) el.disabled = true;
    else el.remove();
  });
  // 外链在新窗口打开；相对链接若指向已加载的文件则在本页打开
  div.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (/^https?:/i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else if (!href.startsWith('#')) {
      a.addEventListener('click', (e) => {
        const target = resolveRelative(href.split('#')[0]);
        if (target) { e.preventDefault(); openFile(target.id); }
      });
    }
  });
  // 相对路径图片：从已加载的文件中找
  div.querySelectorAll('img[src]').forEach(async (img) => {
    const src = img.getAttribute('src');
    if (/^(https?:|data:|blob:)/i.test(src)) return;
    const f = resolveRelative(src);
    if (f) img.src = URL.createObjectURL(await f.getBlob());
  });
  div.querySelectorAll('pre code').forEach((el) => {
    const m = /language-([\w+#-]+)/.exec(el.className);
    const id = m && (hljs.getLanguage(m[1]) ? m[1] : null);
    try {
      el.innerHTML = id ? hljs.highlight(el.textContent, { language: id, ignoreIllegals: true }).value : escapeHtml(el.textContent);
      el.classList.add('hljs');
    } catch { /* ignore */ }
  });
  content.replaceChildren(div);
}

function resolveRelative(rel) {
  const cur = state.current?.file.path || '';
  const dir = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')).split('/') : [];
  for (const seg of decodeURIComponent(rel).split('/')) {
    if (seg === '..') dir.pop();
    else if (seg && seg !== '.') dir.push(seg);
  }
  const path = dir.join('/');
  return state.files.find((f) => f.path === path) || null;
}

/* ---------- CSV / TSV ---------- */
function parseCsv(text, delim) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_CSV_ROWS) break;
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function guessDelimiter(text) {
  const head = text.slice(0, 5000).split(/\r?\n/).slice(0, 10);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = head.map((l) => l.split(d).length - 1).filter((n) => n > 0);
    if (!counts.length) continue;
    const consistent = counts.every((n) => n === counts[0]);
    const score = (consistent ? 1000 : 0) + counts[0];
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function renderCsv(content, text, delim) {
  const d = delim || guessDelimiter(text);
  const rows = parseCsv(text.replace(/^\uFEFF/, ''), d);
  const shown = rows.slice(0, MAX_CSV_ROWS + 1);
  const cols = Math.max(...shown.map((r) => r.length));
  const isNum = (s) => /^\s*-?[\d,]*\.?\d+(e[+-]?\d+)?%?\s*$/i.test(s);
  const head = shown[0] || [];
  let h = '<div class="csv-wrap"><table class="csv"><thead><tr><th class="rn"></th>';
  for (let c = 0; c < cols; c++) h += `<th title="${escapeHtml(head[c] ?? '')}">${escapeHtml(head[c] ?? '')}</th>`;
  h += '</tr></thead><tbody>';
  for (let r = 1; r < shown.length; r++) {
    h += `<tr><td class="rn">${r}</td>`;
    for (let c = 0; c < cols; c++) {
      const v = shown[r][c] ?? '';
      h += `<td${isNum(v) ? ' class="num"' : ''} title="${escapeHtml(v)}">${escapeHtml(v)}</td>`;
    }
    h += '</tr>';
  }
  h += '</tbody></table></div>';
  content.innerHTML = h;
  if (rows.length > MAX_CSV_ROWS) {
    const n = document.createElement('div');
    n.className = 'notice';
    n.textContent = `只显示前 ${MAX_CSV_ROWS.toLocaleString()} 行，完整内容请切换到「源码」查看。`;
    content.prepend(n);
  }
}

/* ---------- HTML / SVG ---------- */
function renderHtmlFrame(content, text, kind) {
  const frame = document.createElement('iframe');
  frame.className = 'html-frame';
  // 不允许脚本、表单、弹窗；与本站完全隔离
  frame.setAttribute('sandbox', '');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  const type = kind === 'svg' ? 'image/svg+xml' : 'text/html';
  const url = URL.createObjectURL(new Blob([text], { type }));
  frame.src = url;
  frame.addEventListener('load', () => setTimeout(() => URL.revokeObjectURL(url), 1000), { once: true });
  content.classList.add('fill');
  content.replaceChildren(frame);
}

/* ---------- JSON 树 ---------- */
function renderJsonTree(content, text) {
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    const n = document.createElement('div');
    n.className = 'notice';
    n.textContent = `JSON 解析失败：${err.message}`;
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.textContent = '查看源码';
    b.addEventListener('click', () => setMode('code'));
    n.appendChild(b);
    content.replaceChildren(n);
    return;
  }
  const root = document.createElement('div');
  root.className = 'json-tree';
  let budget = 20000; // 节点太多时默认折叠深层，避免一次性生成过多 DOM
  const scalar = (v) => {
    const s = document.createElement('span');
    if (v === null) { s.className = 'jt-null'; s.textContent = 'null'; }
    else if (typeof v === 'string') { s.className = 'jt-str'; s.textContent = JSON.stringify(v); }
    else if (typeof v === 'number') { s.className = 'jt-num'; s.textContent = String(v); }
    else { s.className = 'jt-bool'; s.textContent = String(v); }
    return s;
  };
  const build = (key, value, depth, last) => {
    const node = document.createElement('div');
    node.className = 'jt-node';
    const line = document.createElement('div');
    line.className = 'jt-line';
    const comma = last ? '' : ',';
    const isObj = value && typeof value === 'object';
    if (isObj) {
      const tog = document.createElement('span');
      tog.className = 'jt-toggle';
      tog.addEventListener('click', () => node.classList.toggle('jt-closed'));
      line.appendChild(tog);
    }
    if (key !== null) {
      const k = document.createElement('span');
      k.className = 'jt-key';
      k.textContent = JSON.stringify(key);
      line.append(k, ': ');
    }
    if (!isObj) {
      line.append(scalar(value), comma);
      node.appendChild(line);
      return node;
    }
    const arr = Array.isArray(value);
    const entries = arr ? value.map((v, i) => [i, v]) : Object.entries(value);
    const [o, c] = arr ? ['[', ']'] : ['{', '}'];
    if (!entries.length) {
      line.append(`${o}${c}${comma}`);
      node.appendChild(line);
      return node;
    }
    const sum = document.createElement('span');
    sum.className = 'jt-summary';
    sum.textContent = ` ${arr ? `${entries.length} 项` : `${entries.length} 个键`} ${c}${comma}`;
    line.append(o, sum);
    node.appendChild(line);
    budget -= entries.length;
    if (depth >= 2 && budget < 0) node.classList.add('jt-closed');
    const kids = document.createElement('div');
    kids.className = 'jt-kids';
    entries.forEach(([k, v], i) => kids.appendChild(build(arr ? null : k, v, depth + 1, i === entries.length - 1)));
    const end = document.createElement('div');
    end.className = 'jt-end';
    end.textContent = c + comma;
    node.append(kids, end);
    return node;
  };
  const top = build(null, data, 0, true);
  top.style.paddingLeft = '14px';
  root.appendChild(top);
  content.replaceChildren(root);
}

function setMode(mode) {
  if (!state.current || state.current.mode === mode) return Promise.resolve();
  state.current.mode = mode;
  state.selLines = null;
  closeFind();
  return renderCurrent().then(() => syncRoute());
}

/* ============================== 行号 / 跳转 ============================== */
function markLines([a, b]) {
  $$('tr.hl-line').forEach((r) => r.classList.remove('hl-line'));
  for (let i = a; i <= b; i++) document.getElementById(`L${i}`)?.classList.add('hl-line');
}

/** 选中第 a～b 行（b 省略则单行），并写入地址栏 */
function jumpToLine(range, scroll = true) {
  let [a, b = a] = Array.isArray(range) ? range : [range];
  if (a > b) [a, b] = [b, a];
  const max = state.current?.lineCount || 0;
  if (!max || a < 1) return;
  a = Math.min(a, max);
  b = Math.min(b, max);
  state.selLines = [a, b];
  markLines(state.selLines);
  if (scroll) document.getElementById(`L${a}`)?.scrollIntoView({ block: 'center' });
  syncRoute();
}

function clearLines() {
  if (!state.selLines) return;
  state.selLines = null;
  $$('tr.hl-line').forEach((r) => r.classList.remove('hl-line'));
  syncRoute();
}

/* ============================== 路由 ==============================
 * 用 hash 路由，静态部署无需服务端改写：
 *   #/                                  欢迎页
 *   #/examples/backend/main.go          打开文件
 *   #/examples/web/index.html?mode=code 指定视图（code / preview，默认值不写）
 *   #/examples/backend/main.go?L=12-20  选中行（单行写 L=12）
 *   #/examples/backend                  目录：打开其中第一个文件
 * 示例文件可直接通过链接分享；本地文件只在当前会话内有效，刷新后无法恢复。
 */
let routing = false; // 正在按地址栏恢复状态时不回写历史

function parseRoute(hash = location.hash) {
  if (!hash || hash === '#' || hash === '#/') return { path: '' };
  const legacy = /^#L(\d+)(?:-L?(\d+))?$/.exec(hash); // 旧格式 #L12
  if (legacy) return { path: state.current?.file.path || '', line: [Number(legacy[1]), Number(legacy[2] || legacy[1])] };
  const m = /^#\/([^?]*)(?:\?(.*))?$/.exec(hash);
  if (!m) return null; // 其他 hash（如 Markdown 内部锚点）不视为路由
  let path = '';
  try { path = m[1].split('/').map(decodeURIComponent).join('/'); } catch { return { path: '' }; }
  const q = new URLSearchParams(m[2] || '');
  const mode = ['code', 'preview'].includes(q.get('mode')) ? q.get('mode') : null;
  const lm = /^(\d+)(?:-(\d+))?$/.exec(q.get('L') || '');
  const at = (q.get('at') || '').slice(0, 500) || null;
  return { path: path.replace(/\/+$/, ''), mode, at, line: lm ? [Number(lm[1]), Number(lm[2] || lm[1])] : null };
}

function buildRoute({ path, mode, line, at }) {
  if (!path) return '';
  const q = [];
  if (mode) q.push(`mode=${mode}`);
  if (line) q.push(`L=${line[0] === line[1] ? line[0] : `${line[0]}-${line[1]}`}`);
  if (at) q.push(`at=${encodeURIComponent(at)}`);
  return `#/${path.split('/').map(encodeURIComponent).join('/')}${q.length ? `?${q.join('&')}` : ''}`;
}

/** 把当前状态写入地址栏：换文件时新增历史记录，视图 / 选行 / 翻页变化时替换当前记录 */
function syncRoute({ replace = false } = {}) {
  if (routing) return;
  const cur = state.current;
  const route = cur
    ? {
      path: cur.file.path,
      mode: cur.mode !== cur.defaultMode ? cur.mode : null,
      line: cur.mode === 'code' ? state.selLines : null,
      at: cur.doc ? cur.at : null,
    }
    : { path: '' };
  const hash = buildRoute(route);
  if (hash === (location.hash === '#' ? '' : location.hash)) return;
  const url = hash || location.pathname + location.search;
  const samePath = (parseRoute()?.path || '') === route.path;
  if (replace || samePath) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

async function applyRoute() {
  const r = parseRoute();
  if (!r) return;
  routing = true;
  try {
    await restoreRoute(r);
  } finally {
    routing = false;
  }
  // 规范化地址栏：目录 → 文件、旧格式 #L12 → ?L=12、找不到的文件 → 首页
  syncRoute({ replace: true });
}

async function restoreRoute(r) {
  if (!r.path) {
    if (state.current) showWelcome();
    return;
  }
  // 地址以「示例/」开头的只在示例里找，其余只在用户文件里找（两组路径可能重名）
  const wantExample = r.path === EXAMPLES_ROOT || r.path.startsWith(`${EXAMPLES_ROOT}/`);
  const pool = () => state.files.filter((f) => !!f.example === wantExample);
  const find = () => pool().find((f) => f.path === r.path)
    || pickFirst(pool().filter((f) => f.path.startsWith(`${r.path}/`)));
  let file = find();
  if (!file && wantExample) {
    await loadExamples({ open: false });
    file = find();
  }
  if (!file) {
    toast(state.files.length ? '链接中的文件不在当前列表里' : '本地文件刷新后需要重新打开', 2600);
    showWelcome();
    return;
  }
  const cur = state.current;
  if (cur?.file === file) {
    if (cur.doc) {
      if ((r.at || null) !== (cur.at || null)) { cur.at = r.at; state.docCtl?.goto?.(r.at); }
      return;
    }
    await setMode(r.mode || cur.defaultMode);
    if (r.line) jumpToLine(r.line); else clearLines();
  } else {
    await openFile(file.id, { mode: r.mode, line: r.line, at: r.at });
  }
}

/** 展开文件所在目录并滚动到可见 */
function revealInTree(file) {
  const parts = file.path.split('/');
  let changed = state.closedGroups.delete(file.example ? 'example' : 'mine');
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/');
    if (!state.openDirs.has(dir)) { state.openDirs.add(dir); changed = true; }
  }
  if (changed) renderTree();
  document.querySelector(`.tree-row.file[data-id="${file.id}"]`)?.scrollIntoView({ block: 'nearest' });
}

/* ============================== 查找 ============================== */
/** PDF 等自带查找能力的文档：查找交给文档渲染器 */
const nativeFind = () => (state.current?.doc && state.docCtl?.find ? state.docCtl : null);

function openFind() {
  const cur = state.current;
  if (!canFind(cur)) return;
  if (cur.mode === 'preview' && ['html', 'svg'].includes(cur.kind)) setMode('code');
  $('#findbar').hidden = false;
  $('#find-regex').hidden = !!nativeFind();
  const input = $('#find-input');
  const sel = window.getSelection()?.toString();
  if (sel && sel.length < 200 && !sel.includes('\n')) input.value = sel;
  input.focus();
  input.select();
  runFind();
}
function closeFind() {
  if (!$('#findbar').hidden) nativeFind()?.findClose?.();
  $('#findbar').hidden = true;
  clearMarks();
  state.find.marks = [];
  state.find.index = -1;
  $('#find-count').textContent = '';
}
function clearMarks() {
  for (const m of $$('#content mark.fm')) {
    const parent = m.parentNode;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  }
}

function buildMatcher() {
  const { query, caseSensitive, regex } = state.find;
  if (!query) return null;
  const flags = caseSensitive ? 'g' : 'gi';
  try {
    return new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch {
    return 'bad';
  }
}

function runFind() {
  const f = state.find;
  f.query = $('#find-input').value;
  const nf = nativeFind();
  if (nf) {
    $('#find-count').textContent = f.query ? '查找中…' : '';
    nf.find(f.query, { caseSensitive: f.caseSensitive }, (cur, total) => {
      if (!f.query) { $('#find-count').textContent = ''; return; }
      $('#find-count').textContent = total ? `${cur} / ${total}` : '无结果';
    });
    return;
  }
  clearMarks();
  f.marks = [];
  f.index = -1;
  const re = buildMatcher();
  $('#find-input').classList.toggle('bad', re === 'bad');
  if (!re || re === 'bad') { $('#find-count').textContent = re === 'bad' ? '正则有误' : ''; return; }

  const scope = $('#content');
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('.ln, .rn, .notice, .jt-toggle') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  const LIMIT = 5000;
  for (const node of nodes) {
    const text = node.nodeValue;
    re.lastIndex = 0;
    const hits = [];
    let m;
    while ((m = re.exec(text)) && f.marks.length + hits.length < LIMIT) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      hits.push([m.index, m.index + m[0].length]);
    }
    if (!hits.length) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [s, e] of hits) {
      if (s > pos) frag.appendChild(document.createTextNode(text.slice(pos, s)));
      const mark = document.createElement('mark');
      mark.className = 'fm';
      mark.textContent = text.slice(s, e);
      frag.appendChild(mark);
      f.marks.push(mark);
      pos = e;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    node.parentNode.replaceChild(frag, node);
    if (f.marks.length >= LIMIT) break;
  }
  if (!f.marks.length) { $('#find-count').textContent = '无结果'; return; }
  // 从当前视口位置之后的第一个匹配开始
  const top = $('#viewer').getBoundingClientRect().top;
  const i = f.marks.findIndex((mk) => mk.getBoundingClientRect().top >= top);
  gotoMatch(i < 0 ? 0 : i);
}

function gotoMatch(i) {
  const f = state.find;
  const nf = nativeFind();
  if (nf) { nf.findAgain(i < f.index); return; }
  if (!f.marks.length) return;
  if (f.index >= 0) f.marks[f.index]?.classList.remove('cur');
  f.index = (i + f.marks.length) % f.marks.length;
  const mk = f.marks[f.index];
  mk.classList.add('cur');
  // JSON 树中被折叠的节点需要展开
  for (let p = mk.parentElement; p && p.id !== 'content'; p = p.parentElement) {
    if (p.classList.contains('jt-closed')) p.classList.remove('jt-closed');
  }
  mk.scrollIntoView({ block: 'center', inline: 'nearest' });
  $('#find-count').textContent = `${f.index + 1} / ${f.marks.length}${f.marks.length >= 5000 ? '+' : ''}`;
}

/* ============================== 操作 ============================== */
async function copyAll() {
  const text = state.current?.text;
  if (text === null || text === undefined) return;
  try {
    await navigator.clipboard.writeText(text);
    toast('已拷贝全部内容');
  } catch {
    toast('拷贝失败，请手动选择内容拷贝');
  }
}

async function download() {
  const file = state.current?.file;
  if (!file) return;
  const blob = await file.getBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = baseName(file.path);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function openPaste(prefill = '') {
  $('#paste-mask').hidden = false;
  $('#paste-dialog').hidden = false;
  $('#paste-text').value = prefill;
  $('#paste-name').value = '';
  setTimeout(() => (prefill ? $('#paste-name') : $('#paste-text')).focus(), 20);
}
function closePaste() {
  $('#paste-mask').hidden = true;
  $('#paste-dialog').hidden = true;
}
async function confirmPaste() {
  const text = $('#paste-text').value;
  if (!text.trim()) { toast('内容是空的'); return; }
  const name = $('#paste-name').value;
  closePaste();
  const f = addText(text, name);
  await afterAdd([f]);
}

/* ============================== 语言下拉 ============================== */
function buildLangSelect() {
  const sel = $('#lang-select');
  const sorted = [...LANGS].sort((a, b) => {
    const top = ['plaintext', 'log'];
    if (top.includes(a.id) !== top.includes(b.id)) return top.includes(a.id) ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  for (const l of sorted) {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.name;
    sel.appendChild(o);
  }
}

/* ============================== 侧边栏 ============================== */
function applySidebar() {
  document.documentElement.style.setProperty('--side-w', `${state.settings.sideW}px`);
  $('#app').classList.toggle('side-hidden', state.settings.sideHidden);
}
function bindResizer() {
  const handle = $('#side-resizer');
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    const startX = e.clientX;
    const startW = state.settings.sideW;
    const move = (ev) => {
      state.settings.sideW = clamp(startW + ev.clientX - startX, 180, Math.min(600, innerWidth * 0.6));
      applySidebar();
    };
    const up = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      saveSettings();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
  });
}

/* ============================== 事件 ============================== */
function bindEvents() {
  const fileInput = $('#file-input');
  const dirInput = $('#dir-input');
  const pickFiles = () => fileInput.click();
  const pickDir = () => dirInput.click();
  $('#btn-open').addEventListener('click', pickFiles);
  $('#btn-open-dir').addEventListener('click', pickDir);
  $('#btn-new').addEventListener('click', () => openPaste());
  $('#btn-clear').addEventListener('click', clearAll);
  // 左上角品牌：回到首页（保留已打开的文件列表）
  $$('[data-home]').forEach((a) => a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (state.current) showWelcome();
  }));
  $$('[data-trigger]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.trigger === 'open') pickFiles();
    else if (b.dataset.trigger === 'open-dir') pickDir();
    else if (b.dataset.trigger === 'examples') loadExamples();
    else openPaste();
  }));
  for (const input of [fileInput, dirInput]) {
    input.addEventListener('change', async () => {
      if (input.files?.length) await afterAdd(await addFromFileList(input.files));
      input.value = '';
    });
  }

  $('#filter').addEventListener('input', renderTree);
  $('#btn-toggle-side').addEventListener('click', () => {
    state.settings.sideHidden = !state.settings.sideHidden;
    saveSettings();
    applySidebar();
  });
  $('#btn-theme').addEventListener('click', cycleTheme);
  darkQuery.addEventListener('change', applyTheme);
  $('#btn-font-up').addEventListener('click', () => changeFontSize(1));
  $('#btn-font-down').addEventListener('click', () => changeFontSize(-1));
  $('#btn-wrap').addEventListener('click', () => {
    state.settings.wrap = !state.settings.wrap;
    saveSettings();
    $('#btn-wrap').classList.toggle('on', state.settings.wrap);
    $('.code-table')?.classList.toggle('wrap', state.settings.wrap);
  });
  $('#btn-copy').addEventListener('click', copyAll);
  $('#btn-download').addEventListener('click', download);
  $('#btn-search').addEventListener('click', openFind);
  $$('#mode-seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  $('#lang-select').addEventListener('change', async (e) => {
    if (!state.current) return;
    state.current.lang = e.target.value;
    state.current.file.lang = e.target.value;
    refreshTreeBadge(state.current.file);
    closeFind();
    await renderCurrent();
  });
  $('#enc-select').addEventListener('change', (e) => {
    const cur = state.current;
    if (!cur) return;
    openFile(cur.file.id, { encoding: e.target.value, lang: cur.lang, mode: cur.mode });
  });

  // 点击行号：选中该行并写入地址栏（?L=12），Shift 点击选中一段（?L=12-20），再点一次取消
  $('#content').addEventListener('click', (e) => {
    const ln = e.target instanceof Element ? e.target.closest('.ln') : null;
    if (!ln) return;
    const n = Number(ln.dataset.n);
    const sel = state.selLines;
    if (e.shiftKey && sel) jumpToLine([sel[0], n], false);
    else if (sel && sel[0] === n && sel[1] === n) clearLines();
    else jumpToLine(n, false);
  });

  // 查找
  let findTimer = null;
  $('#find-input').addEventListener('input', () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(runFind, 150);
  });
  $('#find-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gotoMatch(state.find.index + (e.shiftKey ? -1 : 1)); }
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); $('#viewer').focus(); }
  });
  $('#find-prev').addEventListener('click', () => gotoMatch(state.find.index - 1));
  $('#find-next').addEventListener('click', () => gotoMatch(state.find.index + 1));
  $('#find-close').addEventListener('click', closeFind);
  $('#find-case').addEventListener('click', (e) => {
    state.find.caseSensitive = !state.find.caseSensitive;
    e.currentTarget.classList.toggle('on', state.find.caseSensitive);
    runFind();
  });
  $('#find-regex').addEventListener('click', (e) => {
    state.find.regex = !state.find.regex;
    e.currentTarget.classList.toggle('on', state.find.regex);
    runFind();
  });

  // 粘贴对话框
  $$('[data-paste]').forEach((b) => b.addEventListener('click', () => (b.dataset.paste === 'ok' ? confirmPaste() : closePaste())));
  $('#paste-mask').addEventListener('click', closePaste);
  $('#paste-dialog').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); confirmPaste(); }
    if (e.key === 'Escape') { e.preventDefault(); closePaste(); }
  });

  // 页面上直接粘贴：文件或文本
  document.addEventListener('paste', async (e) => {
    if (e.target instanceof Element && e.target.closest('input, textarea')) return;
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) {
      e.preventDefault();
      await afterAdd(await addFromFileList(files));
      return;
    }
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      e.preventDefault();
      const f = addText(text, '');
      await afterAdd([f]);
    }
  });

  // 拖放
  let depth = 0;
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); depth++; $('#drop-overlay').hidden = false; } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('#drop-overlay').hidden = true; });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $('#drop-overlay').hidden = true;
    await afterAdd(await addFromDataTransfer(e.dataTransfer));
  });

  // 快捷键
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select');
    if (mod && e.key.toLowerCase() === 'f' && canFind()) { e.preventDefault(); openFind(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); pickFiles(); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); $('#btn-toggle-side').click(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); changeFontSize(1); return; }
    if (mod && e.key === '-') { e.preventDefault(); changeFontSize(-1); return; }
    if (e.altKey && e.code === 'KeyZ') { e.preventDefault(); $('#btn-wrap').click(); return; }
    if (typing) return;
    if (e.key === 'Escape' && !$('#findbar').hidden) { closeFind(); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey) {
      // ⌥↑ / ⌥↓ 切换上一个 / 下一个文件
      e.preventDefault();
      const rows = $$('.tree-row.file');
      const i = rows.findIndex((r) => Number(r.dataset.id) === state.activeId);
      const next = rows[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, rows.length - 1)];
      if (next) openFile(Number(next.dataset.id));
    }
  });

  bindResizer();
}

/* ============================== 启动 ============================== */
function boot() {
  if (typeof hljs === 'undefined' || typeof marked === 'undefined' || typeof DOMPurify === 'undefined' || typeof JSZip === 'undefined') {
    toast('页面依赖加载失败，请刷新重试', 6000);
    return;
  }
  hljs.configure({ ignoreUnescapedHTML: true });
  buildLangSelect();
  applyTheme();
  applyFontSize();
  applySidebar();
  bindEvents();
  renderTree();
  window.addEventListener('popstate', applyRoute);
  // 先恢复路由（示例链接会自己加载示例），再在后台列出示例
  applyRoute().finally(preloadExamples);
}

boot();
