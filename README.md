# 一览

<img src="./favicon.svg" width="64" height="64" alt="一览" align="right" />

在浏览器里直接打开任何文件，一眼看清内容。PDF、EPUB、Office 文档、代码、文本、图片、音视频都能预览。文件只在本机浏览器中读取和渲染，**不会上传到任何服务器**。

## 支持的格式

| 类别 | 格式 | 说明 |
| --- | --- | --- |
| PDF | `.pdf` | pdf.js 渲染，可选中文字；支持查找、缩放、密码保护的文件，链接和批注可点击 |
| 电子书 | `.epub` | 分页阅读，宽屏时双页显示；有目录跳转，支持方向键翻页、调字号、深色主题 |
| Word | `.docx` | 转成 HTML 显示，保留标题、列表、表格、图片、粗体 / 斜体等 |
| 表格 | `.xlsx` `.xls` `.xlsb` `.ods` `.numbers` | 多工作表切换，列号 A/B/C，表头固定 |
| 演示文稿 | `.pptx` | 按页列出文字和图片（提纲方式，不还原版式和动画） |
| 代码 | 80 多种语言 | 语法高亮；按文件名和内容自动识别语言，也可手动切换 |
| 文本 | Markdown、CSV / TSV、JSON、日志、字幕等 | Markdown / CSV / JSON 可在「预览」和「源码」之间切换；文本编码自动识别 |
| 网页 | `.html` `.svg` | 放在隔离沙箱中渲染，不执行脚本 |
| 图片 | PNG、JPG、GIF、WebP、AVIF、BMP、ICO | 显示原始尺寸 |
| 音视频 | MP3、WAV、OGG、M4A、FLAC、MP4、WebM、MOV | 浏览器原生播放器，能否播放取决于浏览器支持的编码 |
| 字体 | TTF、OTF、WOFF、WOFF2 | 多字号示例，示例文字可编辑 |

## 功能

**打开方式**
- 拖入文件、文件夹或 zip 压缩包（压缩包在浏览器里解开，可以直接浏览里面的文件）
- 工具栏「打开文件」「打开文件夹」
- 直接 `⌘V` 粘贴代码、文本或文件；也可以在「粘贴文本」里填文件名，用来识别语言
- 自动跳过 `node_modules`、`.git`、`dist` 等目录
- 点击左上角的「一览」回到首页，已打开的文件列表会保留

**代码与文本**
- 常用的约 35 种语言随页面加载，其余语言（Dockerfile、Nginx、PowerShell、Protobuf、Scala、Dart、LaTeX 等）用到时再加载
- 行号：点击选中一行，Shift 点击选中一段，选中范围会写进链接；支持自动换行、调节字号
- 查找：可区分大小写、支持正则表达式；在 PDF、Word、表格、演示文稿里也能查找
- 大文件：超过 60KB 的文件在后台线程高亮，不会卡住页面；超过 1.5MB 不做高亮；只显示前 20 万行

**界面**
- 浅色 / 深色 / 跟随系统；侧边栏可以拖动调宽，也可以隐藏
- 快捷键：`⌘O` 打开文件，`⌘F` 查找，`⌘B` 显示 / 隐藏侧边栏，`⌘+` / `⌘−` 放大缩小（文档里是缩放），`⌥Z` 自动换行，`⌥↑` / `⌥↓` 切换文件

## 路由

使用 hash 路由，静态部署不需要服务端改写：

| 地址 | 含义 |
| --- | --- |
| `#/` | 首页 |
| `#/示例/代码/backend/main.go` | 打开文件（示例文件可以直接分享链接，会自动加载） |
| `#/示例/代码/web/index.html?mode=code` | 指定视图（`code` / `preview`，默认视图不写） |
| `#/示例/代码/backend/main.go?L=12-20` | 选中第 12～20 行 |
| `#/示例/文档/sample.pdf?at=3` | 文档位置：PDF 的页码、EPUB 的阅读位置、表格的第几个工作表 |
| `#/示例/代码/web` | 目录：打开其中的 README / index 等入口文件 |

切换文件会新增一条浏览器历史，可以用前进 / 后退在文件之间来回切换；切换视图、选中行、翻页只替换当前这条记录。本地打开的文件不会上传，刷新后需要重新打开。

## 安全

- Markdown、Word 转换出来的 HTML 经过 DOMPurify 净化，脚本和事件属性会被移除
- HTML / SVG 预览放在 `sandbox` iframe 中，不能执行脚本，也不能访问本页
- PDF 不执行文档里的 JavaScript，也不启用表单；EPUB 不执行书里的脚本
- 线上响应头带 CSP：只允许加载本站脚本；为了让 PDF 的图像解码器（WebAssembly）能运行，放开了 `wasm-unsafe-eval`
- 本地开发服务器使用与线上相同的 CSP

## 技术实现

- 原生 HTML / CSS / ES Modules，不需要构建
- 首屏不阻塞加载任何第三方库：highlight.js 在浏览器空闲时预热，Markdown（marked + DOMPurify）、zip（JSZip）在用到时才加载；PDF、EPUB、Word、表格的渲染库在第一次打开对应文件时才加载
- 源码视图每 200 行一块，用 CSS `content-visibility: auto` 跳过屏幕外内容的布局与绘制，20 万行的文件也能流畅滚动；后台高亮的 Worker 直接生成 HTML，主线程只负责插入
- 读取过的文件字节按 LRU 缓存（上限约 96MB），切换文件时释放上一个视图的 Object URL
- 依赖：[highlight.js](https://highlightjs.org/) 11.12.0、[marked](https://marked.js.org/) 18.2.1、[DOMPurify](https://github.com/cure53/DOMPurify) 3.4.18、[JSZip](https://stuk.github.io/jszip/) 3.10.1、[pdf.js](https://mozilla.github.io/pdf.js/) 6.5.438、[epub.js](https://github.com/futurepress/epub.js) 0.3.93、[mammoth](https://github.com/mwilliamson/mammoth.js) 1.13.0、[SheetJS](https://sheetjs.com/) 0.20.3
- 第三方库从 npm 发布包复制到 `vendor/`，随站点部署，不依赖 CDN；PDF 的 CMap（中日韩字体映射）、标准字体和 wasm 解码器也一起放在本地

### 代码结构

```
index.html            页面骨架
styles.css            样式
src/
  preboot.js          首帧前应用主题 / 字号 / 侧边栏宽度（避免闪烁）
  main.js             入口：打开文件、渲染调度、工具栏、事件绑定
  state.js            常量与全局状态、设置读写
  util.js             DOM / 格式化 / 脚本加载 / Object URL 回收
  libs.js             第三方库按需加载（highlight.js、marked、DOMPurify、JSZip）
  languages.js        语言与文件类型识别表（页面和 scripts/vendor.mjs 共用）
  detect.js           按内容识别语言
  files.js            文件列表：添加（文件 / 文件夹 / zip / 粘贴 / 示例）、索引、读取与解码
  tree.js             侧边栏文件树（事件委托）
  find.js             页内查找
  route.js            hash 路由
  code-html.js        源码分块 HTML 生成（主线程与 Worker 共用）
  highlight-worker.js 后台高亮 Worker
  docviewers.js       PDF / EPUB / Word / 表格 / 演示文稿 / 音视频 / 字体
  views/code.js       源码视图
  views/preview.js    图片、Markdown、CSV、HTML / SVG、JSON 树
```

### 升级依赖 / 增加语言

```bash
npm install
# 修改 package.json 中的版本或 src/languages.js 中的语言后：
npm run vendor   # 重新生成 vendor/
```

`node_modules/` 不提交；`vendor/` 需要提交。

### 示例文件

首页的「查看示例」会加载 `examples/` 下的示例，按「文档 / 代码 / 纯文本 / 图片、视频」四类组织（顺序由 `scripts/examples.mjs` 中的 `ORDER` 决定），点开某个文件时才去取它的内容。

```bash
npm run examples          # 增删示例后重新生成 examples/manifest.json
npm run examples:docs     # 重新生成 examples/文档/ 下的 PDF / EPUB / Word / Excel / PPT
npm run examples:media    # 重新生成 examples/图片、视频/ 下的 PNG / JPG / GIF / MP4 等（仅 macOS）
```

## 本地运行

```bash
cd yilan-viewer
npm run dev   # Node 静态服务器（零依赖，需要 Node 18+）
# 打开 http://localhost:4174；换端口：PORT=8080 npm run dev
```

## 部署

纯静态站点，可以直接部署到 Vercel。`vercel.json` 已关闭安装和构建步骤，并配置了安全响应头与缓存；`node_modules/`、`scripts/`、`package.json` 不会被部署。
