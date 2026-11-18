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
const V = './vendor';
const abs = (p) => new URL(p, location.href).href;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const scripts = new Map();
function loadScript(src, globalName) {
  if (globalName && globalThis[globalName]) return Promise.resolve();
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { scripts.delete(src); s.remove(); reject(new Error(`组件加载失败：${src}`)); };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src);
}

function loadCss(href) {
  if (document.querySelector(`link[data-href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  l.dataset.href = href;
  document.head.appendChild(l);
}

const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

/* ============================== PDF ============================== */
let pdfMods = null;
function loadPdfjs() {
  pdfMods ||= (async () => {
    const lib = await import('./vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = abs(`${V}/pdfjs/pdf.worker.min.mjs`);
    const viewer = await import('./vendor/pdfjs/pdf_viewer.mjs'); // 依赖 pdf.min.mjs 设置的 globalThis.pdfjsLib
    loadCss(`${V}/pdfjs/pdf_viewer.css`);
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
  await loadScript(`${V}/mammoth/mammoth.browser.min.js`, 'mammoth');
  const result = await globalThis.mammoth.convertToHtml({ arrayBuffer: toArrayBuffer(src.bytes) });
  const clean = globalThis.DOMPurify.sanitize(result.value, {
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
  const zip = await globalThis.JSZip.loadAsync(src.bytes);
  const slideNo = (p) => Number(/slide(\d+)\.xml$/.exec(p)?.[1] || 0);
  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => slideNo(a) - slideNo(b));
  const parser = new DOMParser();
  const urls = [];
  const list = el('div', 'slides');
  for (const [i, path] of slides.entries()) {
    const xml = parser.parseFromString(await zip.file(path).async('string'), 'application/xml');
    const card = el('section', 'slide');
    card.appendChild(el('div', 'slide-no', String(i + 1)));
    const paras = [...xml.getElementsByTagNameNS('*', 'p')]
      .map((p) => [...p.getElementsByTagNameNS('*', 't')].map((t) => t.textContent).join(''))
      .filter((t) => t.trim());
    paras.forEach((t, j) => card.appendChild(el(j === 0 ? 'h3' : 'p', null, t)));
    // 幻灯片里的图片
    const rels = zip.file(path.replace('slides/', 'slides/_rels/') + '.rels');
    if (rels) {
      const rx = parser.parseFromString(await rels.async('string'), 'application/xml');
      for (const r of rx.getElementsByTagNameNS('*', 'Relationship')) {
        if (!/\/image$/.test(r.getAttribute('Type') || '')) continue;
        const target = new URL(r.getAttribute('Target') || '', 'http://x/ppt/slides/').pathname.slice(1);
        const f = zip.file(target);
        if (!f || !/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(target)) continue;
        const type = /\.svg$/i.test(target) ? 'image/svg+xml' : '';
        const url = URL.createObjectURL(new Blob([await f.async('uint8array')], type ? { type } : {}));
        urls.push(url);
        const img = el('img');
        img.src = url;
        img.alt = '';
        card.appendChild(img);
      }
    }
    if (!paras.length && !card.querySelector('img')) card.appendChild(el('p', 'doc-empty', '（这一页没有文字）'));
    list.appendChild(card);
  }
  if (!slides.length) list.appendChild(el('div', 'doc-empty', '没有找到幻灯片内容'));
  const box = el('div', 'slides-wrap');
  box.append(el('div', 'notice', '演示文稿以提纲方式预览：显示每页的文字和图片，不还原版式与动画。'), list);
  host.replaceChildren(box);
  ctx.status(`${slides.length} 页幻灯片`);
  return { searchable: true, destroy() { urls.forEach((u) => URL.revokeObjectURL(u)); } };
}

/* ============================== 音视频 ============================== */
async function renderMedia(host, src, ctx, kind) {
  const url = URL.createObjectURL(src.blob);
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
  media.addEventListener('error', () => ctx.status('浏览器不支持这种编码，无法播放'));
  const box = el('div', `media media-${kind}`);
  if (kind === 'audio') box.appendChild(el('div', 'media-name', src.name));
  box.appendChild(media);
  host.replaceChildren(box);
  return { destroy() { media.pause(); media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); } };
}

/* ============================== 字体 ============================== */
let fontSeq = 0;
async function renderFont(host, src, ctx) {
  const family = `preview-font-${++fontSeq}`;
  const face = new FontFace(family, toArrayBuffer(src.bytes));
  await face.load();
  document.fonts.add(face);
  const box = el('div', 'font-preview');
  box.style.fontFamily = `"${family}", var(--ui)`;
  box.appendChild(el('div', 'font-name', `${src.name}`));
  const samples = [
    [56, 'Aa 永 あ 한'],
    [32, 'The quick brown fox jumps over the lazy dog.'],
    [24, '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。'],
    [18, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz'],
    [18, '0123456789 !@#$%^&*()[]{};:\'",.<>/?'],
    [14, '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。'],
  ];
  for (const [size, text] of samples) {
    const row = el('div', 'font-row');
    row.appendChild(el('span', 'font-size', `${size}px`));
    const t = el('div', 'font-sample', text);
    t.style.fontSize = `${size}px`;
    t.contentEditable = 'plaintext-only';
    t.spellcheck = false;
    row.appendChild(t);
    box.appendChild(row);
  }
  host.replaceChildren(box);
  ctx.status(`${face.style} · ${face.weight}  ·  点击示例文字可以编辑`);
  return { searchable: true, destroy() { document.fonts.delete(face); } };
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
};

export const DOC_NAMES = {
  pdf: 'PDF', epub: 'EPUB', docx: 'Word 文档', sheet: '电子表格', pptx: '演示文稿', audio: '音频', video: '视频', font: '字体',
};

/** 音视频直接用 Blob 播放，其余类型需要读出完整字节 */
export const needsBytes = (kind) => kind !== 'audio' && kind !== 'video';

export async function renderDoc(kind, host, src, ctx) {
  const fn = RENDERERS[kind];
  if (!fn) throw new Error(`不支持的类型：${kind}`);
  return (await fn(host, src, ctx)) || {};
}
