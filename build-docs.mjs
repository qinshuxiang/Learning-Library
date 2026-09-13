#!/usr/bin/env node
/**
 * build-docs.mjs — 学习库 Markdown 单文件浏览器生成器
 *
 * 扫描仓库根的 前端/后端/工具/常识/架构/法律 六个领域文件夹，将全部 md 原始内容与文件树
 * 内嵌进单个自包含 HTML（marked + highlight.js 也一并内嵌），产物双击 file:// 即用。
 *
 * 无副作用：只读 Markdown 与 assets 图片，不在磁盘上生成或改写任何文件，
 * 唯一输出是仓库根的 学习库.html。全库总目录已取消，首页默认打开侧栏第一篇。
 *
 * 用法：npm run build   （或 node build-docs.mjs）
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, '学习库.html');

/* ---------------- 顶层领域与优先级 ---------------- */
// 文档库已取消 doc/ 中间层，六个领域目录直接位于仓库根；页面逻辑路径相对仓库根
const DOC_ROOT = '.';
// 顶层顺序：六个领域文件夹依次排列
const TOP_ORDER = ['前端', '后端', '工具', '常识', '架构', '法律'];
const SCAN_DIRS = ['前端', '后端', '工具', '常识', '架构', '法律']; // 仓库根下递归扫描的目录
const ROOT_FILES = []; // 仓库根下的额外元文件（不递归扫描）；当前不启用全库总目录
const META_DIRS = []; // 元文档目录及其全部子目录：只放规范文件、不配 0. 索引，豁免缺索引检查

/* ---------------- 扫描与树构建 ---------------- */
// 自然排序：先比数字前缀（1,2,…,10），无前缀/后缀再按中文词典序
function compareNames(a, b) {
  const numA = parsePrefix(a);
  const numB = parsePrefix(b);
  if (numA != null && numB != null && numA !== numB) return numA - numB;
  // 一个带数字前缀一个不带：带前缀的排前
  if (numA != null && numB == null) return -1;
  if (numA == null && numB != null) return 1;
  return a.localeCompare(b, 'zh-Hans-CN');
}
function parsePrefix(name) {
  const m = /^(\d+)\.\s/.exec(name);
  return m ? parseInt(m[1], 10) : null;
}

// 目录条目排序：文件夹在前，文件在后；各自内部自然排序
function sortEntries(files, folders) {
  files.sort((x, y) => compareNames(x.name, y.name));
  folders.sort((x, y) => compareNames(x.name, y.name));
  return [...folders, ...files];
}

async function collectMdInDir(absDir, relPrefix, docs) {
  const entries = (await fs.readdir(absDir, { withFileTypes: true }))
    .filter((e) => !e.name.startsWith('.'));
  const files = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'));
  const folders = entries.filter((e) => e.isDirectory());

  const fileNodes = [];
  for (const f of files) {
    const rel = relPrefix ? `${relPrefix}/${f.name}` : f.name;
    const raw = await fs.readFile(path.join(absDir, f.name), 'utf8');
    docs[rel] = raw;
    fileNodes.push({ type: 'file', name: f.name, path: rel });
  }
  const folderNodes = [];
  for (const d of folders) {
    const childDocs = await collectMdInDir(path.join(absDir, d.name), relPrefix ? `${relPrefix}/${d.name}` : d.name, docs);
    // 目录下没有 md 则跳过（遵守不建空目录/不显示空文件夹）
    if (childDocs.length) folderNodes.push({ type: 'folder', name: d.name, children: childDocs });
  }
  // 文件夹在前，文件在后；各自自然序
  return sortEntries(fileNodes, folderNodes);
}

async function buildData() {
  const docs = {};
  const assets = {};
  // 顶层扫描：六个领域文件夹依次读取
  const topItems = [];
  for (const name of TOP_ORDER) {
    if (ROOT_FILES.includes(name)) {
      const abs = path.join(ROOT, DOC_ROOT, name);
      if (await fileExists(abs)) {
        docs[name] = await fs.readFile(abs, 'utf8');
        topItems.push({ type: 'file', name, path: name });
      }
    } else if (SCAN_DIRS.includes(name)) {
      const abs = path.join(ROOT, DOC_ROOT, name);
      if (await fileExists(abs)) {
        const children = await collectMdInDir(abs, name, docs);
        await collectAssets(abs, name, assets);
        if (children.length) topItems.push({ type: 'folder', name, children });
      }
    }
  }
  // 索引完整性提示（S3），不落盘、不进产物
  checkMissingIndexes(topItems);
  // 顶层按 TOP_ORDER 顺序
  topItems.sort((a, b) => TOP_ORDER.indexOf(a.name) - TOP_ORDER.indexOf(b.name));
  return { tree: topItems, docs, assets };
}

/* ---------------- 索引完整性检查（S3） ---------------- */
// 凡含正文的目录都应有索引 0. 主题.md，缺了就是漏建。本脚本不再生成全库总目录文件，
// 此项检查仅作构建期提示，不影响产物。
function checkMissingIndexes(topItems) {
  const missing = [];
  (function check(nodes, prefix) {
    for (const node of nodes) {
      if (node.type !== 'folder') continue;
      const files = node.children.filter((c) => c.type === 'file');
      const dir = prefix + node.name;
      if (files.length && !files.some((c) => /^0\. /.test(c.name)) && !META_DIRS.some((m) => dir === m || dir.startsWith(`${m}/`))) missing.push(dir);
      check(node.children, `${prefix}${node.name}/`);
    }
  })(topItems, '');
  if (missing.length) {
    console.warn(`⚠ 以下目录含正文却缺少索引 0. 主题.md：\n  ${missing.join('\n  ')}`);
  }
}
async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/* ---------------- 图片资源内嵌（assets 目录） ---------------- */
// 规范 S8：图片统一放在 主题名/assets 子目录。单文件浏览器需把图片转成
// data URI 内嵌，否则相对路径 ./assets/x.jpg 会指向仓库根、在浏览器里显示为裂图。
const IMG_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.bmp': 'image/bmp',
};

// 递归扫描，遇到名为 assets 的目录即读取其中的图片；键为相对 doc/ 根的路径
async function collectAssets(absDir, relPrefix, assets) {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (!e.isDirectory()) continue;
    const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
    const abs = path.join(absDir, e.name);
    if (e.name !== 'assets') { await collectAssets(abs, rel, assets); continue; }
    const files = await fs.readdir(abs, { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile()) continue;
      const mime = IMG_MIME[path.extname(f.name).toLowerCase()];
      if (!mime) continue;
      const buf = await fs.readFile(path.join(abs, f.name));
      assets[`${rel}/${f.name}`] = `data:${mime};base64,${buf.toString('base64')}`;
    }
  }
}

/* ---------------- Vendor 库读取（内嵌） ---------------- */
function resolveModule(p) {
  return path.join(ROOT, 'node_modules', p);
}
async function readOrFail(rel, hint) {
  const p = resolveModule(rel);
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    throw new Error(
      `缺少依赖文件：${p}\n请先在项目根目录执行：npm install\n（${hint}）`
    );
  }
}

async function loadVendors() {
  const markedJs = await readOrFail('marked/marked.min.js', 'marked');
  const markedAlertJs = await readOrFail('marked-alert/dist/index.umd.js', 'marked-alert（npm i marked-alert）');
  const hljsCore = await readOrFail('@highlightjs/cdn-assets/highlight.min.js', '@highlightjs/cdn-assets');
  const langs = ['javascript', 'css', 'xml', 'scss', 'http', 'markdown', 'json', 'bash'];
  const langParts = [];
  for (const lang of langs) {
    langParts.push(await readOrFail(`@highlightjs/cdn-assets/languages/${lang}.min.js`, `hljs ${lang}`));
  }
  return { markedJs, markedAlertJs, hljsCore, hljsLangs: langParts.join('\n') };
}

/* ---------------- 模板 ---------------- */
import { readFileSync } from 'node:fs';
// 读取与本脚本同目录的模板片段，避免超长模板字符串带来的转义隐患
// 模板存放在 src 子目录：运行时 <script> 与 <style> 均为独立文本文件
const TEMPLATE_DIR = path.join(ROOT, 'src', 'template');

async function readTemplate(name) {
  const p = path.join(TEMPLATE_DIR, name);
  try {
    return await fs.readFile(p, 'utf8');
  } catch (e) {
    throw new Error(`缺少模板文件：${p}（${name}）。该文件应随 build-docs.mjs 一起提供。`);
  }
}

async function main() {
  const { tree, docs, assets } = await buildData();
  const { markedJs, markedAlertJs, hljsCore, hljsLangs } = await loadVendors();

  const [headTpl, styleTpl, runtimeTpl, bodyTailTpl] = await Promise.all([
    readTemplate('head.html'),
    readTemplate('style.css'),
    readTemplate('runtime.js'),
    readTemplate('body.html'),
  ]);

  const dataJson = JSON.stringify({ tree, docs, assets }).replace(/</g, '\\u003c');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headTpl}
<style>${styleTpl}</style>
</head>
<body>
${bodyTailTpl}
<script>${markedJs}</script>
<script>${markedAlertJs}</script>
<script>${hljsCore}</script>
<script>${hljsLangs}</script>
<script type="application/json" id="ll-data">${dataJson}</script>
<script>${runtimeTpl}</script>
</body>
</html>
`;

  await fs.writeFile(OUT, html, 'utf8');
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
  const count = Object.keys(docs).length;
  const imgCount = Object.keys(assets).length;
  const imgKb = (Object.values(assets).reduce((n, s) => n + s.length, 0) / 1024).toFixed(0);
  console.log(`✔ 已生成 ${OUT}`);
  console.log(`  文档数：${count} 篇 | 内嵌图片：${imgCount} 张 / ${imgKb} KB | 数据源 ${(Buffer.byteLength(dataJson, 'utf8') / 1024).toFixed(0)} KB | 文件总大小 ${kb} KB`);
}

main().catch((e) => {
  console.error('✘ 构建失败：', e.message);
  process.exit(1);
});
