/**
 * hash 路由，静态部署无需服务端改写：
 *   #/                                  欢迎页
 *   #/examples/code/backend/main.go          打开文件
 *   #/examples/code/web/index.html?mode=code 指定视图（code / preview，默认值不写）
 *   #/examples/code/backend/main.go?L=12-20  选中行（单行写 L=12）
 *   #/examples/documents/sample.pdf?at=3     文档位置
 *   #/examples/code/backend                  目录：打开其中第一个文件
 * 示例文件可直接通过链接分享；本地文件只在当前会话内有效，刷新后无法恢复。
 */
import { state } from './state.js';

// 按地址栏恢复状态时不要回写历史（否则会多出一条重复记录）。
// 用计数 + 序号防止「上一个路由恢复较慢」时把地址栏改回旧文件：
// PDF / EPUB 等渲染在后台标签页可能长时间不返回，故另加超时兜底，
// 避免 routing 永远卡在 >0，导致之后点击文件也不更新地址栏。
let routing = 0;
let routeSeq = 0;

export function parseRoute(hash = location.hash) {
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
export function syncRoute({ replace = false } = {}) {
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

/** 按地址栏恢复状态，结束后规范化地址（目录 → 文件、旧格式 #L12 → ?L=12、找不到的文件 → 首页） */
export async function applyRoute(restore) {
  const seq = ++routeSeq;
  const r = parseRoute();
  if (!r) return;
  routing++;
  let released = false;
  const release = () => { if (!released) { released = true; routing--; } };
  try {
    await Promise.race([
      restore(r).catch((err) => { console.warn('路由恢复失败', err); }).finally(release),
      new Promise((resolve) => setTimeout(() => { release(); resolve(); }, 2500)),
    ]);
  } finally {
    release();
  }
  // 已有更新的路由接管，或地址栏已被改写：不能再回写这次的旧状态
  if (seq !== routeSeq || parseRoute()?.path !== r.path) return;
  syncRoute({ replace: true });
}
