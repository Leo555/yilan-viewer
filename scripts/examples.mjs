// 生成 examples/manifest.json：页面「查看示例」按这份清单按需拉取文件
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../examples/', import.meta.url));
const OUT = 'manifest.json';
// 侧边栏中示例分类的显示顺序
const ORDER = ['documents', 'code', 'text', 'media', 'fonts', 'misc'];
// 子目录的显示顺序：相对 examples/ 的目录路径 → 子目录名
const SUB_ORDER = {
  media: ['images', 'videos', 'audio'],
};

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === OUT) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walk(full));
    else if (ent.isFile()) out.push({ path: relative(root, full).split(sep).join('/').normalize('NFC'), size: (await stat(full)).size });
  }
  return out;
}

const files = (await walk(root)).sort((a, b) => a.path.localeCompare(b.path));
await writeFile(join(root, OUT), `${JSON.stringify({ order: ORDER, subOrder: SUB_ORDER, files }, null, 2)}\n`);
console.log(`examples/${OUT}: ${files.length} 个文件`);
