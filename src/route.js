/**
 * hash 路由，静态部署无需服务端改写：
 *   #/                                  欢迎页
 *   #/示例/代码/backend/main.go          打开文件
 *   #/示例/代码/web/index.html?mode=code 指定视图（code / preview，默认值不写）
 *   #/示例/代码/backend/main.go?L=12-20  选中行（单行写 L=12）
 *   #/示例/文档/sample.pdf?at=3          文档位置
 *   #/示例/代码/backend                  目录：打开其中第一个文件
 * 示例文件可直接通过链接分享；本地文件只在当前会话内有效，刷新后无法恢复。
 */
import { state } from './state.js';

let routing = false; // 正在按地址栏恢复状态时不回写历史

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
  const r = parseRoute();
  if (!r) return;
  routing = true;
  try {
    await restore(r);
  } finally {
    routing = false;
  }
  syncRoute({ replace: true });
}
