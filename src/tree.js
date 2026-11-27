/** 侧边栏文件树：分组、目录折叠、筛选。所有行的交互用事件委托处理 */
import { state, EXAMPLES_ROOT } from './state.js';
import { $, el, formatSize } from './util.js';
import { baseName, extOf, viewKind, detectLang, IMAGE_EXT } from './languages.js';
import { getFile, prefetch } from './files.js';

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
  comic: ['CBZ', '#c2255c'], iwork: ['iW', '#1c7ed6'], cert: ['🔐', '#5c7cfa'], ofd: ['OFD', '#e8590c'],
  notebook: ['NB', '#f37626'], email: ['✉', '#1971c2'], calendar: ['📅', '#e03131'], contacts: ['👤', '#2f9e44'], pem: ['🔐', '#5c7cfa'],
  archive: ['ZIP', '#7950f2'],
};
const CHEV = '<svg class="chev" viewBox="0 0 12 12" width="12" height="12"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** 侧边栏分组：用户自己打开的文件在上，内置示例在下 */
export const GROUPS = [
  { id: 'mine', title: '我的文件', match: (f) => !f.example },
  { id: 'example', title: '示例', match: (f) => !!f.example },
];

let handlers = null;
let examplesLoading = () => false;
let activeRow = null;

function badgeFor(path, langOverride) {
  const ext = extOf(path);
  if (IMAGE_EXT.has(ext) || ext === 'svg') return ['IMG', '#8250df'];
  const kind = viewKind(path);
  if (DOC_BADGE[kind]) return DOC_BADGE[kind];
  if (/\.(zip|tar|tgz|gz|rar|7z)$/i.test(path)) return DOC_BADGE.archive;
  const lang = langOverride || detectLang(path) || 'plaintext';
  return BADGE[lang] || [lang.slice(0, 2).toUpperCase(), '#6e7781'];
}

function paintBadge(badge, file) {
  const [txt, bg, fg] = badgeFor(file.path, file.lang);
  badge.textContent = txt;
  badge.className = txt.length > 2 ? 'badge long' : 'badge';
  badge.style.background = bg;
  badge.style.color = fg || '';
}

const rowOf = (id) => document.querySelector(`.tree-row.file[data-id="${id}"]`);

export function refreshTreeBadge(file) {
  const badge = rowOf(file.id)?.querySelector('.badge');
  if (badge) paintBadge(badge, file);
}

export function setActiveRow(id) {
  activeRow?.classList.remove('active');
  activeRow = id == null ? null : rowOf(id);
  activeRow?.classList.add('active');
}

/** 在树上可见的文件 id（按显示顺序），用于 ⌥↑ / ⌥↓ 切换 */
export const visibleFileIds = () => Array.from(document.querySelectorAll('#tree .tree-row.file'), (r) => Number(r.dataset.id));

function buildTree(files) {
  const root = { dirs: new Map(), files: [], path: '' };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = node.dirs.get(parts[i]);
      if (!next) {
        next = { dirs: new Map(), files: [], path: node.path ? `${node.path}/${parts[i]}` : parts[i] };
        node.dirs.set(parts[i], next);
      }
      node = next;
    }
    node.files.push(f);
  }
  return root;
}

const collator = new Intl.Collator(undefined, { numeric: true });

function fileRow(f, depth) {
  const row = el('div', `tree-row file${f.id === state.activeId ? ' active' : ''}`);
  if (f.id === state.activeId) activeRow = row;
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.dataset.id = String(f.id);
  row.style.paddingLeft = `${26 + depth * 14}px`;
  row.title = `${f.path}（${formatSize(f.size)}）`;
  const ico = el('span', 'ico');
  const badge = el('span');
  paintBadge(badge, f);
  ico.appendChild(badge);
  const x = el('button', 'x', '×');
  x.type = 'button';
  x.title = '从列表中移除';
  x.dataset.act = 'remove';
  row.append(ico, el('span', 'label', baseName(f.path)), x);
  return row;
}

function walk(node, depth, parent, q) {
  // 有指定顺序的目录（如示例的四个分类）按指定顺序，其余按名称
  const order = state.dirOrder.get(node.path) || [];
  const rank = (d) => { const i = order.indexOf(baseName(d.path)); return i < 0 ? order.length : i; };
  const dirs = [...node.dirs.values()].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  for (const d of dirs) {
    // 只有一个子目录且没有文件时合并显示（a/b/c）
    let cur = d;
    let label = baseName(d.path);
    while (cur.files.length === 0 && cur.dirs.size === 1) {
      cur = cur.dirs.values().next().value;
      label += `/${baseName(cur.path)}`;
    }
    const open = q ? true : state.openDirs.has(cur.path);
    const row = el('button', `tree-row dir${open ? ' open' : ''}`);
    row.type = 'button';
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.innerHTML = `${CHEV}<span class="ico">📁</span><span class="label"></span>`;
    row.lastChild.textContent = label;
    row.title = cur.path;
    row.dataset.dir = cur.path;
    const kids = el('div', `tree-children${open ? ' open' : ''}`);
    parent.append(row, kids);
    walk(cur, depth + 1, kids, q);
  }
  const fs = node.files.length > 1 ? [...node.files].sort((a, b) => collator.compare(baseName(a.path), baseName(b.path))) : node.files;
  for (const f of fs) parent.appendChild(fileRow(f, depth));
}

function groupHeader(g, count, open) {
  const head = el('div', `tree-group${open ? ' open' : ''}`);
  head.dataset.group = g.id;
  const btn = el('button', 'tree-group-toggle');
  btn.type = 'button';
  btn.innerHTML = `${CHEV}<span class="tree-group-title"></span><span class="tree-group-count"></span>`;
  btn.children[1].textContent = g.title;
  btn.children[2].textContent = String(count);
  btn.setAttribute('aria-expanded', String(open));
  btn.dataset.act = 'toggle-group';
  const x = el('button', 'x', '×');
  x.type = 'button';
  x.title = g.id === 'example' ? '移除全部示例' : '移除我的全部文件';
  x.dataset.act = 'remove-group';
  head.append(btn, x);
  return head;
}

function linkBtn(text, act) {
  const b = el('button', 'link-btn', text);
  b.type = 'button';
  b.dataset.act = act;
  return b;
}

function groupEmpty(id) {
  const box = el('div', 'tree-empty');
  if (id === 'mine') box.append('拖入文件，或 ', linkBtn('打开文件', 'pick'), ' / ', linkBtn('粘贴', 'paste'));
  else if (examplesLoading()) box.textContent = '正在加载示例…';
  else box.append(linkBtn('加载示例', 'load-examples'));
  return box;
}

export function renderTree() {
  const tree = $('#tree');
  const q = $('#filter').value.trim().toLowerCase();
  const files = q ? state.files.filter((f) => f.path.toLowerCase().includes(q)) : state.files;
  // 两个分组始终显示，空状态在分组内提示；只有筛选无结果时才用底部提示
  $('#side-empty').hidden = !(q && state.files.length && !files.length);
  const frag = document.createDocumentFragment();
  activeRow = null;
  for (const g of GROUPS) {
    const list = files.filter(g.match);
    if (q && !list.length) continue; // 筛选时隐藏没有匹配的分组
    const open = q ? true : !state.closedGroups.has(g.id);
    const body = el('div', `tree-children${open ? ' open' : ''}`);
    frag.append(groupHeader(g, list.length, open), body);
    if (!list.length) {
      body.appendChild(groupEmpty(g.id));
      continue;
    }
    const root = buildTree(list);
    // 示例都在 `examples/` 下，分组标题已经说明了，直接展示它的子目录
    const exRoot = g.id === 'example' ? root.dirs.get(EXAMPLES_ROOT) : null;
    walk(exRoot && root.dirs.size === 1 && !root.files.length ? exRoot : root, 0, body, q);
  }
  tree.replaceChildren(frag);
}

/** 展开文件所在目录（expand），并把侧边栏滚到能看见它（scroll） */
export function revealInTree(file, { expand = true, scroll = true } = {}) {
  if (expand) {
    const parts = file.path.split('/');
    let changed = state.closedGroups.delete(file.example ? 'example' : 'mine');
    for (let i = 1, dir = parts[0]; i < parts.length; dir += `/${parts[i]}`, i++) {
      if (!state.openDirs.has(dir)) { state.openDirs.add(dir); changed = true; }
    }
    if (changed) renderTree();
    setActiveRow(file.id);
  }
  if (!scroll) return;
  // 只在侧边栏内滚动、且只在看不到时才滚：scrollIntoView 会让整页（包括右侧很长的代码）同步重排
  const row = rowOf(file.id);
  const tree = $('#tree');
  if (!row || !tree) return;
  const r = row.getBoundingClientRect();
  const t = tree.getBoundingClientRect();
  if (r.top < t.top) tree.scrollTop -= t.top - r.top + 8;
  else if (r.bottom > t.bottom) tree.scrollTop += r.bottom - t.bottom + 8;
}

function toggleOpen(row, kids, set, key, invert = false) {
  const nowOpen = !kids.classList.contains('open');
  kids.classList.toggle('open', nowOpen);
  row.classList.toggle('open', nowOpen);
  if (nowOpen !== invert) set.add(key); else set.delete(key);
  return nowOpen;
}

/**
 * @param {{ open(id), remove(id), removeGroup(gid), loadExamples(), pick(), paste() }} h
 * @param {() => boolean} isExamplesLoading
 */
export function initTree(h, isExamplesLoading) {
  handlers = h;
  examplesLoading = isExamplesLoading;
  const tree = $('#tree');
  tree.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const actEl = t.closest('[data-act]');
    const act = actEl?.dataset.act;
    if (act === 'remove') { handlers.remove(Number(actEl.closest('.tree-row').dataset.id)); return; }
    if (act === 'remove-group') { handlers.removeGroup(actEl.closest('.tree-group').dataset.group); return; }
    if (act === 'toggle-group') {
      const head = actEl.closest('.tree-group');
      const gid = head.dataset.group;
      const open = toggleOpen(head, head.nextElementSibling, state.closedGroups, gid, true);
      actEl.setAttribute('aria-expanded', String(open));
      // 第一次展开示例时才去拉清单（启动时已在后台预加载，一般已经就绪）
      if (open && gid === 'example' && !state.files.some((f) => f.example)) handlers.loadExamples();
      return;
    }
    if (act === 'pick') { handlers.pick(); return; }
    if (act === 'paste') { handlers.paste(); return; }
    if (act === 'load-examples') { handlers.loadExamples(); return; }
    const row = t.closest('.tree-row');
    if (!row) return;
    if (row.dataset.dir !== undefined) toggleOpen(row, row.nextElementSibling, state.openDirs, row.dataset.dir);
    else if (getFile(Number(row.dataset.id))) handlers.open(Number(row.dataset.id));
  });
  tree.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.target instanceof Element) || !e.target.matches('.tree-row.file')) return;
    handlers.open(Number(e.target.dataset.id));
  });
  // 示例文件在鼠标悬浮时就开始下载，点下去时多半已经到了；同一行内移动不重复处理
  tree.addEventListener('pointerover', (e) => {
    const row = e.target instanceof Element ? e.target.closest('.tree-row.file') : null;
    if (!row || (e.relatedTarget instanceof Node && row.contains(e.relatedTarget))) return;
    const f = getFile(Number(row.dataset.id));
    if (f) prefetch(f);
  });
  // 筛选：输入停顿后再重建，大目录下逐字重建会卡
  let timer = 0;
  $('#filter').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(renderTree, state.files.length > 500 ? 120 : 0);
  });
}
