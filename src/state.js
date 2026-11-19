/** 全局常量与状态 */
import { clamp } from './util.js';

export const APP_NAME = '一览';
export const EXAMPLES_ROOT = 'examples';

export const MAX_HIGHLIGHT = 1.5 * 1024 * 1024; // 超过这个大小的文本不做语法高亮，避免卡顿
export const WORKER_THRESHOLD = 60 * 1024; // 超过这个大小在后台线程高亮
export const MAX_TEXT = 30 * 1024 * 1024; // 超过这个大小不读取内容
export const MAX_DOC = 200 * 1024 * 1024; // 文档类文件的大小上限
export const MAX_RENDER_LINES = 200000;
export const MAX_CSV_ROWS = 5000;
export const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'dist', 'build', '.next', '.nuxt', 'target', '.gradle', 'Pods', '.DS_Store']);
export const SIZES = [11, 12, 13, 14, 15, 16, 18, 20];
export const PREVIEW_KINDS = ['markdown', 'csv', 'tsv', 'html', 'svg', 'json', 'notebook', 'email', 'calendar', 'contacts', 'pem'];

function loadSettings() {
  const def = { theme: 'auto', size: 13, wrap: false, sideW: 260, sideHidden: false };
  try {
    const s = { ...def, ...JSON.parse(localStorage.getItem('cv.settings') || '{}') };
    if (!['auto', 'light', 'dark'].includes(s.theme)) s.theme = 'auto';
    if (!SIZES.includes(s.size)) s.size = 13;
    s.sideW = clamp(Number(s.sideW) || 260, 180, 600);
    return s;
  } catch {
    return def;
  }
}

export function saveSettings() {
  try { localStorage.setItem('cv.settings', JSON.stringify(state.settings)); } catch { /* 隐私模式 */ }
}

export const state = {
  files: [], // { id, path, size, mtime, getBlob, example?, lang?, pasted? }
  activeId: null,
  current: null, // { file, kind, text, lang, mode, defaultMode, encoding, doc?, at? ... }
  docCtl: null, // 文档渲染器返回的控制器
  openToken: 0, // 每次打开 / 移除文件自增，用来丢弃过期的异步结果
  settings: loadSettings(),
  openDirs: new Set(),
  dirOrder: new Map(), // 目录路径 → 子目录的显示顺序
  closedGroups: new Set(), // 侧边栏中收起的分组（mine / example）
  selLines: null, // [起始行, 结束行]
  find: { query: '', caseSensitive: false, regex: false, marks: [], index: -1 },
};
