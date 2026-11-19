/**
 * 语法高亮 Worker：大文件在后台线程高亮并生成分块 HTML，主线程只需插入 DOM。
 * 消息：{ id, text, lang, extra, maxLines }  →  { id, html, shown, total } 或 { id, html: null } / { id, error }
 */
/* global hljs, YilanCode */
importScripts('../vendor/hljs/highlight.min.js', './code-html.js');

const loaded = new Set();

self.onmessage = (e) => {
  const { id, text, lang, extra, maxLines } = e.data;
  try {
    if (extra && !hljs.getLanguage(lang) && !loaded.has(lang)) {
      loaded.add(lang);
      importScripts(`../vendor/hljs/languages/${lang}.min.js`);
    }
    if (!hljs.getLanguage(lang)) {
      self.postMessage({ id, html: null });
      return;
    }
    const lines = YilanCode.splitHighlighted(hljs.highlight(text, { language: lang, ignoreIllegals: true }).value);
    const shown = Math.min(lines.length, maxLines);
    self.postMessage({ id, html: YilanCode.buildChunks(lines, shown), shown, total: lines.length });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
