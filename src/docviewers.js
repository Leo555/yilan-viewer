/**
 * 文档类预览：PDF / EPUB / Word / 表格 / 演示文稿 / 音视频 / 字体。
 * 依赖库都在 vendor/ 下，打开对应类型的文件时才按需加载。
 *
 * 每个渲染器签名：(host, src, ctx) => Promise<Controller>
 *   host  渲染容器（每次打开新建，切换文件后会被移出文档，渲染器不需要关心）
 *   src   { bytes: Uint8Array, blob: Blob, name }
 *   ctx   { at, dark, onPosition(at), status(text) }
 * Controller（全部可选）：
 *   destroy()                       释放资源
 *   zoom(dir)                       A− / A+
 *   theme(dark)                     主题切换
 *   goto(at)                        跳转到路由中记录的位置
 *   find(query, opts, onCount)      文档自带的查找（PDF）
 *   findAgain(previous) / findClose()
 *   searchable                      true 表示内容是普通 DOM，可直接用页面查找
 */
import { el, loadScript, loadCss } from './util.js';
import { loadPurify, loadJSZip } from './libs.js';

const V = './vendor';
const abs = (p) => new URL(p, location.href).href;

const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

/* ============================== PDF ============================== */
let pdfMods = null;
function loadPdfjs() {
  pdfMods ||= (async () => {
    loadCss(`${V}/pdfjs/pdf_viewer.css`); // 与脚本并行下载
    const lib = await import('../vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = abs(`${V}/pdfjs/pdf.worker.min.mjs`);
    const viewer = await import('../vendor/pdfjs/pdf_viewer.mjs'); // 依赖 pdf.min.mjs 设置的 globalThis.pdfjsLib
    return { lib, viewer };
  })().catch((err) => { pdfMods = null; throw err; });
  return pdfMods;
}

async function renderPdf(host, src, ctx) {
  const { lib, viewer: pv } = await loadPdfjs();
  const container = el('div', 'pdf-container');
  container.tabIndex = 0;
  const inner = el('div', 'pdfViewer');
  container.appendChild(inner);
  host.replaceChildren(container);

  const eventBus = new pv.EventBus();
  const linkService = new pv.PDFLinkService({
    eventBus,
    externalLinkTarget: pv.LinkTarget.BLANK,
    externalLinkRel: 'noopener noreferrer nofollow',
  });
  const findController = new pv.PDFFindController({ eventBus, linkService });
  const viewer = new pv.PDFViewer({
    container,
    viewer: inner,
    eventBus,
    linkService,
    findController,
    annotationMode: lib.AnnotationMode.ENABLE, // 显示批注和链接，不启用表单编辑
    imageResourcesPath: `${V}/pdfjs/images/`,
  });
  linkService.setViewer(viewer);

  const task = lib.getDocument({
    data: src.bytes.slice(), // pdf.js 会把数据转移给 worker，传副本以免缓存失效
    cMapUrl: abs(`${V}/pdfjs/cmaps/`),
    cMapPacked: true,
    standardFontDataUrl: abs(`${V}/pdfjs/standard_fonts/`),
    wasmUrl: abs(`${V}/pdfjs/wasm/`),
    iccUrl: abs(`${V}/pdfjs/iccs/`),
    isEvalSupported: false,
    enableXfa: false,
  });
  task.onPassword = (update, reason) => {
    const again = reason === lib.PasswordResponses.INCORRECT_PASSWORD;
    // eslint-disable-next-line no-alert
    const pw = prompt(again ? '密码不正确，请重新输入：' : `「${src.name}」受密码保护，请输入密码：`);
    if (pw == null) task.destroy(); else update(pw);
  };

  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error('没有输入密码，无法打开');
    throw err;
  }
  const total = doc.numPages;
  const report = () => {
    ctx.status(`第 ${viewer.currentPageNumber} / ${total} 页  ·  ${Math.round(viewer.currentScale * 100)}%`);
  };

  eventBus.on('pagesinit', () => {
    viewer.currentScaleValue = 'auto';
    const page = Number(ctx.at);
    if (page > 1 && page <= total) viewer.currentPageNumber = page;
    report();
  });
  eventBus.on('pagechanging', ({ pageNumber }) => {
    report();
    ctx.onPosition(pageNumber > 1 ? String(pageNumber) : null);
  });
  eventBus.on('scalechanging', report);

  viewer.setDocument(doc);
  linkService.setDocument(doc);

  // 容器尺寸变化（拖动侧边栏、窗口缩放）时保持自适应缩放
  const ro = new ResizeObserver(() => {
    if (['auto', 'page-width', 'page-fit'].includes(viewer.currentScaleValue)) viewer.currentScaleValue = viewer.currentScaleValue;
  });
  ro.observe(container);
  container.focus({ preventScroll: true });

  let onCount = null;
  let pending = false;
  eventBus.on('updatefindmatchescount', ({ matchesCount }) => {
    if (matchesCount.total || !pending) onCount?.(matchesCount.current, matchesCount.total);
  });
  eventBus.on('updatefindcontrolstate', ({ state, matchesCount }) => {
    pending = state === pv.FindState.PENDING;
    if (pending) return;
    if (state === pv.FindState.NOT_FOUND) onCount?.(0, 0);
    else if (matchesCount) onCount?.(matchesCount.current, matchesCount.total);
  });
  let last = null;
  const dispatchFind = (type, findPrevious = false) => {
    if (!last) return;
    eventBus.dispatch('find', {
      source: null, type, query: last.query, caseSensitive: last.caseSensitive,
      entireWord: false, highlightAll: true, findPrevious, matchDiacritics: false,
    });
  };

  return {
    destroy() {
      ro.disconnect();
      task.destroy();
    },
    zoom(dir) {
      if (dir > 0) viewer.increaseScale(); else viewer.decreaseScale();
    },
    goto(at) {
      const n = Number(at) || 1;
      if (n >= 1 && n <= total && n !== viewer.currentPageNumber) viewer.currentPageNumber = n;
    },
    find(query, { caseSensitive }, cb) {
      onCount = cb;
      last = { query, caseSensitive };
      if (!query) { eventBus.dispatch('findbarclose', { source: null }); cb(0, 0, true); return; }
      pending = true;
      dispatchFind('');
    },
    findAgain(previous) { dispatchFind('again', previous); },
    findClose() { last = null; eventBus.dispatch('findbarclose', { source: null }); },
  };
}

/* ============================== EPUB ============================== */
const EPUB_THEMES = {
  light: { body: { color: '#1f2328 !important', background: 'transparent !important' }, a: { color: '#0969da !important' } },
  dark: { body: { color: '#d7dde3 !important', background: 'transparent !important' }, a: { color: '#58a6ff !important' } },
};

async function renderEpub(host, src, ctx) {
  await loadJSZip(); // epub.js 依赖全局 JSZip
  await loadScript(`${V}/epubjs/epub.min.js`, 'ePub');
  const wrap = el('div', 'epub');
  const bar = el('div', 'epub-bar');
  const toc = el('select', 'select epub-toc');
  toc.title = '目录';
  const label = el('span', 'epub-label');
  bar.append(toc, label);
  const stage = el('div', 'epub-stage');
  const prev = el('button', 'epub-nav prev', '‹');
  const next = el('button', 'epub-nav next', '›');
  prev.type = next.type = 'button';
  prev.title = '上一页（←）';
  next.title = '下一页（→）';
  const body = el('div', 'epub-body');
  body.append(prev, stage, next);
  wrap.append(bar, body);
  wrap.tabIndex = 0;
  host.replaceChildren(wrap);

  const book = globalThis.ePub(toArrayBuffer(src.bytes));
  await book.ready;
  await new Promise((r) => requestAnimationFrame(() => r()));
  const rendition = book.renderTo(stage, {
    width: stage.clientWidth,
    height: stage.clientHeight,
    flow: 'paginated',
    spread: 'auto',
    minSpreadWidth: 900,
    allowScriptedContent: false,
  });
  rendition.themes.register('light', EPUB_THEMES.light);
  rendition.themes.register('dark', EPUB_THEMES.dark);
  rendition.themes.select(ctx.dark ? 'dark' : 'light');
  let fontPct = 100;

  const nav = await book.loaded.navigation;
  const items = [];
  const walk = (list, depth) => {
    for (const it of list) {
      items.push({ href: it.href, label: `${'　'.repeat(depth)}${(it.label || '').trim() || '（无标题）'}` });
      if (it.subitems?.length) walk(it.subitems, depth + 1);
    }
  };
  walk(nav.toc || [], 0);
  toc.hidden = !items.length;
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.href;
    o.textContent = it.label;
    toc.appendChild(o);
  }
  toc.addEventListener('change', () => rendition.display(toc.value));
  const title = (await book.loaded.metadata)?.title;

  const hrefBase = (h) => (h || '').split('#')[0];
  rendition.on('relocated', (loc) => {
    const { start } = loc;
    const cur = items.findLast?.((it) => hrefBase(it.href) === hrefBase(start.href)) || items.find((it) => hrefBase(it.href) === hrefBase(start.href));
    if (cur) toc.value = cur.href;
    const page = start.displayed ? `本章 ${start.displayed.page} / ${start.displayed.total} 页` : '';
    label.textContent = page;
    ctx.status([title, page].filter(Boolean).join('  ·  '));
    ctx.onPosition(loc.atStart ? null : start.cfi);
    prev.disabled = !!loc.atStart;
    next.disabled = !!loc.atEnd;
  });

  const onKey = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault?.(); rendition.prev(); }
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault?.(); rendition.next(); }
  };
  wrap.addEventListener('keydown', onKey);
  rendition.on('keydown', onKey);
  prev.addEventListener('click', () => rendition.prev());
  next.addEventListener('click', () => rendition.next());

  try {
    await rendition.display(ctx.at || undefined);
  } catch {
    await rendition.display();
  }
  const ro = new ResizeObserver(() => {
    if (stage.clientWidth && stage.clientHeight) rendition.resize(stage.clientWidth, stage.clientHeight);
  });
  ro.observe(stage);
  wrap.focus({ preventScroll: true });

  return {
    destroy() {
      ro.disconnect();
      try { rendition.destroy(); book.destroy(); } catch { /* ignore */ }
    },
    zoom(dir) {
      fontPct = Math.min(200, Math.max(60, fontPct + dir * 10));
      rendition.themes.fontSize(`${fontPct}%`);
    },
    theme(dark) { rendition.themes.select(dark ? 'dark' : 'light'); },
    goto(at) { if (at) rendition.display(at).catch(() => {}); },
  };
}

/* ============================== Word ============================== */
async function renderDocx(host, src) {
  const [, DOMPurify] = await Promise.all([loadScript(`${V}/mammoth/mammoth.browser.min.js`, 'mammoth'), loadPurify()]);
  const result = await globalThis.mammoth.convertToHtml({ arrayBuffer: toArrayBuffer(src.bytes) });
  const clean = DOMPurify.sanitize(result.value, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  });
  const page = el('article', 'md doc-page');
  page.innerHTML = clean || '<p class="doc-empty">（文档没有可显示的内容）</p>';
  page.querySelectorAll('a[href]').forEach((a) => {
    if (/^https?:/i.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  });
  const paper = el('div', 'doc-paper');
  paper.appendChild(page);
  host.replaceChildren(paper);
  return { searchable: true };
}

/* ============================== 表格 ============================== */
const MAX_SHEET_ROWS = 5000;
const MAX_SHEET_COLS = 200;
const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

async function renderSheet(host, src, ctx) {
  await loadScript(`${V}/xlsx/xlsx.full.min.js`, 'XLSX');
  const X = globalThis.XLSX;
  const wb = X.read(src.bytes, { type: 'array', cellDates: true, dense: true });
  const names = wb.SheetNames;
  const wrap = el('div', 'sheet');
  const body = el('div', 'sheet-body');
  const tabs = el('div', 'sheet-tabs');
  wrap.append(body, tabs);
  host.replaceChildren(wrap);

  const show = (i) => {
    const ws = wb.Sheets[names[i]];
    const rows = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
    const cols = Math.min(MAX_SHEET_COLS, rows.reduce((m, r) => Math.max(m, r.length), 0));
    const table = el('table', 'csv sheet-table');
    const thead = table.createTHead().insertRow();
    thead.appendChild(el('th', 'rn'));
    for (let c = 0; c < cols; c++) thead.appendChild(el('th', null, colName(c)));
    const tb = table.createTBody();
    const n = Math.min(rows.length, MAX_SHEET_ROWS);
    for (let r = 0; r < n; r++) {
      const tr = tb.insertRow();
      tr.appendChild(el('td', 'rn', String(r + 1)));
      for (let c = 0; c < cols; c++) {
        const v = rows[r][c] ?? '';
        const td = el('td', /^-?[\d,.]+%?$/.test(v) ? 'num' : null, v);
        if (v.length > 40) td.title = v;
        tr.appendChild(td);
      }
    }
    const box = el('div', 'csv-wrap');
    if (!rows.length) box.appendChild(el('div', 'doc-empty', '（空工作表）'));
    else box.appendChild(table);
    if (rows.length > MAX_SHEET_ROWS) box.prepend(el('div', 'notice', `只显示前 ${MAX_SHEET_ROWS.toLocaleString()} 行（共 ${rows.length.toLocaleString()} 行）`));
    body.replaceChildren(box);
    body.scrollTop = 0;
    tabs.querySelectorAll('button').forEach((b, j) => b.classList.toggle('active', j === i));
    ctx.status(`工作表 ${i + 1} / ${names.length}  ·  ${rows.length.toLocaleString()} 行 × ${cols} 列`);
    current = i;
  };
  let current = 0;
  names.forEach((name, i) => {
    const b = el('button', 'sheet-tab', name);
    b.type = 'button';
    b.addEventListener('click', () => { show(i); ctx.onPosition(i ? String(i + 1) : null); });
    tabs.appendChild(b);
  });
  const initial = Number(ctx.at) - 1;
  show(initial > 0 && initial < names.length ? initial : 0);
  return {
    searchable: true,
    goto(at) {
      const i = (Number(at) || 1) - 1;
      if (i >= 0 && i < names.length && i !== current) show(i);
    },
  };
}

/* ============================== 演示文稿 ============================== */
async function renderPptx(host, src, ctx) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(src.bytes);
  const slideNo = (p) => Number(/slide(\d+)\.xml$/.exec(p)?.[1] || 0);
  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => slideNo(a) - slideNo(b));
  const parser = new DOMParser();
  const urls = [];
  const imgCache = new Map(); // 多页共用的图片（如 logo）只解压一次
  const imageUrl = (target) => {
    if (!imgCache.has(target)) {
      const type = /\.svg$/i.test(target) ? 'image/svg+xml' : '';
      imgCache.set(target, zip.file(target).async('uint8array').then((data) => {
        const url = URL.createObjectURL(new Blob([data], type ? { type } : {}));
        urls.push(url);
        return url;
      }));
    }
    return imgCache.get(target);
  };
  // 各页并行解析，按页序拼装
  const cards = await Promise.all(slides.map(async (path, i) => {
    const rels = zip.file(`${path.replace('slides/', 'slides/_rels/')}.rels`);
    const [xmlText, relText] = await Promise.all([zip.file(path).async('string'), rels?.async('string')]);
    const xml = parser.parseFromString(xmlText, 'application/xml');
    const card = el('section', 'slide');
    card.appendChild(el('div', 'slide-no', String(i + 1)));
    const paras = [...xml.getElementsByTagNameNS('*', 'p')]
      .map((p) => [...p.getElementsByTagNameNS('*', 't')].map((t) => t.textContent).join(''))
      .filter((t) => t.trim());
    paras.forEach((t, j) => card.appendChild(el(j === 0 ? 'h3' : 'p', null, t)));
    // 幻灯片里的图片
    let imgs = 0;
    if (relText) {
      const rx = parser.parseFromString(relText, 'application/xml');
      const targets = [...rx.getElementsByTagNameNS('*', 'Relationship')]
        .filter((r) => /\/image$/.test(r.getAttribute('Type') || ''))
        .map((r) => new URL(r.getAttribute('Target') || '', 'http://x/ppt/slides/').pathname.slice(1))
        .filter((t) => zip.file(t) && /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(t));
      for (const url of await Promise.all(targets.map(imageUrl))) {
        const img = el('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = url;
        img.alt = '';
        card.appendChild(img);
        imgs++;
      }
    }
    if (!paras.length && !imgs) card.appendChild(el('p', 'doc-empty', '（这一页没有文字）'));
    return card;
  }));
  const list = el('div', 'slides');
  list.append(...cards);
  if (!slides.length) list.appendChild(el('div', 'doc-empty', '没有找到幻灯片内容'));
  const box = el('div', 'slides-wrap');
  box.append(el('div', 'notice', '演示文稿以提纲方式预览：显示每页的文字和图片，不还原版式与动画。'), list);
  host.replaceChildren(box);
  ctx.status(`${slides.length} 页幻灯片`);
  return { searchable: true, destroy() { urls.forEach((u) => URL.revokeObjectURL(u)); } };
}

/* ============================== 音视频 ============================== */
/** 按扩展名补上 MIME：本地拖入的文件、服务器返回 octet-stream 时，浏览器需要它来选解码器 */
const MEDIA_MIME = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg; codecs=opus',
  m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', weba: 'audio/webm',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', mkv: 'video/x-matroska',
};

async function renderMedia(host, src, ctx, kind) {
  const ext = (src.name.split('.').pop() || '').toLowerCase();
  const type = MEDIA_MIME[ext];
  const blob = type && src.blob.type !== type ? new Blob([src.blob], { type }) : src.blob;
  const url = URL.createObjectURL(blob);
  const media = el(kind);
  media.controls = true;
  media.preload = 'metadata';
  media.src = url;
  media.addEventListener('loadedmetadata', () => {
    const d = media.duration;
    const t = Number.isFinite(d) ? `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}` : '';
    const size = kind === 'video' && media.videoWidth ? `${media.videoWidth} × ${media.videoHeight}` : '';
    ctx.status([t && `时长 ${t}`, size].filter(Boolean).join('  ·  '));
  });
  const box = el('div', `media media-${kind}`);
  media.addEventListener('error', () => {
    const msg = `当前浏览器不支持播放这个${kind === 'audio' ? '音频' : '视频'}（${ext.toUpperCase()}），可以下载后用本地播放器打开。`;
    ctx.status('无法播放');
    box.replaceChildren(el('div', 'doc-empty', msg));
  });
  if (kind === 'audio') box.appendChild(el('div', 'media-name', src.name));
  box.appendChild(media);
  host.replaceChildren(box);
  return { destroy() { media.pause(); media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); } };
}

/* ============================== 字体 ==============================
 * 支持的格式：
 *   TTF / OTF（含 TrueType 集合 .ttc / OpenType 集合 .otc）—— 浏览器直接加载
 *   WOFF —— 每张表单独 zlib 压缩，用 DecompressionStream 解开后再读信息
 *   WOFF2 —— 浏览器能加载显示，但 Brotli + 表变换没有原生解码接口，读不到名称与字符表
 *   EOT —— 老 IE 的封装格式，尾部内嵌一份 TTF/OTF，取出后即可加载
 *   字体集合（ttcf）浏览器不支持，只提示、不渲染
 */
async function woffToSfnt(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flavor = v.getUint32(4);
  const num = v.getUint16(12);
  const entries = [];
  for (let i = 0; i < num; i++) {
    const p = 44 + i * 20;
    entries.push({ tag: v.getUint32(p), off: v.getUint32(p + 4), comp: v.getUint32(p + 8), orig: v.getUint32(p + 12), sum: v.getUint32(p + 16) });
  }
  const datas = await Promise.all(entries.map(async (e) => {
    const raw = bytes.subarray(e.off, e.off + e.comp);
    if (e.comp === e.orig) return raw;
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }));
  const head = 12 + num * 16;
  const total = datas.reduce((s, d) => s + ((d.length + 3) & ~3), head);
  const out = new Uint8Array(total);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, flavor);
  ov.setUint16(4, num);
  let pos = head;
  entries.forEach((e, i) => {
    const p = 12 + i * 16;
    ov.setUint32(p, e.tag);
    ov.setUint32(p + 4, e.sum);
    ov.setUint32(p + 8, pos);
    ov.setUint32(p + 12, datas[i].length);
    out.set(datas[i], pos);
    pos += (datas[i].length + 3) & ~3;
  });
  return out;
}

/** EOT（Embedded OpenType）：头部是小端，记录总长与字体数据长度，数据在文件尾部 */
function eotToSfnt(bytes) {
  if (bytes.length < 16) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = v.getUint32(0, true);
  const fontSize = v.getUint32(4, true);
  const version = v.getUint32(8, true);
  if (!total || !fontSize || total > bytes.length) return null;
  // 版本 0x00020002 是 MicroType Express 压缩，浏览器和这里都解不了
  if (version === 0x00020002) return null;
  const data = bytes.subarray(total - fontSize, total);
  return isSfnt(data) ? data : null;
}

const SFNT_TAGS = ['OTTO', 'true', '\0\u0001\0\0'];
const isSfnt = (b) => b.length >= 12 && SFNT_TAGS.includes(String.fromCharCode(...b.subarray(0, 4)));

/**
 * 读取 TTF / OTF 的基本信息（name / maxp / cmap / fvar / CFF 表）。WOFF 先解压、EOT 先取出内嵌数据。
 * WOFF2 与字体集合读不到，只显示格式。
 */
function readFontInfo(bytes, format) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  const kind = { OTTO: 'OpenType（CFF）', true: 'TrueType', '\0\u0001\0\0': 'TrueType', wOFF: 'WOFF', wOF2: 'WOFF2', ttcf: '字体集合（TTC / OTC）' }[tag];
  const info = { format: format || kind || '未知', names: {}, glyphs: 0, chars: [], axes: [], unitsPerEm: 0, cff: false };
  if (!['OTTO', 'true', '\0\u0001\0\0'].includes(tag) || bytes.length < 12) return info;
  const tables = {};
  const n = v.getUint16(4);
  for (let i = 0; i < n && 12 + i * 16 + 16 <= bytes.length; i++) {
    const p = 12 + i * 16;
    tables[String.fromCharCode(...bytes.subarray(p, p + 4))] = { off: v.getUint32(p + 8), len: v.getUint32(p + 12) };
  }
  try {
    if (tables.maxp) info.glyphs = v.getUint16(tables.maxp.off + 4);
    if (tables.head) info.unitsPerEm = v.getUint16(tables.head.off + 18);
    info.cff = !!(tables['CFF '] || tables.CFF2);
    if (tables.fvar) {
      const base = tables.fvar.off;
      const count = v.getUint16(base + 8);
      const size = v.getUint16(base + 10);
      for (let i = 0; i < count; i++) {
        const p = base + 16 + i * size;
        info.axes.push({
          tag: String.fromCharCode(...bytes.subarray(p, p + 4)),
          min: v.getInt32(p + 4) / 65536,
          def: v.getInt32(p + 8) / 65536,
          max: v.getInt32(p + 12) / 65536,
        });
      }
    }
    if (tables.name) {
      const base = tables.name.off;
      const count = v.getUint16(base + 2);
      const strings = base + v.getUint16(base + 4);
      const want = { 1: 'family', 2: 'style', 4: 'full', 5: 'version', 0: 'copyright', 13: 'license', 16: 'family', 17: 'style' };
      for (let i = 0; i < count; i++) {
        const r = base + 6 + i * 12;
        const [pid, eid, lang, nid, len, off] = [v.getUint16(r), v.getUint16(r + 2), v.getUint16(r + 4), v.getUint16(r + 6), v.getUint16(r + 8), v.getUint16(r + 10)];
        const key = want[nid];
        if (!key || !(pid === 3 && (eid === 1 || eid === 10)) && pid !== 0) continue;
        const raw = bytes.subarray(strings + off, strings + off + len);
        const text = new TextDecoder('utf-16be').decode(raw).trim();
        // 优先简体中文（0x0804），其次英文；16/17 号（排版用的家族名）覆盖 1/2 号
        const zh = lang === 0x0804;
        const prev = info.names[key];
        if (!prev || zh || (nid >= 16 && !prev.zh)) info.names[key] = { text, zh };
      }
      for (const k of Object.keys(info.names)) info.names[k] = info.names[k].text;
    }
    if (tables.cmap) info.chars = readCmap(v, tables.cmap.off);
  } catch { /* 表结构异常时只展示能读到的部分 */ }
  return info;
}

/** 从 cmap 表（format 4 / 12）取出所有字符码位 */
function readCmap(v, base) {
  const num = v.getUint16(base + 2);
  let best = null;
  for (let i = 0; i < num; i++) {
    const pid = v.getUint16(base + 4 + i * 8);
    const eid = v.getUint16(base + 6 + i * 8);
    const off = base + v.getUint32(base + 8 + i * 8);
    const fmt = v.getUint16(off);
    if (fmt === 12 && (pid === 3 && eid === 10 || pid === 0)) { best = [fmt, off]; break; }
    if (fmt === 4 && !best) best = [fmt, off];
  }
  const out = [];
  if (!best) return out;
  const [fmt, off] = best;
  const LIMIT = 30000;
  if (fmt === 4) {
    const segX2 = v.getUint16(off + 6);
    for (let s = 0; s < segX2 / 2; s++) {
      const end = v.getUint16(off + 14 + s * 2);
      const start = v.getUint16(off + 16 + segX2 + s * 2);
      for (let c = start; c <= end && c !== 0xffff && out.length < LIMIT; c++) out.push(c);
    }
  } else {
    const groups = v.getUint32(off + 12);
    for (let g = 0; g < groups; g++) {
      const start = v.getUint32(off + 16 + g * 12);
      const end = v.getUint32(off + 20 + g * 12);
      for (let c = start; c <= end && out.length < LIMIT; c++) out.push(c);
    }
  }
  return out;
}

let fontSeq = 0;

/** 按格式得到可直接交给 FontFace 的 SFNT 数据；无法转换时返回 null */
async function fontSfnt(bytes, magic, isEot) {
  if (isSfnt(bytes)) return bytes;
  if (magic === 'wOFF') {
    try { return await woffToSfnt(bytes); } catch { return null; }
  }
  if (isEot) return eotToSfnt(bytes);
  return null; // WOFF2 交给浏览器，字体集合不支持
}

const AXIS_NAMES = {
  wght: '字重', wdth: '字宽', ital: '斜体', slnt: '倾斜', opsz: '光学尺寸',
  GRAD: '灰度', XOPQ: 'x 不透明度', YOPQ: 'y 不透明度', XTRA: 'x 透明度', YTRA: 'y 透明度',
  YTAS: '上标', YTDE: '下标', YTLC: '小写高度', YTUC: '大写高度', YTFI: '图形',
  CASL: '随意度', CRSV: '连笔', MONO: '等宽', SOFT: '柔和度', WONK: '古怪',
  BNCE: '弹跳', INFR: '上下伸展', SPAC: '字距', EDPT: '扩展深度',
};

async function renderFont(host, src, ctx) {
  const family = `preview-font-${++fontSeq}`;
  const bytes = src.bytes;
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  const isCollection = magic === 'ttcf';
  const isWoff2 = magic === 'wOF2';
  const isEot = !isSfnt(bytes) && !isCollection && !isWoff2 && /\.eot$/i.test(src.name);
  const sfnt = await fontSfnt(bytes, magic, isEot);

  // 浏览器加载：WOFF2 直接用原始数据；EOT 需要先取出内嵌字体；字体集合无法加载
  let face = null;
  if (!isCollection && (isWoff2 || sfnt)) {
    try {
      face = new FontFace(family, toArrayBuffer(sfnt || bytes));
      await face.load();
      document.fonts.add(face);
    } catch (err) {
      console.warn('字体加载失败', err);
      face = null;
    }
  }

  let info = sfnt ? readFontInfo(sfnt) : readFontInfo(bytes);
  if (sfnt && magic === 'wOFF') info.format = 'WOFF';
  if (sfnt && isEot) info.format = 'EOT（内嵌 TTF / OTF）';
  if (isWoff2) info.format = 'WOFF2';
  if (isCollection) info.format = '字体集合（TTC / OTC）';

  const box = el('div', 'font-preview');
  const useFont = face ? `"${family}", var(--ui)` : 'var(--ui)';

  // 头部：字体名、格式、字形数
  const head = el('div', 'font-head');
  const title = el('div', 'font-title', info.names.full || info.names.family || src.name);
  title.style.fontFamily = useFont;
  head.appendChild(title);
  const meta = [
    info.names.family && info.names.style ? `${info.names.family} · ${info.names.style}` : '',
    info.format,
    info.glyphs ? (info.cff ? 'CFF 轮廓' : 'TrueType 轮廓') : '',
    info.axes.length ? '可变字体' : '',
    info.glyphs ? `${info.glyphs.toLocaleString()} 个字形` : '',
    info.chars.length ? `${info.chars.length.toLocaleString()} 个字符` : '',
    info.unitsPerEm ? `${info.unitsPerEm} units/em` : '',
    info.names.version || '',
  ].filter(Boolean);
  head.appendChild(el('div', 'font-meta', meta.join('  ·  ')));
  if (info.names.copyright) head.appendChild(el('div', 'font-copy', info.names.copyright));
  if (!face) {
    head.appendChild(el('div', 'font-copy', isCollection
      ? 'TTC / OTC 是多个字体的集合，浏览器不支持直接加载，只能显示文件信息。用 fontTools 之类的工具可以拆出单个字体。'
      : '这个文件浏览器无法加载，只能显示文件信息。'));
  }
  box.appendChild(head);

  // 可变字体：每个轴一个滑块，拖动时改写 --fv（字体元素用 font-variation-settings: var(--fv)）
  if (info.axes.length && face) {
    const wrap = el('div', 'font-axes');
    const sync = () => {
      const parts = [...wrap.querySelectorAll('input')]
        .filter((i) => Number(i.value) !== Number(i.dataset.def))
        .map((i) => `"${i.dataset.tag}" ${Number(i.value).toFixed(1)}`);
      box.style.setProperty('--fv', parts.join(', ') || 'normal');
    };
    for (const ax of info.axes) {
      if (ax.max === ax.min) continue;
      const row = el('label', 'font-axis');
      row.appendChild(el('span', 'font-axis-name', AXIS_NAMES[ax.tag] ? `${AXIS_NAMES[ax.tag]} ${ax.tag}` : ax.tag));
      const input = document.createElement('input');
      input.type = 'range';
      Object.assign(input, { min: ax.min, max: ax.max, step: (ax.max - ax.min) / 100, value: ax.def });
      input.dataset.tag = ax.tag;
      input.dataset.def = ax.def;
      const out = el('span', 'font-axis-val', String(ax.def));
      const refresh = () => { out.textContent = Number(input.value).toFixed(1); sync(); };
      input.addEventListener('input', refresh);
      // 双击轴名恢复默认值
      row.addEventListener('dblclick', () => { input.value = ax.def; refresh(); });
      row.title = '拖动调整，双击恢复默认值';
      row.append(input, out);
      wrap.appendChild(row);
    }
    sync();
    box.appendChild(el('div', 'font-section', '可变字体轴'));
    box.appendChild(wrap);
  }

  // 示例文字：按字体实际包含的字符挑选
  const sample = el('div', 'font-samples');
  sample.style.fontFamily = useFont;
  const hasCjk = info.chars.some((c) => c >= 0x4e00 && c <= 0x9fff);
  const samples = [
    [64, hasCjk ? '永字八法 Aa' : 'Aa Gg Rr'],
    [36, hasCjk ? '天地玄黄，宇宙洪荒。' : 'The quick brown fox'],
    [24, 'The quick brown fox jumps over the lazy dog.'],
    ...(hasCjk ? [[20, '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。']] : []),
    [16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789'],
    [13, '!@#$%^&*()[]{};:\'",.<>/?\\|`~-=+_'],
  ];
  for (const [size, text] of samples) {
    const row = el('div', 'font-row');
    row.appendChild(el('span', 'font-size', `${size}px`));
    const t = el('div', 'font-sample', text);
    t.style.fontSize = `${size}px`;
    t.contentEditable = 'plaintext-only';
    t.spellcheck = false;
    row.appendChild(t);
    sample.appendChild(row);
  }
  box.appendChild(sample);

  // 字符表：最多 2000 个，避免超大中文字体卡住页面
  if (isWoff2 && !info.chars.length) {
    box.appendChild(el('div', 'font-section', 'WOFF2 用 Brotli 压缩并做了表变换，浏览器没有解码接口，读不到字体名称与字符表；字体本身可以正常显示'));
  }
  if (info.chars.length) {
    const shown = info.chars.filter((c) => c > 0x20 && !(c >= 0x7f && c < 0xa0)).slice(0, 2000);
    box.appendChild(el('div', 'font-section', `字符表${info.chars.length > shown.length ? `（显示前 ${shown.length.toLocaleString()} 个）` : ''}`));
    const grid = el('div', 'font-grid');
    grid.style.fontFamily = useFont;
    const frag = document.createDocumentFragment();
    for (const c of shown) {
      const cell = el('div', 'font-cell');
      cell.appendChild(el('span', 'font-glyph', String.fromCodePoint(c)));
      cell.appendChild(el('span', 'font-code', `U+${c.toString(16).toUpperCase().padStart(4, '0')}`));
      frag.appendChild(cell);
    }
    grid.appendChild(frag);
    box.appendChild(grid);
  }

  host.replaceChildren(box);
  const status = [info.format, info.axes.length ? '可变字体' : '', face && face.style !== 'normal' ? face.style : ''];
  if (face) status.push('点击示例文字可以编辑');
  ctx.status(status.filter(Boolean).join('  ·  '));
  return { searchable: true, destroy() { if (face) document.fonts.delete(face); } };
}

/* ============================== 漫画（CBZ） ============================== */
const IMG_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

async function renderComic(host, src, ctx) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(src.bytes);
  const pages = Object.values(zip.files)
    .filter((f) => !f.dir && IMG_RE.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!pages.length) throw new Error('压缩包里没有图片');

  const urls = new Map();
  const urlOf = async (i) => {
    if (!urls.has(i)) urls.set(i, pages[i].async('blob').then((b) => URL.createObjectURL(b)));
    return urls.get(i);
  };
  const wrap = el('div', 'comic');
  wrap.tabIndex = 0;
  const stage = el('div', 'comic-stage');
  const img = el('img', 'comic-page');
  img.alt = '';
  stage.appendChild(img);
  const bar = el('div', 'comic-bar');
  const prev = el('button', 'btn', '‹ 上一页');
  const next = el('button', 'btn', '下一页 ›');
  prev.type = next.type = 'button';
  const label = el('span', 'comic-label');
  const range = el('input', 'comic-range');
  range.type = 'range';
  range.min = '1';
  range.max = String(pages.length);
  bar.append(prev, label, range, next);
  wrap.append(stage, bar);
  host.replaceChildren(wrap);

  let cur = -1;
  const go = async (i) => {
    i = Math.max(0, Math.min(pages.length - 1, i));
    if (i === cur) return;
    cur = i;
    img.src = await urlOf(i);
    stage.scrollTop = 0;
    label.textContent = `${i + 1} / ${pages.length}`;
    range.value = String(i + 1);
    prev.disabled = i === 0;
    next.disabled = i === pages.length - 1;
    ctx.status(`第 ${i + 1} / ${pages.length} 页`);
    ctx.onPosition(i ? String(i + 1) : null);
    if (i + 1 < pages.length) urlOf(i + 1); // 预读下一页
  };
  prev.addEventListener('click', () => go(cur - 1));
  next.addEventListener('click', () => go(cur + 1));
  range.addEventListener('input', () => go(Number(range.value) - 1));
  stage.addEventListener('click', (e) => go(cur + (e.offsetX < stage.clientWidth / 3 ? -1 : 1)));
  wrap.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(cur - 1); }
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(cur + 1); }
  });
  await go((Number(ctx.at) || 1) - 1);
  wrap.focus({ preventScroll: true });
  return {
    goto: (at) => go((Number(at) || 1) - 1),
    async destroy() { for (const u of urls.values()) URL.revokeObjectURL(await u); },
  };
}

/* ============================== iWork（Pages / Keynote / Numbers） ============================== */
async function renderIwork(host, src, ctx) {
  const JSZip = await loadJSZip();
  let zip;
  try { zip = await JSZip.loadAsync(src.bytes); } catch { throw new Error('这个 iWork 文件不是单文件格式（可能是旧版的文件包），无法预览'); }
  // 新版文件内带有预览图：preview.jpg（大图）或 QuickLook/Thumbnail.jpg（旧版）
  const pick = ['preview.jpg', 'QuickLook/Preview.jpg', 'QuickLook/Thumbnail.jpg', 'preview-web.jpg', 'preview-micro.jpg']
    .map((n) => zip.file(n)).find(Boolean)
    || Object.values(zip.files).find((f) => /(^|\/)preview[^/]*\.(jpe?g|png)$/i.test(f.name));
  const pdf = zip.file('QuickLook/Preview.pdf');
  const app = { pages: 'Pages 文稿', key: 'Keynote 演示文稿', numbers: 'Numbers 表格' }[src.name.split('.').pop().toLowerCase()] || 'iWork 文档';
  const box = el('div', 'media iwork');
  if (pdf && !pick) {
    // 旧版带 PDF 预览：交给 PDF 渲染器
    const bytes = await pdf.async('uint8array');
    return renderPdf(host, { ...src, bytes }, ctx);
  }
  if (!pick) throw new Error('文件里没有预览图（请在「设置」中开启「保存文稿预览」后重新保存）');
  const url = URL.createObjectURL(await pick.async('blob'));
  const img = el('img');
  img.src = url;
  img.alt = `${app}预览`;
  const fig = el('figure', 'iwork-fig');
  fig.appendChild(img);
  fig.appendChild(el('figcaption', null, `${app} · 这是文件内嵌的预览图（通常只有第一页 / 第一张幻灯片）`));
  box.appendChild(fig);
  host.replaceChildren(box);
  img.onload = () => ctx.status(`${app}预览 · ${img.naturalWidth} × ${img.naturalHeight}`);
  return { destroy() { URL.revokeObjectURL(url); } };
}

/* ============================== 证书（二进制 DER） ============================== */
async function renderCert(host, src, ctx) {
  const [{ certsFromBytes }, { renderCerts }] = await Promise.all([import('./x509.js'), import('./views/structured.js')]);
  const box = el('div', 'doc-scroll');
  host.replaceChildren(box);
  await renderCerts(box, certsFromBytes(src.bytes), { stale: () => false, status: ctx.status });
  return { searchable: true };
}

/* ============================== OFD（国产版式文档） ============================== */
/** .ofd 是 zip 包，解析与渲染代码按需加载，不进入首屏 */
async function renderOfd(host, src, ctx) {
  const mod = await import('./views/ofd.js');
  return mod.renderOfd(host, src, ctx);
}

/* ============================== 入口 ============================== */
const RENDERERS = {
  pdf: renderPdf,
  epub: renderEpub,
  docx: renderDocx,
  sheet: renderSheet,
  pptx: renderPptx,
  audio: (h, s, c) => renderMedia(h, s, c, 'audio'),
  video: (h, s, c) => renderMedia(h, s, c, 'video'),
  font: renderFont,
  comic: renderComic,
  iwork: renderIwork,
  cert: renderCert,
  ofd: renderOfd,
};

/** 音视频直接用 Blob 播放，其余类型需要读出完整字节 */
export const needsBytes = (kind) => kind !== 'audio' && kind !== 'video';

export async function renderDoc(kind, host, src, ctx) {
  const fn = RENDERERS[kind];
  if (!fn) throw new Error(`不支持的类型：${kind}`);
  return (await fn(host, src, ctx)) || {};
}
