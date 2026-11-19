/**
 * 一览 — 在线预览代码、文档与各类文件。纯前端，文件只在本机浏览器中处理。
 * 入口：串起文件列表、侧边栏、各类视图、查找与路由。
 */
import { state, saveSettings, APP_NAME, EXAMPLES_ROOT, SIZES, PREVIEW_KINDS, MAX_TEXT, MAX_DOC } from './state.js';
import { $, $$, clamp, el, toast, formatSize, countLines, revokeViewUrls, idle } from './util.js';
import { LANGS, langById, detectLang, viewKind, baseName, DOC_KINDS, DOC_NAMES } from './languages.js';
import {
  getFile, findByPath, removeFiles, readBytes, looksBinary, decode,
  addFromFileList, addFromDataTransfer, addText, fetchExamples, pickFirst, isArchive, extractArchive, prefetchIdle,
} from './files.js';
import { initTree, renderTree, revealInTree, refreshTreeBadge, setActiveRow, visibleFileIds, GROUPS } from './tree.js';
import { autoDetect } from './detect.js';
import { renderCode } from './views/code.js';
import { renderImage, renderMarkdown, renderCsv, renderHtmlFrame, renderJsonTree } from './views/preview.js';
import { canFind, openFind, closeFind, runFind, findOpen, bindFind } from './find.js';
import { syncRoute, applyRoute } from './route.js';
import { loadHljs } from './libs.js';

let docMod = null;
const loadDocViewers = () => (docMod ||= import('./docviewers.js').catch((e) => { docMod = null; throw e; }));

/* ============================== Service Worker（静态资源持久缓存） ============================== */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* 注册失败不影响使用 */ });
}

/* ============================== 主题 / 字号 ============================== */
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const effectiveTheme = () => (state.settings.theme === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : state.settings.theme);

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
  state.docCtl?.theme?.(t === 'dark');
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  state.settings.theme = order[(order.indexOf(state.settings.theme) + 1) % order.length];
  saveSettings();
  applyTheme();
  toast($('#btn-theme').title);
}

const applyFontSize = () => document.documentElement.style.setProperty('--code-size', `${state.settings.size}px`);

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

/* ============================== 添加 / 移除 ============================== */
let examplesLoading = null;
async function loadExamples({ open = true } = {}) {
  if (!examplesLoading) {
    examplesLoading = fetchExamples().finally(() => { examplesLoading = null; });
    renderTree(); // 显示「正在加载示例…」
  }
  const added = await examplesLoading;
  prefetchIdle(added); // 空闲时后台预取小示例，点开即秒开
  // 示例目录默认折叠，只展开打开的 README 所在的那一层
  if (open && added.length) await afterAdd(added, { expand: false, quiet: true });
  else renderTree();
}

/** 启动时在后台列出示例（只取清单，不下载文件内容），示例分组默认收起 */
function preloadExamples() {
  if (state.files.some((f) => f.example)) return;
  state.closedGroups.add('example');
  loadExamples({ open: false });
}

async function afterAdd(added, { expand = true, quiet = false } = {}) {
  if (!added.length) return;
  if (expand) {
    for (const f of added) {
      const parts = f.path.split('/');
      // 默认只展开前两层，避免大目录一打开就铺满
      for (let i = 1, dir = parts[0]; i < parts.length; dir += `/${parts[i]}`, i++) {
        if (i <= 2 || added.length <= 30) state.openDirs.add(dir);
      }
    }
  }
  renderTree();
  // 一次添加多个文件时优先打开 README / index 等；只添加一个就打开它
  const first = added.length === 1 ? added[0] : pickFirst(added);
  if (first) await openFile(first.id);
  if (added.length > 1 && !quiet) toast(`已添加 ${added.length} 个文件`);
}

function afterRemove(activeRemoved, next) {
  if (activeRemoved) {
    state.openToken++; // 取消正在进行的打开
    if (next) openFile(next.id); else showWelcome();
  }
  renderTree();
}

function removeGroup(id) {
  const g = GROUPS.find((x) => x.id === id);
  const removed = removeFiles(g.match);
  if (!removed.length) return;
  const activeRemoved = removed.some((f) => f.id === state.activeId);
  afterRemove(activeRemoved, activeRemoved ? state.files.find((f) => !f.example) : null);
  toast(`已移除 ${removed.length} 个${id === 'example' ? '示例' : '文件'}`);
}

function removeFile(id) {
  const i = state.files.findIndex((f) => f.id === id);
  if (i < 0) return;
  removeFiles((f) => f.id === id);
  afterRemove(state.activeId === id, state.files[i] || state.files[i - 1]);
}

/* ============================== 打开文件 ============================== */
async function openFile(id, opts = {}) {
  const file = getFile(id);
  if (!file) return;
  const token = ++state.openToken;
  state.activeId = id;
  state.selLines = null;
  // 先更新标题与文件名：读字节、识别语言、加载渲染器期间切换看起来是即时的
  const name = baseName(file.path);
  document.title = `${name} — ${APP_NAME}`;
  $('#file-name').textContent = name;
  $('#file-name').title = file.path;
  $('#file-meta').textContent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
  revealInTree(file, { scroll: false });
  closeFind();

  let kind = viewKind(file.path);
  const cur = { file, kind, text: null, lang: null, encoding: opts.encoding || 'auto', mode: 'code', binary: false, tooBig: false, at: opts.at || null };

  // 同一扩展名、不同内容：.crt / .cer 可能是 PEM 文本，.key 可能是 PEM 私钥（而不是 Keynote）
  if ((kind === 'cert' || (kind === 'iwork' && /\.key$/i.test(file.path))) && file.size < MAX_TEXT) {
    try {
      const head = await readBytes(file);
      if (token !== state.openToken) return;
      if (!looksBinary(head) && /-----BEGIN /.test(decode(head.subarray(0, 4096), 'auto').text)) kind = cur.kind = 'pem';
    } catch { /* 读不了就按原类型处理，交给后面的渲染器报错 */ }
  }

  if (kind === 'image') {
    cur.mode = 'preview';
  } else if (DOC_KINDS.has(kind)) {
    cur.mode = 'preview';
    cur.doc = true;
    if (file.size > MAX_DOC) cur.tooBig = true;
  } else if (file.size > MAX_TEXT) {
    cur.tooBig = true;
  } else {
    try {
      const bytes = await readBytes(file);
      if (token !== state.openToken) return;
      if (looksBinary(bytes) && !opts.forceText) {
        cur.binary = true;
      } else {
        const d = decode(bytes, cur.encoding);
        cur.text = d.text;
        cur.detectedEncoding = d.encoding;
        cur.lang = opts.lang || file.lang || detectLang(file.path) || await autoDetect(cur.text);
        if (token !== state.openToken) return;
        file.lang = cur.lang; // 记住识别结果，树上的图标也随之更新
        if (file.pasted) refreshTreeBadge(file);
        cur.mode = PREVIEW_KINDS.includes(kind) ? 'preview' : 'code';
        // 超大 JSON 生成树会很慢，直接看源码
        if ((kind === 'json' || kind === 'notebook') && cur.text.length > 20 * 1024 * 1024) cur.mode = 'code';
        if (kind === 'json' && cur.text.length > 2 * 1024 * 1024) cur.mode = 'code';
        if (kind === 'email') cur.bytes = bytes; // 邮件按原始字节解析（各部分可能是不同编码）
      }
    } catch (err) {
      if (token !== state.openToken) return;
      console.warn('读取失败', err);
      cur.error = `无法读取这个文件：${err?.message || err}`;
    }
  }
  cur.defaultMode = cur.mode;
  if (opts.mode && (opts.mode === 'code' || (PREVIEW_KINDS.includes(kind) && cur.text !== null))) cur.mode = opts.mode;
  state.current = cur;
  await renderCurrent();
  if (token !== state.openToken) return;
  if (opts.line && cur.mode === 'code') jumpToLine(opts.line);
  syncRoute();
  // 新内容渲染完后再把侧边栏滚到当前文件（此时布局已经算好，不会额外卡顿）
  requestAnimationFrame(() => { if (state.activeId === id) revealInTree(file, { expand: false }); });
}

/* ============================== 工具栏 / 状态栏 ============================== */
function showWelcome() {
  renderSeq++;
  destroyDoc();
  revokeViewUrls();
  state.activeId = null;
  state.selLines = null;
  state.current = null;
  setActiveRow(null);
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

function syncToolbar() {
  const cur = state.current;
  const { file } = cur;
  $('#welcome').hidden = true;
  $('#content').hidden = false;
  $('#file-tools').hidden = false;
  $('#file-name').textContent = baseName(file.path);
  $('#file-name').title = file.path;
  $('#file-meta').textContent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
  document.title = `${baseName(file.path)} — ${APP_NAME}`;

  const isText = cur.text !== null;
  $('#mode-seg').hidden = !(PREVIEW_KINDS.includes(cur.kind) && isText);
  for (const b of $$('#mode-seg button')) b.classList.toggle('active', b.dataset.mode === cur.mode);
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
    cur.lines ??= countLines(cur.text);
    left.push(`${cur.lines.toLocaleString()} 行`, `${cur.text.length.toLocaleString()} 字符`);
    right.push(langById(cur.lang)?.name || cur.lang);
    right.push((cur.detectedEncoding || cur.encoding).toUpperCase());
    right.push(/\r\n/.test(cur.text.slice(0, 10000)) ? 'CRLF' : 'LF');
  } else if (cur.doc) {
    right.push(DOC_NAMES[cur.kind] || '');
  }
  left.push(formatSize(cur.file.size));
  if (cur.file.mtime) left.push(new Date(cur.file.mtime).toLocaleString('zh-CN', { hour12: false }));
  if (cur.statusText) left.push(cur.statusText);
  if (extra) left.push(extra);
  $('#st-left').textContent = left.join('  ·  ');
  $('#st-right').textContent = right.join('  ·  ');
}

/* ============================== 渲染 ============================== */
let renderSeq = 0; // 每次渲染自增：切换文件或视图时，过期的异步渲染结果直接丢弃

function message(content, text, button) {
  const box = el('div', 'binary');
  box.appendChild(el('div', null, text));
  if (button) {
    const btn = el('button', 'btn', button[0]);
    btn.type = 'button';
    btn.addEventListener('click', button[1]);
    box.appendChild(btn);
  }
  content.classList.remove('fill');
  content.replaceChildren(box);
}

async function renderCurrent() {
  const cur = state.current;
  if (!cur) return;
  const seq = ++renderSeq;
  const stale = () => seq !== renderSeq || state.current !== cur;
  destroyDoc();
  revokeViewUrls();
  syncToolbar();
  const content = $('#content');
  const viewer = $('#viewer');
  content.classList.remove('fill');
  viewer.scrollTop = 0;
  viewer.scrollLeft = 0;

  try {
    if (cur.error) {
      message(content, cur.error);
    } else if (cur.doc && !cur.tooBig) {
      await renderDocument(content, cur, stale);
      return;
    } else if (cur.kind === 'image') {
      const blob = await cur.file.getBlob();
      if (stale()) return;
      renderImage(content, blob, cur.file.path, (size) => { if (!stale()) updateStatus(size); });
    } else if (cur.tooBig) {
      message(content, `文件太大（${formatSize(cur.file.size)}），超过 ${formatSize(cur.doc ? MAX_DOC : MAX_TEXT)} 的文件不在页面里显示。`);
    } else if (cur.binary && isArchive(cur.file.path)) {
      message(content, '这是一个压缩包，解压后可以逐个浏览里面的文件（在浏览器里解压，不会上传）。', ['解压到「我的文件」', async () => {
        const added = await extractArchive(cur.file);
        if (added.length) await afterAdd(added);
      }]);
    } else if (cur.binary) {
      message(content, '这看起来是二进制文件，无法以文本显示。', ['仍然以文本打开', () => openFile(cur.file.id, { forceText: true })]);
    } else if (cur.mode === 'preview') {
      if (cur.kind === 'markdown') {
        await renderMarkdown(content, cur.text, {
          stale,
          resolve: resolveRelative,
          open: (f) => openFile(f.id),
        });
      } else if (cur.kind === 'csv' || cur.kind === 'tsv') renderCsv(content, cur.text, cur.kind === 'tsv' ? '\t' : null);
      else if (cur.kind === 'html' || cur.kind === 'svg') renderHtmlFrame(content, cur.text, cur.kind);
      else if (cur.kind === 'json') renderJsonTree(content, cur.text, () => setMode('code'));
      else {
        const sv = await import('./views/structured.js');
        if (stale()) return;
        const ctx = { stale, status: (t) => { if (!stale()) { cur.statusText = t; updateStatus(); } } };
        if (cur.kind === 'notebook') await sv.renderNotebook(content, cur.text, ctx);
        else if (cur.kind === 'email') await sv.renderEmail(content, cur.bytes, ctx);
        else if (cur.kind === 'calendar') sv.renderCalendar(content, cur.text, ctx);
        else if (cur.kind === 'contacts') sv.renderContacts(content, cur.text, ctx);
        else if (cur.kind === 'pem') await sv.renderPem(content, cur.text, ctx);
      }
    } else {
      await renderCode(content, cur, {
        wrap: state.settings.wrap,
        stale,
        onRepaint() {
          // 后台高亮完成、内容被替换：恢复选中行与查找结果
          if (state.selLines) markLines(state.selLines);
          if (findOpen() && state.find.query) runFind();
          updateStatus();
        },
      });
    }
  } catch (err) {
    if (stale()) return;
    console.warn('预览失败', err);
    message(content, `无法预览这个文件：${err?.message || err}`, ['下载文件', download]);
  }
  if (!stale()) updateStatus();
}

function destroyDoc() {
  const ctl = state.docCtl;
  state.docCtl = null;
  if (ctl?.destroy) { try { ctl.destroy(); } catch (err) { console.warn(err); } }
}

/** 文档（PDF / EPUB / Word / 表格 / 演示文稿 / 音视频 / 字体） */
async function renderDocument(content, cur, stale) {
  content.replaceChildren(el('div', 'doc-loading', '正在打开…'));
  content.classList.add('fill');
  updateStatus();
  try {
    const [mod, blob] = await Promise.all([loadDocViewers(), cur.file.getBlob()]);
    const bytes = mod.needsBytes(cur.kind) ? await readBytes(cur.file, blob) : null;
    if (stale()) return;
    const host = el('div', 'doc-host');
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
    if (stale()) { ctl.destroy?.(); return; }
    state.docCtl = ctl;
    syncToolbar();
  } catch (err) {
    if (stale()) return;
    console.warn('文档预览失败', err);
    message(content, `无法预览这个文件：${err?.message || err}`, ['下载文件', download]);
  }
}

function resolveRelative(rel) {
  const cur = state.current?.file;
  if (!cur) return null;
  const dir = cur.path.includes('/') ? cur.path.slice(0, cur.path.lastIndexOf('/')).split('/') : [];
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { return null; }
  for (const seg of decoded.split('/')) {
    if (seg === '..') dir.pop();
    else if (seg && seg !== '.') dir.push(seg);
  }
  return findByPath(dir.join('/'), !!cur.example);
}

function setMode(mode) {
  if (!state.current || state.current.mode === mode) return Promise.resolve();
  state.current.mode = mode;
  state.selLines = null;
  closeFind();
  return renderCurrent().then(() => syncRoute());
}

/* ============================== 行号 / 跳转 ============================== */
let markedRows = [];
function markLines(range) {
  for (const r of markedRows) r.classList.remove('hl-line');
  markedRows = [];
  if (!range) return;
  for (let i = range[0]; i <= range[1]; i++) {
    const r = document.getElementById(`L${i}`);
    if (r) { r.classList.add('hl-line'); markedRows.push(r); }
  }
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
  markLines(null);
  syncRoute();
}

/* ============================== 路由恢复 ============================== */
async function restoreRoute(r) {
  if (!r.path) {
    if (state.current) showWelcome();
    return;
  }
  // 地址以 `examples/` 开头的只在示例里找，其余只在用户文件里找（两组路径可能重名）
  const wantExample = r.path === EXAMPLES_ROOT || r.path.startsWith(`${EXAMPLES_ROOT}/`);
  const find = () => findByPath(r.path, wantExample)
    || pickFirst(state.files.filter((f) => !!f.example === wantExample && f.path.startsWith(`${r.path}/`)));
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

/* ============================== 操作 ============================== */
async function copyAll() {
  const text = state.current?.text;
  if (text == null) return;
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
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await file.getBlob());
    a.download = baseName(file.path);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch {
    toast('下载失败');
  }
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
  await afterAdd([addText(text, name)]);
}

function buildLangSelect() {
  const top = ['plaintext', 'log'];
  const sorted = [...LANGS].sort((a, b) => {
    if (top.includes(a.id) !== top.includes(b.id)) return top.includes(a.id) ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  const sel = $('#lang-select');
  for (const l of sorted) sel.appendChild(new Option(l.name, l.id));
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
    let frame = 0;
    const move = (ev) => {
      state.settings.sideW = clamp(startW + ev.clientX - startX, 180, Math.min(600, innerWidth * 0.6));
      // 每帧最多更新一次布局
      frame ||= requestAnimationFrame(() => { frame = 0; applySidebar(); });
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
  $('#btn-clear').addEventListener('click', () => removeGroup('mine'));
  // 左上角品牌：回到首页（保留已打开的文件列表）
  for (const a of $$('[data-home]')) {
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      if (state.current) showWelcome();
    });
  }
  for (const b of $$('[data-trigger]')) {
    b.addEventListener('click', () => {
      const t = b.dataset.trigger;
      if (t === 'open') pickFiles();
      else if (t === 'open-dir') pickDir();
      else if (t === 'examples') loadExamples();
      else openPaste();
    });
  }
  for (const input of [fileInput, dirInput]) {
    input.addEventListener('change', async () => {
      if (input.files?.length) await afterAdd(await addFromFileList(input.files));
      input.value = '';
    });
  }

  initTree({
    open: (id) => openFile(id),
    remove: removeFile,
    removeGroup,
    loadExamples: () => loadExamples({ open: false }),
    pick: pickFiles,
    paste: () => openPaste(),
  }, () => !!examplesLoading);

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
    $('#content .code')?.classList.toggle('wrap', state.settings.wrap);
  });
  $('#btn-copy').addEventListener('click', copyAll);
  $('#btn-download').addEventListener('click', download);
  for (const b of $$('#mode-seg button')) b.addEventListener('click', () => setMode(b.dataset.mode));
  bindFind(setMode);

  $('#lang-select').addEventListener('change', (e) => {
    const cur = state.current;
    if (!cur) return;
    cur.lang = e.target.value;
    cur.file.lang = e.target.value;
    refreshTreeBadge(cur.file);
    closeFind();
    renderCurrent();
  });
  $('#enc-select').addEventListener('change', (e) => {
    const cur = state.current;
    if (cur) openFile(cur.file.id, { encoding: e.target.value, lang: cur.lang, mode: cur.mode });
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

  // 粘贴对话框
  for (const b of $$('[data-paste]')) b.addEventListener('click', () => (b.dataset.paste === 'ok' ? confirmPaste() : closePaste()));
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
      await afterAdd([addText(text, '')]);
    }
  });

  // 拖放
  let depth = 0;
  const overlay = $('#drop-overlay');
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); depth++; overlay.hidden = false; } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    await afterAdd(await addFromDataTransfer(e.dataTransfer));
  });

  // 快捷键
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select');
    if (mod && key === 'f' && canFind()) { e.preventDefault(); openFind(setMode); return; }
    if (mod && key === 'o') { e.preventDefault(); pickFiles(); return; }
    if (mod && key === 'b') { e.preventDefault(); $('#btn-toggle-side').click(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); changeFontSize(1); return; }
    if (mod && e.key === '-') { e.preventDefault(); changeFontSize(-1); return; }
    if (e.altKey && e.code === 'KeyZ') { e.preventDefault(); $('#btn-wrap').click(); return; }
    if (typing) return;
    if (e.key === 'Escape' && findOpen()) { closeFind(); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey) {
      // ⌥↑ / ⌥↓ 切换上一个 / 下一个文件
      e.preventDefault();
      const ids = visibleFileIds();
      const next = ids[clamp(ids.indexOf(state.activeId) + (e.key === 'ArrowDown' ? 1 : -1), 0, ids.length - 1)];
      if (next) openFile(next);
    }
  });

  bindResizer();
  window.addEventListener('popstate', () => applyRoute(restoreRoute));
}

/* ============================== 启动 ============================== */
function boot() {
  buildLangSelect();
  applyTheme();
  applyFontSize();
  applySidebar();
  bindEvents();
  renderTree();
  // 先恢复路由（示例链接会自己加载示例），再在后台列出示例
  applyRoute(restoreRoute).finally(preloadExamples);
  // 空闲时预热语法高亮库，第一次打开代码文件时无需等待
  idle(() => loadHljs().catch(() => {}));
}

boot();
