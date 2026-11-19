# 示例

这里收集了各类文件的小样例，用来体验「一览」的预览能力。

> 提示：Markdown、CSV、JSON、HTML、SVG 文件可以在工具栏切换「预览 / 源码」。

## 分类

| 目录 | 内容 |
| --- | --- |
| `documents/` | PDF、EPUB、Word、Excel、PPT、iWork（Pages / Numbers）、邮件（.eml，含 HTML 正文、内嵌图片与附件） |
| `code/` | 按用途再分：`web/` 前端、`backend/` 服务端、`native/` 客户端与系统、`functional/` 函数式、`scripts/` 脚本、`data/` 数据库与接口、`config/` 配置文件，共 40 多种语言 |
| `text/` | Markdown、JSON / JSON Lines、CSV（逗号 / 分号，含引号内换行）、TSV、日志（应用日志 / 访问日志）、Diff、字幕（SRT / WebVTT）、LaTeX / BibTeX、无扩展名文件（CHANGELOG）、GBK 与 UTF-16 编码的文本 |
| `media/` | `images/`：PNG、JPEG、WebP、AVIF、GIF / APNG / WebP 动图、SVG、BMP、ICO、TIFF（仅 Safari）<br>`videos/`：MP4（H.264 / AV1）、M4V、MOV、WebM（VP9）<br>`audio/`：MP3、M4A、OGG、Opus、WAV、FLAC |
| `fonts/` | TTF（霞鹜文楷子集、Liberation Sans、Inter Bold）、可变字体（Roboto Flex，可拖动字重轴）、OTF（Inter Italic、Source Serif 4、Source Code Pro，CFF 轮廓）、WOFF、WOFF2、EOT、TTC 字体集合；均为 OFL 开源字体，许可见 `LICENSE-OFL.txt` |
| `misc/` | Jupyter 笔记本（.ipynb）、日历（.ics）、联系人（.vcf，虚构数据）、自签名演示证书（.pem / .der）、Keynote（.key）、压缩包（.tar.gz，点开后可解压浏览）、漫画（.cbz） |

## 快捷键

- <kbd>⌘F</kbd> 查找，支持正则与区分大小写（PDF、Word、表格里也能用）
- <kbd>⌥Z</kbd> 切换自动换行
- <kbd>⌘B</kbd> 显示 / 隐藏侧边栏
- <kbd>⌘+</kbd> / <kbd>⌘−</kbd> 调整字号；在文档里是缩放

## 待办

- [x] 语法高亮
- [x] Markdown / CSV / JSON 预览
- [x] PDF / EPUB / Office 预览
- [ ] 更多示例

```js
// 代码块同样会高亮
const greet = (name) => `你好，${name}！`;
console.log(greet('世界'));
```
