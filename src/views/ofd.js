/**
 * OFD（GB/T 33190）轻量预览。
 * .ofd 是 zip 包：OFD.xml → Document.xml → 每页 Content.xml，坐标单位是毫米，
 * 正好可以直接作为 SVG 的 viewBox 单位。按页还原文字、图片与基础路径；
 * 嵌入字体、复杂图形、签章验签不在范围内，定位是「看得见内容」而非精确版式。
 */
import { el, viewUrl } from '../util.js';
import { loadJSZip } from '../libs.js';

const NS = 'http://www.w3.org/2000/svg';
const MM = 96 / 25.4; // 毫米 → 96dpi 下的 CSS 像素
const parser = new DOMParser();

const parseXml = (s) => parser.parseFromString(s, 'application/xml');
const kids = (node, name) => (node ? Array.from(node.getElementsByTagNameNS('*', name)) : []);
const first = (node, name) => kids(node, name)[0] || null;
const val = (node, name) => first(node, name)?.textContent?.trim() || '';
const attr = (node, name, def = '') => node?.getAttribute(name) ?? def;
const nums = (s) => String(s ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite);

function joinPath(base, rel) {
  const out = [];
  for (const part of base.split('/').slice(0, -1).concat(String(rel || '').split('/'))) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function zipEntry(zip, path) {
  const exact = zip.file(path);
  if (exact) return exact;
  const want = path.replace(/^\/+/, '').toLowerCase();
  return Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase() === want) || null;
}

async function readXml(zip, path) {
  const entry = zipEntry(zip, path);
  if (!entry) return null;
  const doc = parseXml(await entry.async('string'));
  return doc.documentElement ? doc : null;
}

function colorOf(s, def) {
  const p = nums(s);
  if (p.length >= 3) {
    const max = Math.max(...p.slice(0, 3));
    const c = p.slice(0, 3).map((n) => Math.round(max <= 1 ? n * 255 : n));
    return `rgb(${c.join(',')})`;
  }
  return def;
}

function ctmOf(node) {
  const m = nums(attr(node, 'CTM'));
  if (m.length !== 6) return '';
  if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0) return '';
  return `matrix(${m.join(' ')})`;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== '' && v != null) node.setAttribute(k, String(v));
  }
  return node;
}

/** OFD 路径命令 → SVG path（B 等同 C；A/S 只保留终点，避免整条路径失效） */
const ARGS = { M: 2, L: 2, C: 6, Q: 4, B: 6, A: 7, S: 4, H: 1, V: 1, Z: 0 };
function svgPath(src) {
  const tokens = String(src || '').match(/[A-Za-z]|[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const out = [];
  for (let i = 0; i < tokens.length;) {
    const cmd = tokens[i++];
    const key = cmd.toUpperCase();
    const n = ARGS[key];
    if (n == null) break;
    const args = tokens.slice(i, i + n);
    if (args.length < n || args.some((a) => !Number.isFinite(Number(a)))) break;
    i += n;
    if (key === 'B') out.push(cmd === 'b' ? 'c' : 'C', ...args);
    else if (key === 'A' || key === 'S') out.push('M', ...args.slice(-2));
    else out.push(cmd, ...args);
  }
  return out.join(' ');
}

async function loadStructure(zip) {
  const names = Object.keys(zip.files);
  const rootName = names.find((n) => !n.includes('/') && n.toLowerCase().endsWith('ofd.xml'))
    || names.find((n) => n.toLowerCase().endsWith('ofd.xml')) || 'OFD.xml';
  const root = await readXml(zip, rootName);
  const docPath = joinPath(rootName, val(root, 'DocRoot') || 'Doc_0/Document.xml');
  const doc = await readXml(zip, docPath);
  const box = nums(val(doc, 'PhysicalBox'));
  const pageSize = box.length >= 4 ? box : [0, 0, 210, 297];
  const resPaths = [val(doc, 'DocumentRes'), val(doc, 'PublicRes')].filter(Boolean).map((p) => joinPath(docPath, p));
  let pages = kids(doc, 'Page').map((p) => joinPath(docPath, attr(p, 'BaseLoc'))).filter(Boolean);
  if (!pages.length) {
    // 少数厂商不按标准放 Document.xml：兜底按 Content.xml 排序当页面
    pages = names.filter((n) => /content\.xml$/i.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  return { pageSize, resPaths, pages };
}

async function loadResources(zip, paths) {
  const media = new Map();
  const fonts = new Map();
  for (const p of paths) {
    const doc = await readXml(zip, p);
    if (!doc) continue;
    for (const m of kids(doc, 'MediaFile')) {
      const id = attr(m, 'ID');
      const file = attr(m, 'FileName') || val(m, 'FileName');
      if (id && file) media.set(id, joinPath(p, file));
    }
    for (const f of kids(doc, 'Font')) {
      const id = attr(f, 'ID');
      if (id) fonts.set(id, attr(f, 'FamilyName') || attr(f, 'FontName') || '');
    }
  }
  return { media, fonts };
}

function drawText(parent, obj, fonts) {
  const b = nums(attr(obj, 'Boundary'));
  const [x = 0, y = 0] = b;
  const size = Number(attr(obj, 'Size')) || 3.5;
  const fill = colorOf(attr(obj, 'FillColor') || attr(obj, 'Color'), '#111');
  const family = fonts.get(attr(obj, 'Font')) || '';
  const transform = ctmOf(obj);
  for (const code of kids(obj, 'TextCode')) {
    const cx = Number(attr(code, 'X', '0')) || 0;
    const cy = Number(attr(code, 'Y', String(size))) || 0;
    const node = svg('text', {
      x: x + cx, y: y + cy, 'font-size': size, fill, transform,
      'font-family': family ? `${family}, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif` : '',
      'xml:space': 'preserve',
    });
    const chars = Array.from(code.textContent || '');
    const dx = nums(attr(code, 'DeltaX'));
    if (chars.length && dx.length === chars.length && chars.length <= 2000) {
      let px = x + cx;
      for (let i = 0; i < chars.length; i++) {
        const span = svg('tspan', { x: px });
        span.textContent = chars[i];
        node.appendChild(span);
        px += dx[i];
      }
    } else {
      node.textContent = chars.join('');
    }
    if (node.textContent) parent.appendChild(node);
  }
}

async function drawImage(parent, obj, zip, media) {
  const b = nums(attr(obj, 'Boundary'));
  if (b.length < 4) return;
  const path = media.get(attr(obj, 'ResourceID'));
  if (!path) return;
  const entry = zipEntry(zip, path);
  if (!entry) return;
  try {
    const blob = await entry.async('blob');
    parent.appendChild(svg('image', {
      href: viewUrl(blob), x: b[0], y: b[1], width: b[2], height: b[3],
      transform: ctmOf(obj), preserveAspectRatio: 'none',
    }));
  } catch { /* 坏图片跳过 */ }
}

function drawPath(parent, obj) {
  const d = svgPath(val(obj, 'AbbreviatedData'));
  if (!d) return;
  const filled = attr(obj, 'Fill') === 'true';
  const stroked = attr(obj, 'Stroke') === 'true' || !filled;
  parent.appendChild(svg('path', {
    d,
    fill: filled ? colorOf(attr(obj, 'FillColor'), '#111') : 'none',
    stroke: stroked ? colorOf(attr(obj, 'StrokeColor'), '#333') : 'none',
    'stroke-width': Number(attr(obj, 'LineWidth')) || 0.25,
    transform: ctmOf(obj),
  }));
}

async function drawNode(parent, node, zip, media, fonts, depth = 0) {
  if (depth > 6) return;
  for (const obj of Array.from(node.children || [])) {
    switch (obj.localName) {
      case 'TextObject': drawText(parent, obj, fonts); break;
      case 'ImageObject': await drawImage(parent, obj, zip, media); break;
      case 'PathObject': drawPath(parent, obj); break;
      case 'CompositeObject':
      case 'Layer':
      case 'Content':
      case 'Page':
        await drawNode(parent, obj, zip, media, fonts, depth + 1);
        break;
      default: break;
    }
  }
}

async function renderPage(zip, pageLoc, pageSize, media, fonts) {
  const content = await readXml(zip, pageLoc);
  if (!content) return null;
  const pb = nums(val(content, 'PhysicalBox'));
  const [x0, y0, x1, y1] = pb.length >= 4 ? pb : pageSize;
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const pageSvg = svg('svg', { viewBox: `${x0} ${y0} ${w} ${h}`, class: 'ofd-page' });
  pageSvg.appendChild(svg('rect', { x: x0, y: y0, width: w, height: h, fill: '#ffffff' }));
  const group = svg('g');
  await drawNode(group, content.documentElement, zip, media, fonts);
  pageSvg.appendChild(group);
  return { node: pageSvg, w, h };
}

/** 渲染器入口：签名与 docviewers.js 里的其它渲染器一致 */
export async function renderOfd(host, src, ctx) {
  const JSZip = await loadJSZip();
  let zip;
  try { zip = await JSZip.loadAsync(src.bytes); } catch { throw new Error('OFD 文件无法解压'); }
  const { pageSize, resPaths, pages } = await loadStructure(zip);
  if (!pages.length) throw new Error('这个 OFD 里没有可显示的页面');
  const { media, fonts } = await loadResources(zip, resPaths);

  const wrap = el('div', 'ofd');
  const stage = el('div', 'ofd-stage');
  const bar = el('div', 'ofd-bar');
  const prev = el('button', 'btn', '‹ 上一页');
  const next = el('button', 'btn', '下一页 ›');
  prev.type = next.type = 'button';
  const label = el('span', 'ofd-label');
  const range = el('input', 'ofd-range');
  range.type = 'range';
  range.min = '1';
  range.max = String(pages.length);
  const zoomOut = el('button', 'icon-btn text-btn', 'A−');
  const zoomIn = el('button', 'icon-btn text-btn', 'A+');
  zoomOut.type = zoomIn.type = 'button';
  zoomOut.title = '缩小';
  zoomIn.title = '放大';
  const zoomLabel = el('span', 'ofd-zoom');
  bar.append(prev, label, range, next, zoomOut, zoomLabel, zoomIn);
  wrap.append(stage, bar);
  host.replaceChildren(wrap);

  const cache = new Map();
  let cur = -1;
  let zoom = 1;
  let alive = true;
  let page = null;

  const applySize = () => {
    if (!page) return;
    const fit = Math.min((stage.clientWidth - 32) / (page.w * MM), 2);
    const scale = Math.max(0.2, fit) * zoom;
    page.node.style.width = `${Math.round(page.w * MM * scale)}px`;
    page.node.style.height = `${Math.round(page.h * MM * scale)}px`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  };
  const report = () => {
    label.textContent = `${cur + 1} / ${pages.length}`;
    range.value = String(cur + 1);
    prev.disabled = cur === 0;
    next.disabled = cur === pages.length - 1;
    ctx.status(`第 ${cur + 1} / ${pages.length} 页  ·  ${Math.round(zoom * 100)}%`);
  };
  const show = async (i) => {
    i = Math.max(0, Math.min(pages.length - 1, i));
    if (i === cur) return;
    cur = i;
    stage.replaceChildren(el('div', 'doc-loading', '正在渲染…'));
    report();
    let cached = cache.get(i);
    if (!cached) {
      cached = await renderPage(zip, pages[i], pageSize, media, fonts);
      if (!cached) { stage.replaceChildren(el('div', 'doc-empty', '这一页无法读取')); return; }
      cache.set(i, cached);
    }
    if (!alive || cur !== i) return;
    page = cached;
    stage.replaceChildren(page.node);
    applySize();
    stage.scrollTop = 0;
    ctx.onPosition(i ? String(i + 1) : null);
  };
  prev.addEventListener('click', () => show(cur - 1));
  next.addEventListener('click', () => show(cur + 1));
  range.addEventListener('input', () => show(Number(range.value) - 1));
  const setZoom = (dir) => {
    zoom = Math.min(3, Math.max(0.4, zoom + dir * 0.2));
    applySize();
    report();
  };
  zoomOut.addEventListener('click', () => setZoom(-1));
  zoomIn.addEventListener('click', () => setZoom(1));
  window.addEventListener('resize', applySize);
  await show((Number(ctx.at) || 1) - 1);

  return {
    goto: (at) => show((Number(at) || 1) - 1),
    zoom: (dir) => setZoom(dir),
    destroy() { alive = false; window.removeEventListener('resize', applySize); },
  };
}
