/** 页内查找：文本视图在 DOM 中标记匹配；PDF 等自带查找能力的文档交给渲染器 */
import { state } from './state.js';
import { $ } from './util.js';
import { materializeJson } from './views/preview.js';

const LIMIT = 5000;

/** 自带查找的文档控制器（PDF） */
export const nativeFind = () => (state.current?.doc && state.docCtl?.find ? state.docCtl : null);

/** 当前文件能否用查找：文本、可搜索的文档（Word / 表格…）、自带查找的文档（PDF） */
export function canFind(cur = state.current) {
  if (!cur) return false;
  if (cur.text !== null) return true;
  return !!(cur.doc && (state.docCtl?.searchable || state.docCtl?.find));
}

export const findOpen = () => !$('#findbar').hidden;

export function openFind(setMode) {
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

export function closeFind() {
  if (findOpen()) nativeFind()?.findClose?.();
  $('#findbar').hidden = true;
  clearMarks();
  $('#find-count').textContent = '';
}

function clearMarks() {
  const f = state.find;
  const parents = new Set();
  for (const m of f.marks) {
    const p = m.parentNode;
    if (!p) continue;
    p.replaceChild(document.createTextNode(m.textContent), m);
    parents.add(p);
  }
  for (const p of parents) p.normalize(); // 每个父节点只合并一次
  f.marks = [];
  f.index = -1;
}

function buildMatcher() {
  const { query, caseSensitive, regex } = state.find;
  if (!query) return null;
  try {
    return new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  } catch {
    return 'bad';
  }
}

const SKIP = '.ln, .rn, .notice, .jt-toggle';

export function runFind() {
  const f = state.find;
  f.query = $('#find-input').value;
  const count = $('#find-count');
  const nf = nativeFind();
  if (nf) {
    count.textContent = f.query ? '查找中…' : '';
    nf.find(f.query, { caseSensitive: f.caseSensitive }, (cur, total) => {
      count.textContent = !f.query ? '' : total ? `${cur} / ${total}` : '无结果';
    });
    return;
  }
  clearMarks();
  const re = buildMatcher();
  $('#find-input').classList.toggle('bad', re === 'bad');
  if (!re || re === 'bad') { count.textContent = re === 'bad' ? '正则有误' : ''; return; }

  const scope = $('#content');
  materializeJson(scope); // JSON 树里尚未生成的折叠节点也要能搜到
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  // 先收集再修改，避免边遍历边改 DOM
  const jobs = [];
  let total = 0;
  for (let n = walker.nextNode(); n && total < LIMIT; n = walker.nextNode()) {
    const text = n.nodeValue;
    re.lastIndex = 0;
    let hits = null;
    for (let m = re.exec(text); m && total < LIMIT; m = re.exec(text)) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      (hits ||= []).push(m.index, m.index + m[0].length);
      total++;
    }
    if (hits) jobs.push([n, hits]);
  }
  for (const [node, hits] of jobs) {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (let i = 0; i < hits.length; i += 2) {
      const s = hits[i];
      const e = hits[i + 1];
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
  }
  if (!f.marks.length) { count.textContent = '无结果'; return; }
  gotoMatch(firstVisible(f.marks));
}

/** 匹配按文档顺序排列，二分查找视口内的第一个，避免对每个匹配都读取布局 */
function firstVisible(marks) {
  const top = $('#viewer').getBoundingClientRect().top;
  let lo = 0;
  let hi = marks.length - 1;
  if (marks[hi].getBoundingClientRect().top < top) return 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (marks[mid].getBoundingClientRect().top >= top) hi = mid; else lo = mid + 1;
  }
  return lo;
}

export function gotoMatch(i) {
  const f = state.find;
  const nf = nativeFind();
  if (nf) { nf.findAgain(i < f.index); return; }
  if (!f.marks.length) return;
  if (f.index >= 0) f.marks[f.index]?.classList.remove('cur');
  f.index = (i + f.marks.length) % f.marks.length;
  const mk = f.marks[f.index];
  mk.classList.add('cur');
  // JSON 树中被折叠的节点需要展开
  for (let p = mk.parentElement; p && p.id !== 'content'; p = p.parentElement) p.classList.remove('jt-closed');
  mk.scrollIntoView({ block: 'center', inline: 'nearest' });
  $('#find-count').textContent = `${f.index + 1} / ${f.marks.length}${f.marks.length >= LIMIT ? '+' : ''}`;
}

export function bindFind(setMode) {
  let timer = null;
  const input = $('#find-input');
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(runFind, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gotoMatch(state.find.index + (e.shiftKey ? -1 : 1)); }
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); $('#viewer').focus(); }
  });
  $('#btn-search').addEventListener('click', () => openFind(setMode));
  $('#find-prev').addEventListener('click', () => gotoMatch(state.find.index - 1));
  $('#find-next').addEventListener('click', () => gotoMatch(state.find.index + 1));
  $('#find-close').addEventListener('click', closeFind);
  for (const key of ['caseSensitive', 'regex']) {
    $(key === 'regex' ? '#find-regex' : '#find-case').addEventListener('click', (e) => {
      state.find[key] = !state.find[key];
      e.currentTarget.classList.toggle('on', state.find[key]);
      runFind();
    });
  }
}
