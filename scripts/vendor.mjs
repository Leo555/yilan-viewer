/**
 * 把 node_modules 中的第三方库复制到 vendor/，页面直接从本站加载，不依赖 CDN。
 * 用法：npm install && npm run vendor
 */
import { copyFileSync, cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS } from '../src/languages.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HLJS = 'node_modules/@highlightjs/cdn-assets';
const PDFJS = 'node_modules/pdfjs-dist';
const THEMES = ['github', 'github-dark'];

const files = [
  [`${HLJS}/highlight.min.js`, 'vendor/hljs/highlight.min.js'],
  [`${HLJS}/LICENSE`, 'vendor/hljs/LICENSE'],
  ...THEMES.map((t) => [`${HLJS}/styles/${t}.min.css`, `vendor/hljs/styles/${t}.min.css`]),
  ...LANGS.filter((l) => l.extra).map((l) => [`${HLJS}/languages/${l.id}.min.js`, `vendor/hljs/languages/${l.id}.min.js`]),
  ['node_modules/marked/lib/marked.umd.js', 'vendor/marked/marked.umd.js'],
  ['node_modules/marked/LICENSE', 'vendor/marked/LICENSE'],
  ['node_modules/dompurify/dist/purify.min.js', 'vendor/dompurify/purify.min.js'],
  ['node_modules/dompurify/LICENSE', 'vendor/dompurify/LICENSE'],
  ['node_modules/jszip/dist/jszip.min.js', 'vendor/jszip/jszip.min.js'],
  ['node_modules/jszip/LICENSE.markdown', 'vendor/jszip/LICENSE.md'],
  // 以下按需加载：打开对应类型的文件时才会请求
  [`${PDFJS}/build/pdf.min.mjs`, 'vendor/pdfjs/pdf.min.mjs'],
  [`${PDFJS}/build/pdf.worker.min.mjs`, 'vendor/pdfjs/pdf.worker.min.mjs'],
  [`${PDFJS}/web/pdf_viewer.mjs`, 'vendor/pdfjs/pdf_viewer.mjs'],
  [`${PDFJS}/web/pdf_viewer.css`, 'vendor/pdfjs/pdf_viewer.css'],
  [`${PDFJS}/LICENSE`, 'vendor/pdfjs/LICENSE'],
  ['node_modules/epubjs/dist/epub.min.js', 'vendor/epubjs/epub.min.js'],
  ['node_modules/epubjs/license', 'vendor/epubjs/LICENSE'],
  ['node_modules/mammoth/mammoth.browser.min.js', 'vendor/mammoth/mammoth.browser.min.js'],
  ['node_modules/mammoth/LICENSE', 'vendor/mammoth/LICENSE'],
  ['node_modules/xlsx/dist/xlsx.full.min.js', 'vendor/xlsx/xlsx.full.min.js'],
  ['node_modules/xlsx/LICENSE', 'vendor/xlsx/LICENSE'],
];

// 整个目录复制：PDF 的中日韩字符映射、标准字体、图像解码 wasm、色彩配置、批注图标
const dirs = [
  [`${PDFJS}/cmaps`, 'vendor/pdfjs/cmaps'],
  [`${PDFJS}/standard_fonts`, 'vendor/pdfjs/standard_fonts'],
  [`${PDFJS}/wasm`, 'vendor/pdfjs/wasm'],
  [`${PDFJS}/iccs`, 'vendor/pdfjs/iccs'],
  [`${PDFJS}/web/images`, 'vendor/pdfjs/images'],
];

const missing = [...files, ...dirs].filter(([from]) => !existsSync(join(root, from)));
if (missing.length) {
  console.error('缺少以下文件，请先运行 npm install：\n' + missing.map(([f]) => '  ' + f).join('\n'));
  process.exit(1);
}

rmSync(join(root, 'vendor'), { recursive: true, force: true });
for (const [from, to] of files) {
  const dest = join(root, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(root, from), dest);
}
for (const [from, to] of dirs) cpSync(join(root, from), join(root, to), { recursive: true });
console.log(`已复制 ${files.length} 个文件、${dirs.length} 个目录到 vendor/`);
