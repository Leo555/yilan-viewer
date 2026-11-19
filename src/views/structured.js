/**
 * 结构化文本预览：Jupyter 笔记本、邮件（.eml）、日历（.ics）、联系人（.vcf）、证书 / 密钥（PEM）。
 * 都是纯文本格式，可在「预览 / 源码」之间切换；不依赖第三方库（Markdown 复用已有的 marked + DOMPurify）。
 */
import { el, viewUrl } from '../util.js';
import { loadMarkdown, loadPurify, ensureLanguage, loadHljs } from '../libs.js';
import { parseX509, pemBlocks, x509Card } from '../x509.js';

const kv = (box, rows) => {
  const dl = el('dl', 'kv');
  for (const [k, v] of rows) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    dl.appendChild(el('dt', null, k));
    const dd = el('dd');
    if (v instanceof Node) dd.appendChild(v); else dd.textContent = Array.isArray(v) ? v.join('、') : String(v);
    dl.appendChild(dd);
  }
  box.appendChild(dl);
  return dl;
};

/* ============================== Jupyter ============================== */
const joinSrc = (s) => (Array.isArray(s) ? s.join('') : s || '');

export async function renderNotebook(content, text, ctx) {
  let nb;
  try { nb = JSON.parse(text); } catch { throw new Error('不是有效的 .ipynb（JSON 解析失败）'); }
  if (!Array.isArray(nb.cells)) throw new Error('不是有效的 .ipynb（缺少 cells）');
  const [{ marked, DOMPurify }, hljs] = await Promise.all([loadMarkdown(), loadHljs()]);
  const lang = (nb.metadata?.language_info?.name || nb.metadata?.kernelspec?.language || 'python').toLowerCase();
  const hasLang = await ensureLanguage(lang);
  if (ctx.stale()) return;

  const clean = (html) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'button', 'input', 'textarea', 'select'] });
  const root = el('article', 'nb');
  const kernel = nb.metadata?.kernelspec?.display_name || nb.metadata?.language_info?.name;
  root.appendChild(el('div', 'nb-meta', [kernel && `内核：${kernel}`, `${nb.cells.length} 个单元格`].filter(Boolean).join('  ·  ')));

  for (const cell of nb.cells) {
    const src = joinSrc(cell.source);
    const box = el('section', `nb-cell nb-${cell.cell_type}`);
    if (cell.cell_type === 'markdown') {
      const md = el('div', 'md nb-md');
      md.innerHTML = clean(marked.parse(src, { gfm: true }));
      // Markdown 里的附件图片（attachment:xxx.png）
      for (const img of md.querySelectorAll('img[src^="attachment:"]')) {
        const name = img.getAttribute('src').slice(11);
        const att = cell.attachments?.[name];
        const [mime, data] = att ? Object.entries(att).find(([m]) => m.startsWith('image/')) || [] : [];
        if (data && mime !== 'image/svg+xml') img.src = `data:${mime};base64,${joinSrc(data).replace(/\s/g, '')}`;
        else img.remove();
      }
      box.appendChild(md);
    } else if (cell.cell_type === 'code') {
      const n = cell.execution_count;
      box.appendChild(el('div', 'nb-prompt', `In [${n ?? ' '}]:`));
      const pre = el('pre', 'nb-src hljs');
      const code = el('code');
      if (hasLang && src.length < 200000) {
        try { code.innerHTML = hljs.highlight(src, { language: lang, ignoreIllegals: true }).value; } catch { code.textContent = src; }
      } else code.textContent = src;
      pre.appendChild(code);
      box.appendChild(pre);
      for (const out of cell.outputs || []) box.appendChild(renderOutput(out, n, clean));
    } else {
      box.appendChild(el('pre', 'nb-raw', src));
    }
    root.appendChild(box);
  }
  content.replaceChildren(root);
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
function renderOutput(out, n, clean) {
  const wrap = el('div', 'nb-out');
  if (out.output_type === 'execute_result') wrap.appendChild(el('div', 'nb-prompt nb-prompt-out', `Out[${n ?? ' '}]:`));
  const body = el('div', 'nb-out-body');
  if (out.output_type === 'stream') {
    body.appendChild(el('pre', `nb-stream${out.name === 'stderr' ? ' nb-stderr' : ''}`, joinSrc(out.text).replace(ANSI, '')));
  } else if (out.output_type === 'error') {
    body.appendChild(el('pre', 'nb-stream nb-stderr', (out.traceback || [`${out.ename}: ${out.evalue}`]).join('\n').replace(ANSI, '')));
  } else if (out.data) {
    const d = out.data;
    const img = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].find((m) => d[m]);
    if (img) {
      const i = el('img', 'nb-img');
      i.src = `data:${img};base64,${joinSrc(d[img]).replace(/\s/g, '')}`;
      i.alt = '输出图片';
      body.appendChild(i);
    } else if (d['image/svg+xml']) {
      // SVG 输出放进 <img>，不内联，避免执行其中的脚本
      const i = el('img', 'nb-img');
      i.src = viewUrl(new Blob([joinSrc(d['image/svg+xml'])], { type: 'image/svg+xml' }));
      body.appendChild(i);
    } else if (d['text/html']) {
      const h = el('div', 'nb-html');
      h.innerHTML = clean(joinSrc(d['text/html']));
      body.appendChild(h);
    } else if (d['text/markdown']) {
      body.appendChild(el('pre', 'nb-stream', joinSrc(d['text/markdown'])));
    } else if (d['text/plain']) {
      body.appendChild(el('pre', 'nb-stream', joinSrc(d['text/plain']).replace(ANSI, '')));
    }
  }
  wrap.appendChild(body);
  return wrap;
}

/* ============================== MIME（邮件） ============================== */
/** 解码 RFC 2047 编码词：=?UTF-8?B?...?= / =?GBK?Q?...?= */
function decodeWords(s) {
  return s.replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, data) => {
    let bytes;
    if (/b/i.test(enc)) {
      try { bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)); } catch { return data; }
    } else {
      bytes = qpBytes(data.replace(/_/g, ' '));
    }
    return decodeCharset(bytes, cs);
  });
}

function decodeCharset(bytes, cs) {
  try { return new TextDecoder(normalizeCharset(cs)).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}
const normalizeCharset = (cs = 'utf-8') => {
  const c = cs.toLowerCase().trim();
  return c === 'gb2312' || c === 'gbk' || c === 'x-gbk' ? 'gb18030' : c;
};

function qpBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else if (c === '=' && (s[i + 1] === '\n' || s.slice(i + 1, i + 3) === '\r\n')) { i += s[i + 1] === '\r' ? 2 : 1; } // 软换行
    else out.push(...new TextEncoder().encode(c));
  }
  return new Uint8Array(out);
}

function parseHeaders(block) {
  const headers = new Map();
  const lines = block.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n');
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (!headers.has(k)) headers.set(k, v);
  }
  return headers;
}

/** "text/html; charset=utf-8; name=..." → { type, params } */
function parseParams(v = '') {
  const [type, ...rest] = v.split(';');
  const params = {};
  for (const p of rest) {
    const m = /^\s*([^=]+)=\s*"?([^"]*)"?\s*$/.exec(p);
    if (m) params[m[1].toLowerCase().replace(/\*$/, '')] = decodeWords(m[2].replace(/^utf-8''/i, (x) => x).replace(/^[\w-]+''/, (x) => x));
  }
  // RFC 2231：filename*=utf-8''%E4%B8%AD.pdf
  for (const p of rest) {
    const m = /^\s*([^=*]+)\*=\s*([\w-]+)''(.*)$/.exec(p);
    if (m) { try { params[m[1].toLowerCase()] = decodeURIComponent(m[3]); } catch { /* ignore */ } }
  }
  return { type: type.trim().toLowerCase(), params };
}

function parsePart(raw) {
  const sep = raw.search(/\r?\n\r?\n/);
  const head = sep < 0 ? raw : raw.slice(0, sep);
  const body = sep < 0 ? '' : raw.slice(sep).replace(/^\r?\n\r?\n/, '');
  const headers = parseHeaders(head);
  const ct = parseParams(headers.get('content-type') || 'text/plain');
  const disp = parseParams(headers.get('content-disposition') || '');
  const part = { headers, type: ct.type, params: ct.params, disposition: disp.type, filename: disp.params.filename || ct.params.name, children: [] };
  if (ct.type.startsWith('multipart/') && ct.params.boundary) {
    const b = `--${ct.params.boundary}`;
    const pieces = body.split(b).slice(1);
    for (const p of pieces) {
      if (p.startsWith('--')) break;
      part.children.push(parsePart(p.replace(/^\r?\n/, '')));
    }
  } else {
    part.raw = body;
  }
  return part;
}

function partBytes(part) {
  const enc = (part.headers.get('content-transfer-encoding') || '').toLowerCase();
  // .eml 按 latin1 读入，每个字符就是一个原始字节
  if (enc === 'base64') {
    try { return Uint8Array.from(atob(part.raw.replace(/\s+/g, '')), (c) => c.charCodeAt(0)); } catch { return new Uint8Array(); }
  }
  if (enc === 'quoted-printable') return qpBytes(part.raw);
  return Uint8Array.from(part.raw, (c) => c.charCodeAt(0) & 0xff);
}

function walkParts(part, acc = { html: null, text: null, attachments: [], cids: new Map() }) {
  if (part.children.length) {
    for (const c of part.children) walkParts(c, acc);
    return acc;
  }
  const isAttach = part.disposition === 'attachment' || (part.filename && part.disposition !== 'inline' && !part.type.startsWith('text/'));
  const cid = (part.headers.get('content-id') || '').replace(/^<|>$/g, '');
  if (!isAttach && part.type === 'text/html' && !acc.html) acc.html = part;
  else if (!isAttach && part.type === 'text/plain' && !acc.text) acc.text = part;
  else {
    if (cid) acc.cids.set(cid, part);
    if (isAttach || !cid) acc.attachments.push(part);
  }
  return acc;
}

/** bytes：原始字节（.eml 可能混合多种编码，必须按字节解析） */
export async function renderEmail(content, bytes, ctx) {
  const raw = new TextDecoder('latin1').decode(bytes);
  const root = parsePart(raw);
  const h = root.headers;
  const { html, text, attachments, cids } = walkParts(root);
  const decodeText = (p) => decodeCharset(partBytes(p), p.params.charset || 'utf-8');

  const box = el('article', 'mail');
  box.appendChild(el('h1', 'mail-subject', decodeWords(h.get('subject') || '（无主题）')));
  const date = h.get('date') ? new Date(h.get('date')) : null;
  kv(box, [
    ['发件人', decodeWords(h.get('from') || '')],
    ['收件人', decodeWords(h.get('to') || '')],
    ['抄送', decodeWords(h.get('cc') || '')],
    ['时间', date && !Number.isNaN(+date) ? date.toLocaleString('zh-CN', { hour12: false }) : h.get('date')],
  ]);

  if (attachments.length) {
    const list = el('div', 'mail-attach');
    for (const a of attachments) {
      const bytesA = partBytes(a);
      const name = a.filename || `未命名.${a.type.split('/')[1] || 'bin'}`;
      const link = el('a', 'mail-file', `📎 ${name}（${(bytesA.length / 1024).toFixed(1)} KB）`);
      link.href = viewUrl(new Blob([bytesA], { type: 'application/octet-stream' })); // 统一按下载处理，不在本页打开
      link.download = name;
      list.appendChild(link);
    }
    box.appendChild(list);
  }

  const body = el('div', 'mail-body');
  if (html) {
    const DOMPurify = await loadPurify();
    if (ctx.stale()) return;
    const sanitized = DOMPurify.sanitize(decodeText(html), { FORCE_BODY: true, FORBID_TAGS: ['script', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'base', 'meta', 'link'] });
    // 净化之后再把 cid: 内嵌图片换成 data: 地址（DOMPurify 会剥掉 blob:；沙箱 iframe 是不透明源，也读不到父页面的 blob:）
    const withCid = sanitized.replace(/(["'(])cid:([^"')]+)/gi, (m, q, id) => {
      const p = cids.get(id.trim());
      if (!p || !p.type.startsWith('image/')) return m;
      let bin = '';
      for (const b of partBytes(p)) bin += String.fromCharCode(b);
      return `${q}data:${p.type};base64,${btoa(bin)}`;
    });
    // 远程图片默认不发请求：src / srcset 改名，用户点「显示远程图片」后再还原（CSP 兜底）
    const REMOTE = /(<img\b[^>]*?\s)(src|srcset)(=["']?\s*(?:https?:)?\/\/)/gi;
    const hasRemote = REMOTE.test(withCid);
    const blocked = withCid.replace(REMOTE, '$1data-blocked-$2$3');
    const clean = (remote) => (remote ? withCid : blocked);
    // 放进不允许脚本的沙箱；默认不加载远程图片（防止追踪像素），由用户手动开启
    const frame = el('iframe', 'mail-frame');
    frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    const csp = (remote) => `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:${remote ? ' https: http:' : ''}; style-src 'unsafe-inline'; font-src data:">`;
    const doc = (remote) => `<!doctype html><html><head><meta charset="utf-8">${csp(remote)}<base target="_blank"><style>body{font:14px/1.6 -apple-system,"PingFang SC",sans-serif;margin:16px;color:#1f2328;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${clean(remote)}</body></html>`;
    const show = (remote) => {
      frame.srcdoc = doc(remote);
    };
    frame.addEventListener('load', () => {
      try { frame.style.height = `${Math.max(200, frame.contentDocument.documentElement.scrollHeight + 20)}px`; } catch { frame.style.height = '70vh'; }
    });
    if (hasRemote) {
      const bar = el('div', 'notice mail-remote');
      bar.append('为保护隐私，已阻止加载远程图片。');
      const btn = el('button', 'btn', '显示远程图片');
      btn.type = 'button';
      btn.addEventListener('click', () => { show(true); bar.remove(); });
      bar.appendChild(btn);
      body.appendChild(bar);
    }
    show(false);
    body.appendChild(frame);
  } else if (text) {
    body.appendChild(el('pre', 'mail-text', decodeText(text)));
  } else {
    body.appendChild(el('div', 'doc-empty', '（邮件没有正文）'));
  }
  box.appendChild(body);
  content.replaceChildren(box);
  ctx.status(attachments.length ? `${attachments.length} 个附件` : '');
}

/* ============================== iCalendar / vCard ============================== */
/** 通用的 vCard / iCalendar 行解析：展开折行，拆出 NAME;PARAM=..:VALUE */
function parseContentLines(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = [];
  for (const line of lines) {
    const m = /^([^:;]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!m) continue;
    const params = {};
    for (const p of m[2].split(';').filter(Boolean)) {
      const [k, v = ''] = p.split('=');
      params[k.toUpperCase()] = v.replace(/^"|"$/g, '');
    }
    let value = m[3];
    if ((params.ENCODING || '').toUpperCase() === 'QUOTED-PRINTABLE') value = decodeCharset(qpBytes(value), params.CHARSET);
    value = value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
    out.push({ name: m[1].toUpperCase().replace(/^item\d+\./i, ''), params, value });
  }
  return out;
}

function icsDate(v, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return { text: v, time: 0 };
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (!hh) return { text: `${y}-${mo}-${d}（全天）`, time: Date.UTC(y, mo - 1, d), allDay: true };
  const date = z ? new Date(Date.UTC(y, mo - 1, d, hh, mi, ss || 0)) : new Date(y, mo - 1, d, hh, mi, ss || 0);
  const tz = !z && params.TZID ? `（${params.TZID}）` : '';
  return { text: date.toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + tz, time: +date };
}

export function renderCalendar(content, text, ctx) {
  const lines = parseContentLines(text);
  const events = [];
  let cur = null;
  let calName = '';
  for (const l of lines) {
    if (l.name === 'BEGIN' && /^(VEVENT|VTODO)$/i.test(l.value)) cur = { type: l.value.toUpperCase() };
    else if (l.name === 'END' && cur && /^(VEVENT|VTODO)$/i.test(l.value)) { events.push(cur); cur = null; }
    else if (cur) cur[l.name] ??= l;
    else if (l.name === 'X-WR-CALNAME') calName = l.value;
  }
  const items = events.map((e) => ({
    e,
    start: e.DTSTART ? icsDate(e.DTSTART.value, e.DTSTART.params) : (e.DUE ? icsDate(e.DUE.value, e.DUE.params) : { text: '', time: 0 }),
    end: e.DTEND ? icsDate(e.DTEND.value, e.DTEND.params) : null,
  })).sort((a, b) => a.start.time - b.start.time);

  const box = el('article', 'cal');
  box.appendChild(el('h1', 'cal-title', calName || '日历'));
  if (!items.length) box.appendChild(el('div', 'doc-empty', '没有找到日程'));
  let lastDay = '';
  for (const { e, start, end } of items) {
    const day = start.time ? new Date(start.time).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }) : '未定日期';
    if (day !== lastDay) { box.appendChild(el('div', 'cal-day', day)); lastDay = day; }
    const card = el('section', 'cal-event');
    card.appendChild(el('div', 'cal-summary', `${e.type === 'VTODO' ? '☐ ' : ''}${e.SUMMARY?.value || '（无标题）'}`));
    const when = end ? `${start.text} → ${end.text}` : start.text;
    kv(card, [
      ['时间', when],
      ['地点', e.LOCATION?.value],
      ['重复', e.RRULE?.value],
      ['组织者', e.ORGANIZER?.params.CN || e.ORGANIZER?.value.replace(/^mailto:/i, '')],
      ['状态', e.STATUS?.value],
    ]);
    if (e.DESCRIPTION?.value) card.appendChild(el('div', 'cal-desc', e.DESCRIPTION.value));
    box.appendChild(card);
  }
  content.replaceChildren(box);
  ctx.status(`${items.length} 个日程`);
}

export function renderContacts(content, text, ctx) {
  const lines = parseContentLines(text);
  const cards = [];
  let cur = null;
  for (const l of lines) {
    if (l.name === 'BEGIN' && /^VCARD$/i.test(l.value)) cur = [];
    else if (l.name === 'END' && cur) { cards.push(cur); cur = null; }
    else if (cur) cur.push(l);
  }
  const box = el('article', 'vcards');
  if (!cards.length) box.appendChild(el('div', 'doc-empty', '没有找到联系人'));
  const TYPE = { CELL: '手机', HOME: '家庭', WORK: '工作', FAX: '传真', VOICE: '电话', PREF: '首选', INTERNET: '' };
  const typeOf = (l) => (l.params.TYPE || Object.keys(l.params).filter((k) => TYPE[k] !== undefined).join(','))
    .split(',').map((t) => TYPE[t.toUpperCase()] ?? t.toLowerCase()).filter(Boolean).join(' · ');
  for (const c of cards) {
    const get = (n) => c.find((l) => l.name === n);
    const all = (n) => c.filter((l) => l.name === n);
    const card = el('section', 'vcard');
    const name = get('FN')?.value || get('N')?.value.split(';').filter(Boolean).reverse().join(' ') || '（未命名）';
    const head = el('div', 'vcard-head');
    const photo = get('PHOTO');
    const avatar = el('div', 'vcard-avatar');
    if (photo && /^(data:image\/|[A-Za-z0-9+/=\s]+$)/.test(photo.value) && !/^https?:/i.test(photo.value)) {
      const img = el('img');
      const type = (photo.params.TYPE || 'jpeg').toLowerCase();
      img.src = photo.value.startsWith('data:') ? photo.value : `data:image/${type};base64,${photo.value.replace(/\s/g, '')}`;
      img.alt = '';
      avatar.appendChild(img);
    } else avatar.textContent = [...name][0] || '?';
    head.appendChild(avatar);
    const t = el('div');
    t.appendChild(el('div', 'vcard-name', name));
    const org = [get('ORG')?.value.replace(/;/g, ' '), get('TITLE')?.value].filter(Boolean).join(' · ');
    if (org) t.appendChild(el('div', 'vcard-org', org));
    head.appendChild(t);
    card.appendChild(head);
    const rows = [];
    for (const l of all('TEL')) rows.push([`电话${typeOf(l) ? `（${typeOf(l)}）` : ''}`, l.value.replace(/^tel:/i, '')]);
    for (const l of all('EMAIL')) rows.push([`邮箱${typeOf(l) ? `（${typeOf(l)}）` : ''}`, l.value]);
    for (const l of all('ADR')) rows.push([`地址${typeOf(l) ? `（${typeOf(l)}）` : ''}`, l.value.split(';').filter(Boolean).reverse().join(' ')]);
    for (const l of all('URL')) rows.push(['网址', l.value]);
    const bday = get('BDAY')?.value;
    if (bday) rows.push(['生日', bday.replace(/^(\d{4})-?(\d{2})-?(\d{2}).*/, '$1-$2-$3')]);
    const note = get('NOTE')?.value;
    if (note) rows.push(['备注', note]);
    kv(card, rows);
    box.appendChild(card);
  }
  content.replaceChildren(box);
  ctx.status(`${cards.length} 位联系人`);
}

/* ============================== 证书 / 密钥（PEM / DER） ============================== */
/** blocks：[{ label, der }]，来自 PEM 文本或二进制 DER */
export async function renderCerts(content, blocks, ctx) {
  const box = el('article', 'certs');
  if (!blocks.length) {
    box.appendChild(el('div', 'doc-empty', '没有找到证书或密钥（-----BEGIN ...-----）'));
    content.replaceChildren(box);
    return;
  }
  let certs = 0;
  for (const b of blocks) {
    if (/CERTIFICATE$/.test(b.label) && !/REQUEST/.test(b.label)) {
      try { box.appendChild(x509Card(await parseX509(b.der))); certs++; continue; } catch (err) { console.warn('证书解析失败', err); }
    }
    if (ctx.stale()) return;
    // 私钥、公钥、CSR 等：只说明类型，私钥内容绝不展示
    const card = el('section', 'cert');
    const isPrivate = /PRIVATE KEY/.test(b.label);
    card.appendChild(el('div', 'cert-title', `${isPrivate ? '🔒 ' : '🔑 '}${LABELS[b.label] || b.label}`));
    kv(card, [
      ['类型', b.label],
      ['大小', `${b.der.length} 字节`],
      ['说明', isPrivate ? '这是私钥，请妥善保管，不要发给任何人。为安全起见，这里不显示内容。' : '目前只解析 X.509 证书，其他内容可在「源码」中查看。'],
    ]);
    box.appendChild(card);
  }
  if (ctx.stale()) return;
  content.replaceChildren(box);
  ctx.status(certs ? `${certs} 张证书` : `${blocks.length} 个 PEM 块`);
}

export const renderPem = (content, text, ctx) => renderCerts(content, pemBlocks(text), ctx);

const LABELS = {
  'PRIVATE KEY': 'PKCS#8 私钥', 'RSA PRIVATE KEY': 'RSA 私钥', 'EC PRIVATE KEY': '椭圆曲线私钥', 'ENCRYPTED PRIVATE KEY': '加密的私钥',
  'OPENSSH PRIVATE KEY': 'OpenSSH 私钥', 'PUBLIC KEY': '公钥', 'RSA PUBLIC KEY': 'RSA 公钥', 'CERTIFICATE REQUEST': '证书签名请求（CSR）',
  'NEW CERTIFICATE REQUEST': '证书签名请求（CSR）', 'X509 CRL': '证书吊销列表',
};
