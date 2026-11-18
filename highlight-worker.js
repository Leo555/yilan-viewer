/**
 * 语法高亮 Worker：大文件在后台线程高亮，避免阻塞页面。
 * 消息：{ id, text, lang, extra }  →  { id, html } 或 { id, error }
 */
/* global hljs */
importScripts('./vendor/hljs/highlight.min.js');

const loaded = new Set();

self.onmessage = (e) => {
  const { id, text, lang, extra } = e.data;
  try {
    if (extra && !hljs.getLanguage(lang) && !loaded.has(lang)) {
      loaded.add(lang);
      importScripts(`./vendor/hljs/languages/${lang}.min.js`);
    }
    if (!hljs.getLanguage(lang)) {
      self.postMessage({ id, html: null });
      return;
    }
    const html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    self.postMessage({ id, html });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
