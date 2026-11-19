// 生成「其他」类示例：Jupyter / 邮件 / 日历 / 联系人 / 证书 / tar.gz / 漫画 / iWork，写入 examples/其他/
// 用法：npm run examples:misc
// 证书由脚本即时生成（自签名，仅作演示），不包含任何真实私钥；联系人、邮件均为虚构数据。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const root = fileURLToPath(new URL('../examples/', import.meta.url));
const out = join(root, '其他');
mkdirSync(out, { recursive: true });
const write = (name, data) => { writeFileSync(join(out, name), data); console.log(`  ${name}`); };

/* ---------- Jupyter：含 Markdown、代码、文本输出、表格（HTML）、PNG 图表、报错 ---------- */
function chartPng() {
  // 用 macOS 自带的 sips 太绕；直接复用示例里的图片当作「图表输出」
  const p = join(root, '图片、音视频', '图片', 'sunset-small.jpeg');
  return existsSync(p) ? ['image/jpeg', readFileSync(p).toString('base64')] : null;
}
const img = chartPng();
const nb = {
  nbformat: 4, nbformat_minor: 5,
  metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' }, language_info: { name: 'python', version: '3.12.4' } },
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# 销售数据分析\n', '\n', '本笔记演示 **一览** 对 `.ipynb` 的预览：Markdown、代码高亮、文本 / 表格 / 图片输出与报错信息。\n', '\n', '- 数据来源：示例数据\n', '- 公式：$\\bar{x} = \\frac{1}{n}\\sum x_i$'] },
    { cell_type: 'code', execution_count: 1, metadata: {}, source: ['import pandas as pd\n', '\n', "df = pd.DataFrame({'月份': ['1月', '2月', '3月'], '收入': [1280, 1460, 1530]})\n", "print(f'共 {len(df)} 行，平均收入 {df.收入.mean():.1f}')"],
      outputs: [{ output_type: 'stream', name: 'stdout', text: ['共 3 行，平均收入 1423.3\n'] }] },
    { cell_type: 'code', execution_count: 2, metadata: {}, source: ['df'],
      outputs: [{ output_type: 'execute_result', execution_count: 2, metadata: {}, data: {
        'text/plain': ['  月份    收入\n0  1月  1280\n1  2月  1460\n2  3月  1530'],
        'text/html': ['<table class="dataframe"><thead><tr><th></th><th>月份</th><th>收入</th></tr></thead><tbody>',
          '<tr><th>0</th><td>1月</td><td>1280</td></tr><tr><th>1</th><td>2月</td><td>1460</td></tr><tr><th>2</th><td>3月</td><td>1530</td></tr></tbody></table>'] } }] },
    ...(img ? [{ cell_type: 'code', execution_count: 3, metadata: {}, source: ["df.plot(x='月份', y='收入', kind='bar')"],
      outputs: [{ output_type: 'display_data', metadata: {}, data: { [img[0]]: img[1], 'text/plain': ['<Figure size 640x360>'] } }] }] : []),
    { cell_type: 'code', execution_count: 4, metadata: {}, source: ["df['利润'].sum()"],
      outputs: [{ output_type: 'error', ename: 'KeyError', evalue: "'利润'", traceback: ['\u001b[0;31mKeyError\u001b[0m: \'利润\'', '  File "<ipython-input-4>", line 1, in <module>'] }] },
    { cell_type: 'markdown', metadata: {}, source: ['## 结论\n', '\n', '收入逐月上升，3 月环比增长 **4.8%**。'] },
  ],
};
write('analysis.ipynb', `${JSON.stringify(nb, null, 1)}\n`);

/* ---------- 邮件：multipart/alternative（纯文本 + HTML）+ 内嵌图片（cid）+ 附件，标题用 RFC 2047 编码 ---------- */
const b64 = (s) => Buffer.from(s).toString('base64').replace(/.{76}/g, '$&\r\n');
const enc = (s) => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
// quoted-printable：按 =XX 整体折行（每行 ≤ 76 字符，软换行 = 不能落在转义序列中间）
const qp = (s) => s.split('\n').map((line) => {
  const tokens = [...Buffer.from(line)].map((b) => (b >= 0x20 && b <= 0x7e && b !== 0x3d ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, '0')}`));
  const rows = [''];
  for (const t of tokens) {
    if (rows[rows.length - 1].length + t.length > 75) rows.push('');
    rows[rows.length - 1] += t;
  }
  return rows.join('=\r\n');
}).join('\r\n');
const logo = readFileSync(join(root, '..', 'icon.svg'));
const eml = [
  `From: ${enc('张三')} <zhangsan@example.com>`,
  `To: ${enc('李四')} <lisi@example.com>, team@example.com`,
  `Cc: boss@example.com`,
  `Subject: ${enc('【周报】第 46 周项目进展')}`,
  'Date: Tue, 18 Nov 2026 18:30:00 +0800',
  'Message-ID: <demo-46@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="MIX"',
  '',
  '--MIX',
  'Content-Type: multipart/related; boundary="REL"',
  '',
  '--REL',
  'Content-Type: multipart/alternative; boundary="ALT"',
  '',
  '--ALT',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  b64('大家好：\n\n本周完成了文档预览功能，详见附件。\n\n张三'),
  '--ALT',
  'Content-Type: text/html; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  qp([
    '<div style="font-family:sans-serif">',
    '<p><img src="cid:logo@yilan" width="48" height="48" alt="logo"></p>',
    '<p>大家好：</p>',
    '<p>本周进展如下：</p>',
    '<ul><li><b>已完成</b>：PDF / EPUB / Office 预览</li><li><b>进行中</b>：邮件、日历、证书预览</li></ul>',
    '<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>模块</th><th>进度</th></tr><tr><td>文档</td><td>100%</td></tr><tr><td>结构化</td><td>80%</td></tr></table>',
    '<p>远程图片（默认被拦截）：<img src="https://example.com/track.png" width="1" height="1"></p>',
    '<p>—— 张三</p></div>',
  ].join('\n')),
  '--ALT--',
  '--REL',
  'Content-Type: image/svg+xml',
  'Content-ID: <logo@yilan>',
  'Content-Disposition: inline',
  'Content-Transfer-Encoding: base64',
  '',
  logo.toString('base64').replace(/.{76}/g, '$&\r\n'),
  '--REL--',
  '--MIX',
  `Content-Type: text/csv; charset=utf-8; name="${enc('进度表.csv')}"`,
  `Content-Disposition: attachment; filename*=utf-8''${encodeURIComponent('进度表.csv')}`,
  'Content-Transfer-Encoding: base64',
  '',
  b64('模块,进度\n文档,100%\n结构化,80%\n'),
  '--MIX--',
  '',
].join('\r\n');
write('weekly-report.eml', eml);

/* ---------- 日历 ---------- */
write('team.ics', [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//yilan//demo//CN', 'X-WR-CALNAME:团队日程', 'CALSCALE:GREGORIAN',
  'BEGIN:VEVENT', 'UID:1@yilan', 'DTSTAMP:20261118T000000Z', 'SUMMARY:周会', 'DTSTART;TZID=Asia/Shanghai:20261124T100000', 'DTEND;TZID=Asia/Shanghai:20261124T110000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO', 'LOCATION:3 楼会议室', 'ORGANIZER;CN=张三:mailto:zhangsan@example.com', 'DESCRIPTION:同步本周进展\\n讨论下周计划', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:2@yilan', 'DTSTAMP:20261118T000000Z', 'SUMMARY:版本发布 v1.0', 'DTSTART;VALUE=DATE:20261128', 'DTEND;VALUE=DATE:20261129', 'STATUS:CONFIRMED', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:3@yilan', 'DTSTAMP:20261118T000000Z', 'SUMMARY:客户演示', 'DTSTART:20261126T063000Z', 'DTEND:20261126T080000Z', 'LOCATION:线上会议',
  'DESCRIPTION:演示文档预览、邮件预览、证书查看等新功能。这是一段比较长的描述\\, 用来测试折行与转义字符的显示效果。', 'END:VEVENT',
  'BEGIN:VTODO', 'UID:4@yilan', 'DTSTAMP:20261118T000000Z', 'SUMMARY:整理需求文档', 'DUE;VALUE=DATE:20261125', 'STATUS:NEEDS-ACTION', 'END:VTODO',
  'END:VCALENDAR', '',
].join('\r\n'));

/* ---------- 联系人（虚构） ---------- */
write('contacts.vcf', [
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:张三', 'N:张;三;;;', 'ORG:一览科技;研发部', 'TITLE:前端工程师',
  'TEL;TYPE=CELL:+86 138 0000 0000', 'TEL;TYPE=WORK:010-0000 0000', 'EMAIL;TYPE=INTERNET,WORK:zhangsan@example.com',
  'ADR;TYPE=WORK:;;中关村大街 1 号;北京;;100000;中国', 'URL:https://example.com', 'BDAY:1990-05-20', 'NOTE:示例联系人，数据为虚构', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:4.0', 'FN:Alice Chen', 'N:Chen;Alice;;;', 'ORG:Example Inc.', 'TITLE:Product Manager',
  'TEL;TYPE=cell:+1 555 0100', 'EMAIL:alice@example.com', 'ADR;TYPE=home:;;1 Infinite Loop;Cupertino;CA;95014;USA', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:李四', 'TEL;TYPE=HOME:021-0000 0000', 'EMAIL:lisi@example.com', 'END:VCARD', '',
].join('\r\n'));

/* ---------- 证书：openssl 生成一张自签名演示证书（私钥用完即删，不写入示例） ---------- */
try {
  const tmp = mkdtempSync(join(tmpdir(), 'yilan-'));
  const key = join(tmp, 'k.pem');
  const crt = join(tmp, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', key, '-out', crt,
    '-days', '825', '-subj', '/C=CN/ST=Beijing/O=Yilan Demo/CN=demo.yilan.local',
    '-addext', 'subjectAltName=DNS:demo.yilan.local,DNS:*.demo.yilan.local,IP:127.0.0.1',
    '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'extendedKeyUsage=serverAuth'], { stdio: 'ignore' });
  const pem = readFileSync(crt, 'utf8');
  write('demo-cert.pem', pem);
  write('demo-cert.der', execFileSync('openssl', ['x509', '-in', crt, '-outform', 'DER']));
  rmSync(tmp, { recursive: true, force: true });
} catch (err) {
  console.warn('  跳过证书示例（需要 openssl）：', err.message);
}

/* ---------- tar.gz：打包几个小文件 ---------- */
function tarEntry(name, data, mtime = Math.floor(Date.now() / 1000)) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100);
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  h.write(`${mtime.toString(8).padStart(11, '0')}\0`, 136);
  h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}
const tarFiles = [
  ['demo-project/README.md', '# demo-project\n\n这个目录来自 `demo-project.tar.gz`，在浏览器里解压后可以直接浏览。\n'],
  ['demo-project/src/index.js', "export const hello = (name) => `你好，${name}`;\n"],
  ['demo-project/package.json', '{\n  "name": "demo-project",\n  "version": "1.0.0"\n}\n'],
];
const tar = Buffer.concat([...tarFiles.map(([n, d]) => tarEntry(n, Buffer.from(d))), Buffer.alloc(1024)]);
write('demo-project.tar.gz', gzipSync(tar));

/* ---------- 漫画 CBZ：用示例图片和逐页生成的 SVG 组成 ---------- */
{
  const zip = new JSZip();
  const svg = (i, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="850" viewBox="0 0 600 850"><rect width="600" height="850" fill="${color}"/><text x="300" y="440" font-size="160" font-family="sans-serif" fill="#fff" text-anchor="middle">${i}</text><text x="300" y="560" font-size="36" font-family="sans-serif" fill="#fff" text-anchor="middle" opacity=".8">第 ${i} 页</text></svg>`;
  // CBZ 一般是位图；为了不依赖图像库，封面用示例 JPEG，其余页用 PNG（由 sips 转换，失败则用 JPEG 副本）
  const cover = join(root, '图片、音视频', '图片', 'sunset.jpg');
  if (existsSync(cover)) zip.file('001.jpg', readFileSync(cover));
  const colors = ['#4f7cff', '#6d3ff2', '#e8590c', '#2f9e44'];
  const tmp = mkdtempSync(join(tmpdir(), 'yilan-cbz-'));
  colors.forEach((c, i) => {
    const n = String(i + 2).padStart(3, '0');
    const s = join(tmp, `${n}.svg`);
    writeFileSync(s, svg(i + 2, c));
    try {
      execFileSync('sips', ['-s', 'format', 'png', s, '--out', join(tmp, `${n}.png`)], { stdio: 'ignore' });
      zip.file(`${n}.png`, readFileSync(join(tmp, `${n}.png`)));
    } catch { /* 非 macOS：跳过 */ }
  });
  rmSync(tmp, { recursive: true, force: true });
  write('comic.cbz', await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
}

console.log('完成。iWork 示例需在 macOS 上用 Pages / Keynote / Numbers 手动另存，放到 examples/其他/ 下');
