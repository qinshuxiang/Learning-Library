#!/usr/bin/env node
/**
 * build-docs.mjs — 学习库 Markdown 单文件浏览器生成器
 *
 * 扫描 常识/法律/软件 三文件夹 + 根《编写规范.md》，将全部 md 原始内容与文件树
 * 内嵌进单个自包含 HTML（marked + highlight.js 也一并内嵌），产物双击 file:// 即用。
 *
 * 用法：npm run build   （或 node build-docs.mjs）
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, '学习库.html');

/* ---------------- 顶层领域与优先级 ---------------- */
// 文档库实际位于 doc/ 目录下；页面逻辑路径相对 doc/ 根，不暴露 doc/ 前缀
const DOC_ROOT = 'doc';
// 顶层顺序：文件夹在前（常识/法律/软件），规则文档《编写规范.md》放最后
const TOP_ORDER = ['常识', '法律', '软件', '编写规范.md'];
const SCAN_DIRS = ['常识', '法律', '软件']; // doc/ 下递归扫描的目录
const ROOT_FILE = '编写规范.md';

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
  const tree = [];
  // 顶层显式排序
  const topItems = [];
  for (const name of TOP_ORDER) {
    if (name === ROOT_FILE) {
      const abs = path.join(ROOT, DOC_ROOT, ROOT_FILE);
      if (await fileExists(abs)) {
        docs[ROOT_FILE] = await fs.readFile(abs, 'utf8');
        topItems.push({ type: 'file', name: ROOT_FILE, path: ROOT_FILE });
      }
    } else if (SCAN_DIRS.includes(name)) {
      const abs = path.join(ROOT, DOC_ROOT, name);
      if (await fileExists(abs)) {
        const children = await collectMdInDir(abs, name, docs);
        if (children.length) topItems.push({ type: 'folder', name, children });
      }
    }
  }
  // 顶层按 TOP_ORDER 顺序（先文件夹常识/法律/软件，再编写规范.md）
  topItems.sort((a, b) => TOP_ORDER.indexOf(a.name) - TOP_ORDER.indexOf(b.name));
  tree.push(...topItems);
  return { tree, docs };
}
async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
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
  const { tree, docs } = await buildData();
  const { markedJs, markedAlertJs, hljsCore, hljsLangs } = await loadVendors();

  const [headTpl, styleTpl, runtimeTpl, bodyTailTpl] = await Promise.all([
    readTemplate('head.html'),
    readTemplate('style.css'),
    readTemplate('runtime.js'),
    readTemplate('body.html'),
  ]);

  const dataJson = JSON.stringify({ tree, docs }).replace(/</g, '\\u003c');

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
  console.log(`✔ 已生成 ${OUT}`);
  console.log(`  文档数：${count} 篇 | 数据源 ${(Buffer.byteLength(dataJson, 'utf8') / 1024).toFixed(0)} KB | 文件总大小 ${kb} KB`);
}

main().catch((e) => {
  console.error('✘ 构建失败：', e.message);
  process.exit(1);
});
