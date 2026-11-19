/** 按内容识别语言（文件名识别不了时使用） */
import { langById, AUTO_LANGS } from './languages.js';
import { countLines } from './util.js';
import { loadHljs } from './libs.js';

export async function autoDetect(text) {
  const sample = text.slice(0, 20000);
  const first = sample.split('\n', 1)[0];
  const shebang = /^#!\S*?(?:\/env\s+(?:-\S+\s+)*)?\/?(?:\S*\/)?(python|node|deno|bun|bash|sh|zsh|ksh|dash|ruby|perl|php|lua|Rscript)[\d.]*\b/.exec(first);
  if (shebang) {
    const m = { node: 'javascript', deno: 'typescript', bun: 'javascript', sh: 'bash', zsh: 'bash', ksh: 'bash', dash: 'bash', Rscript: 'r' }[shebang[1]] || shebang[1];
    if (langById(m)) return m;
  }
  if (/^\s*[[{]/.test(sample)) {
    try { JSON.parse(text); return 'json'; } catch { /* 不是 JSON */ }
  }
  if (/^\s*(<\?xml|<!doctype html|<html[\s>])/i.test(sample)) return 'xml';
  if (/^(diff --git|--- a\/|Index: )/m.test(sample.slice(0, 2000))) return 'diff';
  const head = sample.slice(0, 4000);
  const logLines = (head.match(/^\[?\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/gm) || []).length;
  if (logLines >= 2 && /\b(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\b/.test(head)) return 'log';
  // 少数几种语言有非常明确的标志，highlight.js 的打分区分不开时直接判断（短片段也适用）
  const sig = signatureLang(sample);
  if (sig) return sig;
  if (sample.trim().length < 20) return 'plaintext';
  // 大段自然语言（如中文）不当作代码
  const cjk = (sample.match(/[\u3400-\u9fff]/g) || []).length;
  const symbols = (sample.match(/[{}();=<>[\]]/g) || []).length;
  if (cjk > sample.length * 0.3 && symbols < sample.length * 0.02) return 'plaintext';
  try {
    const hljs = await loadHljs();
    // highlightAuto 要把样本在每种候选语言下各高亮一遍，样本取短一些
    const probe = sample.slice(0, 8000);
    const r = hljs.highlightAuto(probe, AUTO_LANGS);
    // 置信度按长度放宽：短代码片段的 relevance 天然偏低
    const need = countLines(probe) < 15 ? 5 : 8;
    const margin = (r.relevance || 0) - (r.secondBest?.relevance || 0);
    if (!r.language || r.relevance < need) return 'plaintext';
    if (margin >= 1) return r.language;
    // JS 与 TS 打分常常相同：没有类型标注时按 JavaScript 处理
    const pair = [r.language, r.secondBest?.language].sort().join(',');
    if (pair === 'javascript,typescript') {
      return /:\s*(string|number|boolean|any|void|unknown|never)\b|\binterface\s+\w+|\btype\s+\w+\s*=|<\w+>\(/.test(probe) ? 'typescript' : 'javascript';
    }
    return 'plaintext';
  } catch {
    return 'plaintext';
  }
}

function signatureLang(s) {
  const head = s.slice(0, 6000);
  if (/^\s*package\s+[a-z_]\w*\s*$/m.test(head) && /\bfunc\s+(\(\w+\s+\*?\w+\)\s*)?\w+\s*\(/.test(head)) return 'go';
  if (/^\s*package\s+[\w.]+;\s*$/m.test(head) || /\bpublic\s+static\s+void\s+main\s*\(\s*String/.test(head)
    || (/\b(public|private|protected)\s+(final\s+)?class\s+\w+/.test(head) && /System\.out\.|@Override|import\s+java\./.test(head))) return 'java';
  if (/^\s*using\s+System(\.\w+)*;\s*$/m.test(head) || (/\bnamespace\s+[\w.]+\s*[{;]/.test(head) && /\bpublic\s+(class|record|interface)\b/.test(head))) return 'csharp';
  if (/^\s*<\?php\b/.test(head)) return 'php';
  if (/^\s*#include\s*<(iostream|vector|string|map|memory|algorithm)>/m.test(head) || /\bstd::\w+/.test(head)) return 'cpp';
  if (/^\s*#include\s*[<"][\w/.]+\.h[>"]/m.test(head) && !/\b(class|template|namespace)\b/.test(head)) return 'c';
  if (/^\s*fun\s+main\s*\(/m.test(head) || (/^\s*(data\s+class|object)\s+\w+/m.test(head) && /\bval\s+\w+/.test(head))) return 'kotlin';
  if (/^\s*import\s+(SwiftUI|UIKit|Foundation)\s*$/m.test(head)) return 'swift';
  // Python：def/class 行以冒号结尾，且有缩进块
  if (/^\s*(async\s+)?def\s+\w+\s*\(.*\)\s*(->\s*[^:]+)?:\s*$/m.test(head) || /^\s*from\s+[\w.]+\s+import\s+\w/m.test(head)
    || (/^\s*(if|for|while|elif|else|try|except|with)\b.*:\s*$/m.test(head) && /^\s*(print|import|return)\b/m.test(head) && !/[{};]\s*$/m.test(head))) return 'python';
  return null;
}
