/**
 * 源码视图的 HTML 生成：主线程（ES Module 方式引入）与高亮 Worker（importScripts）共用。
 * 因为要同时作为经典脚本运行，这里不使用 import / export，结果挂在 globalThis.YilanCode 上。
 *
 * 结构：每 CHUNK 行包成一个 .code-chunk，配合 CSS content-visibility: auto，
 * 屏幕外的块不参与布局和绘制，几十万行的文件也能很快显示、滚动流畅。
 */
(function (g) {
  'use strict';

  var CHUNK = 200;

  /**
   * 把高亮后的 HTML 按行切开，并在行尾关闭、行首重新打开跨行的 <span>，
   * 这样多行注释、多行字符串逐行显示时也能保持正确颜色。
   */
  function splitHighlighted(html) {
    var out = [];
    var open = [];
    var line = '';
    var re = /<span[^>]*>|<\/span>|\n|[^<\n]+|</g;
    var m;
    while ((m = re.exec(html))) {
      var tok = m[0];
      if (tok === '\n') {
        out.push(line.replace(/\r$/, '') + '</span>'.repeat(open.length));
        line = open.join('');
      } else if (tok.charCodeAt(0) === 60 /* < */ && tok.startsWith('<span')) {
        open.push(tok);
        line += tok;
      } else if (tok === '</span>') {
        open.pop();
        line += tok;
      } else {
        line += tok;
      }
    }
    if (line !== open.join('') || !out.length) out.push(line + '</span>'.repeat(open.length));
    if (out.length > 1 && /^(<span[^>]*>)*(<\/span>)*$/.test(out[out.length - 1])) out.pop(); // 末尾换行不产生空行
    return out;
  }

  /** 没有高亮标签的文本（已转义）：直接按换行切分，比逐个标记扫描快得多 */
  function plainLines(escaped) {
    var lines = escaped.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i];
      if (s.charCodeAt(s.length - 1) === 13) lines[i] = s.slice(0, -1);
    }
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  /** 生成前 count 行的分块 HTML */
  function buildChunks(lines, count) {
    var n = Math.min(count, lines.length);
    var parts = [];
    for (var i = 0; i < n; i += CHUNK) {
      var end = Math.min(i + CHUNK, n);
      parts.push(end - i === CHUNK ? '<div class="code-chunk">' : '<div class="code-chunk" style="--chunk-lines:' + (end - i) + '">');
      for (var j = i; j < end; j++) {
        parts.push('<div class="line" id="L' + (j + 1) + '"><span class="ln" data-n="' + (j + 1) + '"></span><span class="lc">' + (lines[j] || ' ') + '</span></div>');
      }
      parts.push('</div>');
    }
    return parts.join('');
  }

  g.YilanCode = { CHUNK: CHUNK, splitHighlighted: splitHighlighted, plainLines: plainLines, buildChunks: buildChunks };
})(globalThis);
