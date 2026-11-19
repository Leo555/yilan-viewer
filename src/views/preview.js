/** 文本类预览：图片、Markdown、CSV / TSV、HTML / SVG、JSON 树 */
import { el, escapeHtml, viewUrl } from '../util.js';
import { MAX_CSV_ROWS } from '../state.js';
import { baseName } from '../languages.js';
import { loadMarkdown } from '../libs.js';

/* ---------- 图片 ---------- */
export function renderImage(content, blob, name, onSize) {
  const wrap = el('div', 'media');
  const img = new Image();
  img.alt = baseName(name);
  img.decoding = 'async';
  img.onload = () => onSize(`${img.naturalWidth} × ${img.naturalHeight}`);
  // TIFF / HEIC 等只有部分浏览器（Safari）能显示
  img.onerror = () => {
    const ext = name.split('.').pop().toUpperCase();
    wrap.replaceChildren(el('div', 'doc-empty', `当前浏览器不支持显示 ${ext} 图片，可以下载后查看，或换用 Safari 打开。`));
    onSize('');
  };
  img.src = viewUrl(blob);
  wrap.appendChild(img);
  content.replaceChildren(wrap);
}

/* ---------- Markdown ---------- */
/**
 * @param {{ resolve: (href: string) => object|null, open: (file) => void, stale: () => boolean }} ctx
 */
export async function renderMarkdown(content, text, ctx) {
  const { marked, DOMPurify, hljs } = await loadMarkdown();
  if (ctx.stale()) return;
  const raw = marked.parse(text, { gfm: true, breaks: false });
  const div = el('article', 'md');
  div.innerHTML = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'] });
  // 只保留 GFM 任务列表的只读勾选框，其他 input 一律移除
  for (const input of div.querySelectorAll('input')) {
    if (input.type === 'checkbox' && input.closest('li')) input.disabled = true;
    else input.remove();
  }
  for (const a of div.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/^https?:/i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  }
  // 相对链接若指向已加载的文件则在本页打开（事件委托，一个监听器即可）
  div.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    const href = a?.getAttribute('href');
    if (!href || /^([a-z][\w+.-]*:|#)/i.test(href)) return;
    const target = ctx.resolve(href.split('#')[0]);
    if (target) { e.preventDefault(); ctx.open(target); }
  });
  // 相对路径图片：从已加载的文件中找；图片懒加载
  for (const img of div.querySelectorAll('img[src]')) {
    img.loading = 'lazy';
    img.decoding = 'async';
    const src = img.getAttribute('src');
    if (/^(https?:|data:|blob:)/i.test(src)) continue;
    const f = ctx.resolve(src);
    if (!f) continue;
    img.removeAttribute('src');
    f.getBlob().then((b) => { if (!ctx.stale()) img.src = viewUrl(b); }, () => {});
  }
  for (const code of div.querySelectorAll('pre code')) {
    const m = /language-([\w+#-]+)/.exec(code.className);
    const id = m && hljs.getLanguage(m[1]) ? m[1] : null;
    if (!id) continue;
    try {
      code.innerHTML = hljs.highlight(code.textContent, { language: id, ignoreIllegals: true }).value;
      code.classList.add('hljs');
    } catch { /* ignore */ }
  }
  content.replaceChildren(div);
}

/* ---------- CSV / TSV ---------- */
function parseCsv(text, delim, maxRows) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  let truncated = false;
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
      if (rows.length > maxRows) { truncated = i + 1 < text.length; break; }
    } else field += c;
  }
  if (!truncated && (field !== '' || row.length)) { row.push(field); rows.push(row); }
  return { rows, truncated };
}

/** 统计前若干条记录里每种分隔符的个数（跳过引号内的内容），选每行个数一致且最多的那个 */
function guessDelimiter(text) {
  const CANDS = [',', ';', '\t', '|'];
  const records = [];
  let counts = [0, 0, 0, 0];
  let q = false;
  const end = Math.min(text.length, 20000);
  for (let i = 0; i < end && records.length < 20; i++) {
    const c = text[i];
    if (c === '"') q = !q;
    else if (q) continue;
    else if (c === '\n') { records.push(counts); counts = [0, 0, 0, 0]; }
    else {
      const k = CANDS.indexOf(c);
      if (k >= 0) counts[k]++;
    }
  }
  if (counts.some((n) => n > 0)) records.push(counts);
  let best = ',';
  let bestScore = -1;
  CANDS.forEach((d, k) => {
    const per = records.map((r) => r[k]);
    if (!per[0]) return;
    const consistent = per.filter((n) => n === per[0]).length / per.length;
    const score = consistent * 1000 + per[0];
    if (score > bestScore) { bestScore = score; best = d; }
  });
  return best;
}

const NUM_RE = /^\s*-?[\d,]*\.?\d+(e[+-]?\d+)?%?\s*$/i;

export function renderCsv(content, text, delim) {
  const body = text.replace(/^\uFEFF/, '');
  const { rows, truncated } = parseCsv(body, delim || guessDelimiter(body), MAX_CSV_ROWS);
  const shown = rows.length > MAX_CSV_ROWS + 1 ? rows.slice(0, MAX_CSV_ROWS + 1) : rows;
  let cols = 0;
  for (const r of shown) if (r.length > cols) cols = r.length;
  const head = shown[0] || [];
  const h = ['<div class="csv-wrap"><table class="csv"><thead><tr><th class="rn"></th>'];
  for (let c = 0; c < cols; c++) {
    const v = escapeHtml(head[c] ?? '');
    h.push(`<th title="${v}">${v}</th>`);
  }
  h.push('</tr></thead><tbody>');
  for (let r = 1; r < shown.length; r++) {
    h.push(`<tr><td class="rn">${r}</td>`);
    const row = shown[r];
    for (let c = 0; c < cols; c++) {
      const raw = row[c] ?? '';
      const v = escapeHtml(raw);
      // 长单元格才需要悬停提示，避免每格都复制一份文本
      h.push(`<td${NUM_RE.test(raw) ? ' class="num"' : ''}${raw.length > 30 ? ` title="${v}"` : ''}>${v}</td>`);
    }
    h.push('</tr>');
  }
  h.push('</tbody></table></div>');
  content.innerHTML = h.join('');
  if (truncated || rows.length > MAX_CSV_ROWS + 1) {
    content.prepend(el('div', 'notice', `只显示前 ${MAX_CSV_ROWS.toLocaleString()} 行，完整内容请切换到「源码」查看。`));
  }
}

/* ---------- HTML / SVG ---------- */
export function renderHtmlFrame(content, text, kind) {
  const frame = el('iframe', 'html-frame');
  // 不允许脚本、表单、弹窗；与本站完全隔离
  frame.setAttribute('sandbox', '');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.src = viewUrl(new Blob([text], { type: kind === 'svg' ? 'image/svg+xml' : 'text/html' }));
  content.classList.add('fill');
  content.replaceChildren(frame);
}

/* ---------- JSON 树 ---------- */
/**
 * 节点很多时深层默认折叠，折叠节点的子节点在第一次展开时才生成 DOM。
 * 查找前调用 materializeJson() 把剩余节点全部生成，保证能搜到折叠内容。
 */
const pending = new WeakMap(); // 折叠且尚未生成子节点的 .jt-node → 生成函数

export function renderJsonTree(content, text, onBadJson) {
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    const n = el('div', 'notice', `JSON 解析失败：${err.message}`);
    const b = el('button', 'btn', '查看源码');
    b.type = 'button';
    b.addEventListener('click', onBadJson);
    n.appendChild(b);
    content.replaceChildren(n);
    return;
  }
  let budget = 20000;
  const scalar = (v) => {
    if (v === null) return el('span', 'jt-null', 'null');
    if (typeof v === 'string') return el('span', 'jt-str', JSON.stringify(v));
    if (typeof v === 'number') return el('span', 'jt-num', String(v));
    return el('span', 'jt-bool', String(v));
  };
  const fillKids = (node, value, arr, depth) => {
    const keys = arr ? null : Object.keys(value);
    const len = arr ? value.length : keys.length;
    const kids = el('div', 'jt-kids');
    for (let i = 0; i < len; i++) {
      kids.appendChild(build(arr ? null : keys[i], arr ? value[i] : value[keys[i]], depth + 1, i === len - 1));
    }
    node.insertBefore(kids, node.lastChild);
  };
  const build = (key, value, depth, last) => {
    const node = el('div', 'jt-node');
    const line = el('div', 'jt-line');
    const comma = last ? '' : ',';
    const isObj = value !== null && typeof value === 'object';
    if (isObj) line.appendChild(el('span', 'jt-toggle'));
    if (key !== null) line.append(el('span', 'jt-key', JSON.stringify(key)), ': ');
    node.appendChild(line);
    if (!isObj) {
      line.append(scalar(value), comma);
      return node;
    }
    const arr = Array.isArray(value);
    const len = arr ? value.length : Object.keys(value).length;
    const [o, c] = arr ? ['[', ']'] : ['{', '}'];
    if (!len) {
      line.append(`${o}${c}${comma}`);
      return node;
    }
    line.append(o, el('span', 'jt-summary', ` ${arr ? `${len} 项` : `${len} 个键`} ${c}${comma}`));
    node.appendChild(el('div', 'jt-end', c + comma));
    budget -= len;
    if (depth >= 2 && budget < 0) {
      node.classList.add('jt-closed');
      pending.set(node, () => fillKids(node, value, arr, depth));
    } else {
      fillKids(node, value, arr, depth);
    }
    return node;
  };
  const root = el('div', 'json-tree');
  root.addEventListener('click', (e) => {
    const tog = e.target instanceof Element ? e.target.closest('.jt-toggle') : null;
    if (!tog) return;
    const node = tog.parentElement.parentElement;
    if (!expandNode(node)) node.classList.toggle('jt-closed');
  });
  const top = build(null, data, 0, true);
  top.style.paddingLeft = '14px';
  root.appendChild(top);
  content.replaceChildren(root);
}

function expandNode(node) {
  const fill = pending.get(node);
  if (!fill) return false;
  pending.delete(node);
  fill();
  node.classList.remove('jt-closed');
  return true;
}

/** 生成所有尚未展开的节点（保持折叠状态） */
export function materializeJson(content) {
  const tree = content.querySelector('.json-tree');
  if (!tree) return;
  // 生成子节点后可能出现新的待生成节点，直到全部生成为止
  for (let found = true; found;) {
    found = false;
    for (const node of tree.querySelectorAll('.jt-closed')) {
      const fill = pending.get(node);
      if (!fill) continue;
      pending.delete(node);
      fill();
      found = true;
    }
  }
}
