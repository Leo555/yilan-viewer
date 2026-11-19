/** 通用工具：DOM、格式化、脚本加载、视图级资源回收 */

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
const escChar = (c) => ESC[c];
export const escapeHtml = (s) => String(s).replace(ESC_RE, escChar);

export function countLines(text) {
  if (!text) return 0;
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  if (text.endsWith('\n')) n--;
  return n;
}

let toastTimer = null;
export function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/** 加载经典脚本（UMD 库），同一地址只加载一次；已有全局变量时直接返回 */
const scripts = new Map();
export function loadScript(src, globalName) {
  if (globalName && globalThis[globalName]) return Promise.resolve();
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { scripts.delete(src); s.remove(); reject(new Error(`组件加载失败：${src}`)); };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src);
}

export function loadCss(href) {
  if (document.querySelector(`link[data-href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  l.dataset.href = href;
  document.head.appendChild(l);
}

/** 当前视图用到的 Object URL：切换文件时统一释放，避免内存泄漏 */
const viewUrls = new Set();
export function viewUrl(blob) {
  const u = URL.createObjectURL(blob);
  viewUrls.add(u);
  return u;
}
export function revokeViewUrls() {
  for (const u of viewUrls) URL.revokeObjectURL(u);
  viewUrls.clear();
}

export const idle = (fn) => (globalThis.requestIdleCallback ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 800));
