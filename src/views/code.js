/** 源码视图：语法高亮、分块渲染、大文件后台高亮 */
import '../code-html.js';
import { $, el, escapeHtml, formatSize } from '../util.js';
import { MAX_HIGHLIGHT, WORKER_THRESHOLD, MAX_RENDER_LINES } from '../state.js';
import { langById } from '../languages.js';
import { ensureLanguage } from '../libs.js';

const { splitHighlighted, plainLines, buildChunks } = globalThis.YilanCode;

/**
 * 渲染源码。首屏内容画出来后就返回；大文件的高亮在 Worker 中继续，完成后原地替换并调用 onRepaint。
 * @param {{ wrap: boolean, stale: () => boolean, onRepaint: () => void }} opts
 */
export async function renderCode(content, cur, { wrap, stale, onRepaint }) {
  const { text, lang } = cur;
  cur.cols ??= maxColumns(text);
  const paint = (res, notice, keepScroll = false) => paintCode(content, cur, res, { notice, wrap, keepScroll });
  const plain = () => fromLines(plainLines(escapeHtml(text)));

  if (text.length > MAX_HIGHLIGHT) {
    paint(plain(), `文件较大（${formatSize(text.length)}），已关闭语法高亮以保证流畅。`);
    return;
  }
  if (lang === 'log') { paint(fromLines(splitHighlighted(highlightLog(text)))); return; }
  if (!lang || lang === 'plaintext') { paint(plain()); return; }

  if (text.length > WORKER_THRESHOLD) {
    // 先显示无高亮的内容，后台高亮完成后再替换
    paint(plain());
    cur.statusText = '正在高亮…';
    highlightInWorker(text, lang).then((res) => {
      if (stale()) return;
      cur.statusText = null;
      if (res) paint(res, '', true);
      onRepaint();
    });
    return;
  }

  let html = null;
  try {
    if (await ensureLanguage(lang)) html = globalThis.hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch (err) {
    console.warn('高亮失败', err);
  }
  if (stale()) return;
  paint(html === null ? plain() : fromLines(splitHighlighted(html)));
}

function fromLines(lines) {
  const shown = Math.min(lines.length, MAX_RENDER_LINES);
  return { html: buildChunks(lines, shown), shown, total: lines.length };
}

function paintCode(content, cur, { html, shown, total }, { notice, wrap, keepScroll }) {
  const viewer = $('#viewer');
  const { scrollTop, scrollLeft } = viewer;
  if (total > shown) notice = `文件有 ${total.toLocaleString()} 行，只显示前 ${shown.toLocaleString()} 行；完整内容可以下载查看。`;
  const box = el('div', `code hljs${wrap ? ' wrap' : ''}`);
  box.style.setProperty('--ln-digits', String(String(shown).length));
  box.style.setProperty('--cols', String(cur.cols));
  box.innerHTML = html;
  if (notice) content.replaceChildren(el('div', 'notice', notice), box);
  else content.replaceChildren(box);
  cur.lineCount = shown;
  if (keepScroll) {
    viewer.scrollTop = scrollTop;
    viewer.scrollLeft = scrollLeft;
  }
}

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;
/**
 * 估算最长一行的显示列数，用来预设代码区宽度：屏幕外的块不参与布局，
 * 不预设的话横向滚动条会随滚动变化。只精确计算最长的那一行（制表符按 4 列、宽字符按 2 列）。
 */
function maxColumns(text) {
  let best = 0;
  let bestStart = 0;
  for (let start = 0; ;) {
    const nl = text.indexOf('\n', start);
    const end = nl < 0 ? text.length : nl;
    if (end - start > best) { best = end - start; bestStart = start; }
    if (nl < 0) break;
    start = nl + 1;
  }
  if (best > 20000) return best;
  let cols = 0;
  for (const ch of text.slice(bestStart, bestStart + best)) {
    if (ch === '\t') cols += 4 - (cols % 4);
    else if (ch !== '\r') cols += WIDE.test(ch) ? 2 : 1;
  }
  return cols;
}

function highlightLog(text) {
  return escapeHtml(text)
    .replace(/^(\[?\d{4}-\d{2}-\d{2}[ T][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?\]?)/gm, '<span class="hljs-comment">$1</span>')
    .replace(/\b(ERROR|FATAL|CRITICAL|SEVERE|Exception|Traceback)\b/g, '<span class="hljs-deletion">$1</span>')
    .replace(/\b(WARN|WARNING)\b/g, '<span class="hljs-built_in">$1</span>')
    .replace(/\b(INFO|NOTICE)\b/g, '<span class="hljs-string">$1</span>')
    .replace(/\b(DEBUG|TRACE)\b/g, '<span class="hljs-meta">$1</span>');
}

/* ---------- 后台高亮 ---------- */
let worker = null;
let workerSeq = 0;
const workerJobs = new Map();

function highlightInWorker(text, lang) {
  if (!worker) {
    try {
      worker = new Worker(new URL('../highlight-worker.js', import.meta.url));
      worker.onmessage = (e) => {
        const job = workerJobs.get(e.data.id);
        if (!job) return;
        workerJobs.delete(e.data.id);
        if (e.data.error) console.warn('后台高亮失败', e.data.error);
        job(e.data.html ? e.data : null);
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
    worker.postMessage({ id, text, lang, extra: !!langById(lang)?.extra, maxLines: MAX_RENDER_LINES });
  });
}
