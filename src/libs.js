/**
 * 第三方库按需加载：首屏不阻塞任何脚本，用到时才请求（浏览器空闲时预热 highlight.js）。
 */
import { loadScript } from './util.js';
import { langById } from './languages.js';

const V = './vendor';

let hljsReady = null;
export function loadHljs() {
  hljsReady ||= loadScript(`${V}/hljs/highlight.min.js`, 'hljs')
    .then(() => { globalThis.hljs.configure({ ignoreUnescapedHTML: true }); return globalThis.hljs; })
    .catch((err) => { hljsReady = null; throw err; });
  return hljsReady;
}

export const loadPurify = () => loadScript(`${V}/dompurify/purify.min.js`, 'DOMPurify').then(() => globalThis.DOMPurify);
export const loadJSZip = () => loadScript(`${V}/jszip/jszip.min.js`, 'JSZip').then(() => globalThis.JSZip);
export const loadMarkdown = () => Promise.all([
  loadScript(`${V}/marked/marked.umd.js`, 'marked'),
  loadPurify(),
  loadHljs(),
]).then(() => ({ marked: globalThis.marked, DOMPurify: globalThis.DOMPurify, hljs: globalThis.hljs }));

/** 主包没有的语言，按需从 vendor/hljs/languages 加载；返回该语言是否可用 */
const langLoads = new Map();
export async function ensureLanguage(id) {
  const hljs = await loadHljs();
  const lang = langById(id);
  if (!lang || !lang.extra || hljs.getLanguage(id)) return !!hljs.getLanguage(id);
  if (!langLoads.has(id)) {
    langLoads.set(id, loadScript(`${V}/hljs/languages/${id}.min.js`).then(() => !!hljs.getLanguage(id), () => false));
  }
  return langLoads.get(id);
}
