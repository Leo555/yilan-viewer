/**
 * 语言与文件类型识别表（页面与 scripts/vendor.mjs 共用）。
 * - extra: true 表示不在 highlight.js 主包内，需要从 vendor/hljs/languages/ 按需加载
 * - ext:   扩展名（小写，不含点）
 * - files: 完整文件名（不区分大小写）
 */
export const LANGS = [
  { id: 'plaintext', name: '纯文本', ext: ['txt', 'text', 'csv', 'tsv', 'tab', 'srt', 'vtt', 'sub', 'nfo', 'asc'],
    files: ['license', 'licence', 'copying', 'authors', 'contributors', 'notice', 'changelog', 'changes', 'history',
      'todo', 'readme', 'codeowners', '.gitignore', '.dockerignore', '.npmignore', '.eslintignore', '.prettierignore',
      '.gitattributes', '.gitmodules', '.nvmrc', '.node-version', '.python-version', '.ruby-version', 'go.sum',
      'requirements.txt', 'yarn.lock', 'pnpm-lock.yaml'] },
  { id: 'log', name: '日志', ext: ['log', 'out', 'err', 'logs'] },

  { id: 'javascript', name: 'JavaScript', ext: ['js', 'mjs', 'cjs', 'jsx'] },
  { id: 'typescript', name: 'TypeScript', ext: ['ts', 'mts', 'cts', 'tsx'] },
  { id: 'json', name: 'JSON', ext: ['json', 'jsonc', 'json5', 'jsonl', 'ndjson', 'geojson', 'webmanifest', 'har', 'ipynb', 'map'],
    files: ['.babelrc', '.eslintrc', '.prettierrc', '.jshintrc', '.swcrc', 'composer.lock', 'flake.lock'] },
  { id: 'xml', name: 'HTML / XML', ext: ['html', 'htm', 'xhtml', 'xml', 'svg', 'vue', 'svelte', 'astro', 'plist', 'xsd', 'xsl',
    'xslt', 'wsdl', 'rss', 'atom', 'opf', 'ncx', 'csproj', 'vbproj', 'fsproj', 'vcxproj', 'props', 'targets', 'resx',
    'storyboard', 'xib', 'xaml', 'kml', 'gpx', 'pom'] },
  { id: 'css', name: 'CSS', ext: ['css'] },
  { id: 'scss', name: 'SCSS', ext: ['scss', 'sass'] },
  { id: 'less', name: 'Less', ext: ['less'] },
  { id: 'markdown', name: 'Markdown', ext: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'rmd'] },
  { id: 'yaml', name: 'YAML', ext: ['yml', 'yaml'], files: ['.clang-format', '.clang-tidy'] },
  { id: 'ini', name: 'INI / TOML / .env', ext: ['ini', 'cfg', 'conf', 'toml', 'env', 'cnf', 'reg', 'desktop', 'service'],
    files: ['.editorconfig', '.gitconfig', '.npmrc', '.yarnrc', '.env', '.flake8', '.pylintrc', '.coveragerc',
      'setup.cfg', 'tox.ini', 'pip.conf', 'my.cnf', 'cargo.lock', 'pipfile', 'poetry.lock'] },
  { id: 'python', name: 'Python', ext: ['py', 'pyw', 'pyi', 'pyx', 'pxd', 'bzl', 'gyp', 'gypi'],
    files: ['build', 'build.bazel', 'workspace', 'workspace.bazel', 'sconstruct', 'sconscript', 'snakefile'] },
  { id: 'java', name: 'Java', ext: ['java', 'jav'] },
  { id: 'kotlin', name: 'Kotlin', ext: ['kt', 'kts', 'ktm'] },
  { id: 'go', name: 'Go', ext: ['go'], files: ['go.mod', 'go.work'] },
  { id: 'rust', name: 'Rust', ext: ['rs'] },
  { id: 'c', name: 'C', ext: ['c', 'h'] },
  { id: 'cpp', name: 'C++', ext: ['cc', 'cpp', 'cxx', 'c++', 'hpp', 'hh', 'hxx', 'h++', 'ino', 'ipp', 'tpp', 'cu', 'cuh'] },
  { id: 'csharp', name: 'C#', ext: ['cs', 'csx', 'cake'] },
  { id: 'objectivec', name: 'Objective-C', ext: ['m', 'mm'] },
  { id: 'swift', name: 'Swift', ext: ['swift'] },
  { id: 'php', name: 'PHP', ext: ['php', 'phtml', 'php3', 'php4', 'php5', 'phps'] },
  { id: 'ruby', name: 'Ruby', ext: ['rb', 'rbw', 'rake', 'gemspec', 'ru', 'podspec', 'jbuilder'],
    files: ['gemfile', 'rakefile', 'podfile', 'vagrantfile', 'brewfile', 'fastfile', 'guardfile', 'capfile', 'appfile'] },
  { id: 'perl', name: 'Perl', ext: ['pl', 'pm', 'pod', 'psgi'] },
  { id: 'lua', name: 'Lua', ext: ['lua', 'rockspec'] },
  { id: 'r', name: 'R', ext: ['r'] },
  { id: 'sql', name: 'SQL', ext: ['sql', 'psql', 'pgsql', 'mysql', 'ddl', 'dml', 'hql', 'cql', 'prc'] },
  { id: 'bash', name: 'Shell / Bash', ext: ['sh', 'bash', 'zsh', 'ksh', 'command', 'tool'],
    files: ['.bashrc', '.bash_profile', '.bash_logout', '.zshrc', '.zprofile', '.zshenv', '.profile', '.envrc', 'pkgbuild', 'procfile'] },
  { id: 'shell', name: 'Shell 会话', ext: ['console', 'shell-session'] },
  { id: 'makefile', name: 'Makefile', ext: ['mk', 'mak', 'make'], files: ['makefile', 'gnumakefile', 'bsdmakefile'] },
  { id: 'diff', name: 'Diff / Patch', ext: ['diff', 'patch', 'rej'] },
  { id: 'graphql', name: 'GraphQL', ext: ['graphql', 'gql', 'graphqls'] },
  { id: 'vbnet', name: 'VB.NET', ext: ['vb'] },
  { id: 'wasm', name: 'WebAssembly', ext: ['wat', 'wast'] },

  { id: 'dockerfile', name: 'Dockerfile', ext: ['dockerfile'], files: ['dockerfile', 'containerfile'], extra: true },
  { id: 'nginx', name: 'Nginx', files: ['nginx.conf', 'mime.types'], ext: ['nginx'], extra: true },
  { id: 'apache', name: 'Apache', files: ['.htaccess', 'httpd.conf', 'apache.conf', 'apache2.conf'], extra: true },
  { id: 'powershell', name: 'PowerShell', ext: ['ps1', 'psm1', 'psd1'], extra: true },
  { id: 'dos', name: 'Windows 批处理', ext: ['bat', 'cmd'], extra: true },
  { id: 'protobuf', name: 'Protocol Buffers', ext: ['proto'], extra: true },
  { id: 'scala', name: 'Scala', ext: ['scala', 'sc', 'sbt'], extra: true },
  { id: 'dart', name: 'Dart', ext: ['dart'], extra: true },
  { id: 'groovy', name: 'Groovy', ext: ['groovy', 'gvy', 'gy', 'gsh'], files: ['jenkinsfile'], extra: true },
  { id: 'gradle', name: 'Gradle', ext: ['gradle'], extra: true },
  { id: 'cmake', name: 'CMake', ext: ['cmake'], files: ['cmakelists.txt'], extra: true },
  { id: 'vim', name: 'Vim Script', ext: ['vim'], files: ['.vimrc', '.gvimrc', '_vimrc'], extra: true },
  { id: 'elixir', name: 'Elixir', ext: ['ex', 'exs'], extra: true },
  { id: 'erlang', name: 'Erlang', ext: ['erl', 'hrl'], extra: true },
  { id: 'haskell', name: 'Haskell', ext: ['hs', 'lhs'], extra: true },
  { id: 'clojure', name: 'Clojure', ext: ['clj', 'cljs', 'cljc', 'edn'], extra: true },
  { id: 'ocaml', name: 'OCaml', ext: ['ml', 'mli'], extra: true },
  { id: 'fsharp', name: 'F#', ext: ['fs', 'fsi', 'fsx'], extra: true },
  { id: 'julia', name: 'Julia', ext: ['jl'], extra: true },
  { id: 'matlab', name: 'MATLAB', extra: true },
  { id: 'latex', name: 'LaTeX', ext: ['tex', 'sty', 'cls', 'ltx', 'bib'], extra: true },
  { id: 'properties', name: 'Properties', ext: ['properties'], extra: true },
  { id: 'http', name: 'HTTP', ext: ['http', 'rest'], extra: true },
  { id: 'dns', name: 'DNS Zone', ext: ['zone'], extra: true },
  { id: 'accesslog', name: '访问日志', extra: true },
  { id: 'awk', name: 'Awk', ext: ['awk'], extra: true },
  { id: 'tcl', name: 'Tcl', ext: ['tcl'], extra: true },
  { id: 'vbscript', name: 'VBScript', ext: ['vbs'], extra: true },
  { id: 'scheme', name: 'Scheme', ext: ['scm', 'ss'], extra: true },
  { id: 'elm', name: 'Elm', ext: ['elm'], extra: true },
  { id: 'coffeescript', name: 'CoffeeScript', ext: ['coffee', 'cson'], extra: true },
  { id: 'handlebars', name: 'Handlebars', ext: ['hbs', 'handlebars', 'mustache'], extra: true },
  { id: 'twig', name: 'Twig', ext: ['twig'], extra: true },
  { id: 'django', name: 'Jinja / Django 模板', ext: ['j2', 'jinja', 'jinja2', 'djhtml'], extra: true },
  { id: 'haml', name: 'Haml', ext: ['haml'], extra: true },
  { id: 'stylus', name: 'Stylus', ext: ['styl'], extra: true },
  { id: 'verilog', name: 'Verilog', ext: ['v', 'sv', 'svh', 'vh'], extra: true },
  { id: 'vhdl', name: 'VHDL', ext: ['vhd', 'vhdl'], extra: true },
  { id: 'x86asm', name: 'x86 汇编', ext: ['asm', 'nasm'], extra: true },
  { id: 'llvm', name: 'LLVM IR', ext: ['ll'], extra: true },
  { id: 'fortran', name: 'Fortran', ext: ['f', 'f77', 'f90', 'f95', 'f03', 'f08', 'for'], extra: true },
  { id: 'delphi', name: 'Pascal / Delphi', ext: ['pas', 'dpr', 'lpr'], extra: true },
  { id: 'nim', name: 'Nim', ext: ['nim', 'nims'], extra: true },
  { id: 'crystal', name: 'Crystal', ext: ['cr'], extra: true },
  { id: 'reasonml', name: 'ReasonML', ext: ['re', 'rei'], extra: true },
];

const byId = new Map(LANGS.map((l) => [l.id, l]));
const byExt = new Map();
const byFile = new Map();
for (const l of LANGS) {
  for (const e of l.ext || []) if (!byExt.has(e)) byExt.set(e, l.id);
  for (const f of l.files || []) byFile.set(f, l.id);
}

export const langById = (id) => byId.get(id) || null;

export function extOf(path) {
  const name = baseName(path).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

export function baseName(path) {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/** 按文件名识别语言；识别不了返回 null（交给内容自动识别） */
export function detectLang(path) {
  const name = baseName(path);
  const lower = name.toLowerCase();
  if (byFile.has(lower)) return byFile.get(lower);
  if (/^(docker|container)file[.-]/.test(lower)) return 'dockerfile';
  if (/^\.env(\.|$)/.test(lower)) return 'ini';
  if (/^(jenkinsfile)[.-]/.test(lower)) return 'groovy';
  if (/^(makefile|gnumakefile)\./.test(lower)) return 'makefile';
  const ext = extOf(lower);
  if (ext && byExt.has(ext)) return byExt.get(ext);
  if (/^\.?(\w+)rc$/.test(lower)) return 'bash';
  if (/^(readme|license|licence|changelog|changes|authors|notice|copying|todo)\b/.test(lower)) return 'plaintext';
  return null;
}

export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico']);

/** 文档 / 媒体类：不按文本读取，由专门的渲染器预览 */
const DOC_EXT = {
  pdf: ['pdf'],
  epub: ['epub'],
  docx: ['docx', 'docm', 'dotx'],
  sheet: ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'numbers'],
  pptx: ['pptx', 'pptm', 'ppsx', 'potx'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'],
  video: ['mp4', 'm4v', 'webm', 'ogv', 'mov'],
  font: ['ttf', 'otf', 'woff', 'woff2'],
};
const docByExt = new Map(Object.entries(DOC_EXT).flatMap(([k, list]) => list.map((e) => [e, k])));
export const DOC_KINDS = new Set(Object.keys(DOC_EXT));

/** 文件除了源码外还支持的预览方式 */
export function viewKind(path) {
  const ext = extOf(path);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (docByExt.has(ext)) return docByExt.get(ext);
  if (['md', 'markdown', 'mdown', 'mkd', 'mdx'].includes(ext)) return 'markdown';
  if (ext === 'csv') return 'csv';
  if (ext === 'tsv' || ext === 'tab') return 'tsv';
  if (['html', 'htm', 'xhtml'].includes(ext)) return 'html';
  if (ext === 'svg') return 'svg';
  if (['json', 'geojson', 'webmanifest', 'har', 'ipynb', 'map'].includes(ext)) return 'json';
  return 'code';
}

/** 内容自动识别时参与比较的语言（太多会慢且易误判） */
export const AUTO_LANGS = ['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'c', 'cpp', 'csharp', 'php',
  'ruby', 'bash', 'json', 'yaml', 'xml', 'css', 'scss', 'sql', 'markdown', 'ini', 'kotlin', 'swift', 'lua', 'perl',
  'diff', 'makefile', 'objectivec'];
