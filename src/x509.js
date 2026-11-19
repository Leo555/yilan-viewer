/**
 * 极简 X.509 证书解析（ASN.1 DER），只读取展示用字段：主体、颁发者、有效期、序列号、
 * 公钥算法与长度、签名算法、SAN、基本约束、密钥用途、指纹。不做任何校验。
 */
import { el } from './util.js';

/* ---------- PEM ---------- */
export function pemBlocks(text) {
  const out = [];
  const re = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[2].replace(/^[A-Za-z-]+:.*$/gm, '').replace(/[^A-Za-z0-9+/=]/g, ''); // 去掉 Proc-Type 之类的头
    try { out.push({ label: m[1], der: Uint8Array.from(atob(body), (c) => c.charCodeAt(0)) }); } catch { /* 损坏的块 */ }
  }
  return out;
}

/** 二进制 DER / 也可能是 PEM 文本：统一返回 DER 列表 */
export function certsFromBytes(bytes) {
  if (bytes[0] === 0x30) return [{ label: 'CERTIFICATE', der: bytes }];
  return pemBlocks(new TextDecoder().decode(bytes));
}

/* ---------- ASN.1 ---------- */
function read(der, pos) {
  const tag = der[pos];
  let len = der[pos + 1];
  let off = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n > 4) throw new Error('长度字段过长');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + der[off + i];
    off += n;
  }
  if (off + len > der.length) throw new Error('数据被截断');
  return { tag, start: pos, off, len, end: off + len };
}

function children(der, node) {
  const out = [];
  for (let p = node.off; p < node.end;) {
    const c = read(der, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

const OIDS = {
  '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.5': 'serialNumber',
  '1.2.840.113549.1.9.1': 'E',
  '1.2.840.113549.1.1.1': 'RSA', '1.2.840.10045.2.1': 'EC', '1.3.101.112': 'Ed25519', '1.3.101.113': 'Ed448',
  '1.2.840.113549.1.1.5': 'SHA-1 with RSA', '1.2.840.113549.1.1.11': 'SHA-256 with RSA', '1.2.840.113549.1.1.12': 'SHA-384 with RSA',
  '1.2.840.113549.1.1.13': 'SHA-512 with RSA', '1.2.840.113549.1.1.10': 'RSA-PSS',
  '1.2.840.10045.4.3.2': 'ECDSA with SHA-256', '1.2.840.10045.4.3.3': 'ECDSA with SHA-384', '1.2.840.10045.4.3.4': 'ECDSA with SHA-512',
  '1.2.840.10045.3.1.7': 'P-256', '1.3.132.0.34': 'P-384', '1.3.132.0.35': 'P-521',
  '2.5.29.17': 'subjectAltName', '2.5.29.19': 'basicConstraints', '2.5.29.15': 'keyUsage', '2.5.29.37': 'extKeyUsage',
  '1.3.6.1.5.5.7.3.1': 'TLS 服务器', '1.3.6.1.5.5.7.3.2': 'TLS 客户端', '1.3.6.1.5.5.7.3.3': '代码签名', '1.3.6.1.5.5.7.3.4': '邮件保护',
  '1.3.6.1.5.5.7.3.8': '时间戳', '1.3.6.1.5.5.7.3.9': 'OCSP 签名',
};

function oid(der, n) {
  const b = der.subarray(n.off, n.end);
  const parts = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) { parts.push(v); v = 0; }
  }
  return parts.join('.');
}

function str(der, n) {
  const b = der.subarray(n.off, n.end);
  if (n.tag === 0x1e) { // BMPString：UTF-16BE
    let s = '';
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
    return s;
  }
  return new TextDecoder(n.tag === 0x0c ? 'utf-8' : 'latin1').decode(b);
}

function time(der, n) {
  const s = str(der, n);
  const m = n.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s) : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s);
  if (!m) return null;
  let y = Number(m[1]);
  if (n.tag === 0x17) y += y < 50 ? 2000 : 1900;
  return new Date(Date.UTC(y, m[2] - 1, m[3], m[4], m[5], m[6] || 0));
}

function name(der, n) {
  const parts = [];
  for (const set of children(der, n)) {
    for (const atv of children(der, set)) {
      const [t, v] = children(der, atv);
      parts.push([OIDS[oid(der, t)] || oid(der, t), str(der, v)]);
    }
  }
  return parts;
}

const hex = (b, sep = ':') => Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(sep);

/** 返回证书的可读字段（异步：指纹用 Web Crypto 计算） */
export async function parseX509(der) {
  const cert = read(der, 0);
  const [tbs, sigAlg] = children(der, cert);
  let f = children(der, tbs);
  let version = 1;
  if (f[0].tag === 0xa0) { version = der[children(der, f[0])[0].off] + 1; f = f.slice(1); }
  const [serial, , issuer, validity, subject, spki, ...rest] = f;
  const [nb, na] = children(der, validity);
  const [alg, keyBits] = children(der, spki);
  const algParts = children(der, alg);
  const keyAlg = OIDS[oid(der, algParts[0])] || oid(der, algParts[0]);
  let keySize = '';
  if (keyAlg === 'RSA') {
    const rsa = read(der, keyBits.off + 1);
    const mod = children(der, rsa)[0];
    let bytes = mod.len;
    if (der[mod.off] === 0) bytes--;
    keySize = `${bytes * 8} 位`;
  } else if (keyAlg === 'EC' && algParts[1]?.tag === 0x06) {
    keySize = OIDS[oid(der, algParts[1])] || oid(der, algParts[1]);
  }

  const info = {
    version,
    serial: hex(der.subarray(serial.off, serial.end)).replace(/^00:/, ''),
    issuer: name(der, issuer),
    subject: name(der, subject),
    notBefore: time(der, nb),
    notAfter: time(der, na),
    keyAlg,
    keySize,
    sigAlg: OIDS[oid(der, children(der, sigAlg)[0])] || oid(der, children(der, sigAlg)[0]),
    san: [],
    ca: null,
    keyUsage: [],
    extKeyUsage: [],
  };

  const extWrap = rest.find((n) => n.tag === 0xa3);
  if (extWrap) {
    for (const ext of children(der, children(der, extWrap)[0])) {
      const parts = children(der, ext);
      const id = OIDS[oid(der, parts[0])];
      const val = parts[parts.length - 1]; // OCTET STRING
      const inner = read(der, val.off);
      try {
        if (id === 'subjectAltName') {
          for (const g of children(der, inner)) {
            if (g.tag === 0x82) info.san.push(new TextDecoder().decode(der.subarray(g.off, g.end)));
            else if (g.tag === 0x87) info.san.push(der.subarray(g.off, g.end).length === 4 ? Array.from(der.subarray(g.off, g.end)).join('.') : `IPv6 ${hex(der.subarray(g.off, g.end), '')}`);
            else if (g.tag === 0x81) info.san.push(new TextDecoder().decode(der.subarray(g.off, g.end)));
          }
        } else if (id === 'basicConstraints') {
          const c = children(der, inner);
          info.ca = !!(c[0] && c[0].tag === 0x01 && der[c[0].off]);
        } else if (id === 'keyUsage') {
          const names = ['数字签名', '不可否认', '密钥加密', '数据加密', '密钥协商', '证书签发', 'CRL 签发', '仅加密', '仅解密'];
          const b0 = der[inner.off + 1] || 0;
          const b1 = der[inner.off + 2] || 0;
          names.forEach((nm, i) => { if (((i < 8 ? b0 : b1) >> (i < 8 ? 7 - i : 15 - i)) & 1) info.keyUsage.push(nm); });
        } else if (id === 'extKeyUsage') {
          for (const o of children(der, inner)) info.extKeyUsage.push(OIDS[oid(der, o)] || oid(der, o));
        }
      } catch { /* 单个扩展解析失败不影响其他字段 */ }
    }
  }

  const digest = async (algo) => hex(new Uint8Array(await crypto.subtle.digest(algo, der)));
  try {
    info.sha256 = await digest('SHA-256');
    info.sha1 = await digest('SHA-1');
  } catch { /* 非安全上下文没有 crypto.subtle */ }
  return info;
}

const fmtName = (parts) => parts.map(([k, v]) => `${k}=${v}`).join(', ');
const cn = (parts) => parts.find(([k]) => k === 'CN')?.[1] || parts.find(([k]) => k === 'O')?.[1] || fmtName(parts);
const fmtDate = (d) => (d ? d.toLocaleString('zh-CN', { hour12: false }) : '—');

export function x509Card(info) {
  const card = el('section', 'cert');
  const now = Date.now();
  const expired = info.notAfter && +info.notAfter < now;
  const notYet = info.notBefore && +info.notBefore > now;
  const days = info.notAfter ? Math.round((+info.notAfter - now) / 86400000) : null;
  const self = fmtName(info.subject) === fmtName(info.issuer);

  const head = el('div', 'cert-head');
  head.appendChild(el('div', 'cert-title', `📜 ${cn(info.subject)}`));
  const badge = el('span', `cert-badge ${expired || notYet ? 'bad' : days != null && days < 30 ? 'warn' : 'ok'}`,
    expired ? '已过期' : notYet ? '尚未生效' : days != null ? `有效，剩余 ${days} 天` : '');
  head.appendChild(badge);
  if (info.ca) head.appendChild(el('span', 'cert-badge', 'CA 证书'));
  if (self) head.appendChild(el('span', 'cert-badge', '自签名'));
  card.appendChild(head);

  const dl = el('dl', 'kv');
  const row = (k, v) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return;
    dl.appendChild(el('dt', null, k));
    const dd = el('dd', null, Array.isArray(v) ? v.join('、') : String(v));
    if (/指纹|序列号/.test(k)) dd.classList.add('mono');
    dl.appendChild(dd);
  };
  row('使用者', fmtName(info.subject));
  row('颁发者', fmtName(info.issuer));
  row('生效时间', fmtDate(info.notBefore));
  row('过期时间', fmtDate(info.notAfter));
  row('域名 / IP', info.san);
  row('公钥', [info.keyAlg, info.keySize].filter(Boolean).join(' '));
  row('签名算法', info.sigAlg);
  row('密钥用途', info.keyUsage);
  row('扩展用途', info.extKeyUsage);
  row('序列号', info.serial);
  row('版本', `v${info.version}`);
  row('SHA-256 指纹', info.sha256);
  row('SHA-1 指纹', info.sha1);
  card.appendChild(dl);
  return card;
}
