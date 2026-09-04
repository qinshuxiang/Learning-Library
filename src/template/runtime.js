/* ============================================================
   学习库阅读器 —— 运行时逻辑（无任何外部依赖，纯内联数据）
   ============================================================ */
(function () {
  'use strict';

  var DATA = JSON.parse(document.getElementById('ll-data').textContent);
  var TREE = DATA.tree;      // 递归 {type,name,path/children}
  var DOCS = DATA.docs;      // relPath(含空格/CJK) -> 原始 markdown

  // marked 配置
  marked.setOptions({ gfm: true, breaks: false, langPrefix: 'language-' });

  // GFM 警示框（[!NOTE] 等）支持：标题本地化为中文。
  // marked-alert 通过 <script> 内联暴露全局 markedAlert（见 build-docs.mjs）。
  // 库正文警示框写法统一为“> [!TYPE]”＋“> **中文词**：正文”，此处替换类型标题为中文字样
  // 并配一个轻量统一图标（颜色由 .markdown-alert-* 背景区分），避免默认英文标题与 SVG 重复。
  if (typeof markedAlert === 'function') {
    var ALERT_ZH = { note: '说明', tip: '提示', important: '重要', warning: '警告', caution: '注意' };
    var ALERT_ICON =
      '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 1.5A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5Zm-.75 4a.75.75 0 0 1 1.5 0v2.5a.75.75 0 0 1-1.5 0v-2.5ZM8 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>';
    var zhVariants = ['note', 'tip', 'important', 'warning', 'caution'].map(function (t) {
      return { type: t, title: ALERT_ZH[t] || t, icon: ALERT_ICON };
    });
    marked.use(markedAlert({ variants: zhVariants }));
  }

  // 索引文件中的链接形如 [N. 名称.md](./N. 名称.md)，URL 含空格导致 CommonMark
  // 不识别为合法链接。预处理：仅对以 .md 结尾的相对链接 URL 部分做空格转义。
  function preProcessMdLinks(src) {
    return src.replace(/\(\.\/[^)\n]*?\.md\)/g, function (m) {
      // m 形如 "(./N. 名称.md)"，去掉首尾括号后编码空格
      var inner = m.slice(2, -1);
      if (inner.indexOf(' ') === -1) return m;
      return '(' + inner.replace(/ /g, '%20') + ')';
    });
  }

  var ROOT_LABEL = '学习资料库';

  /* ---------------- 路径 / 展示名工具 ---------------- */
  function stripNum(name) {
    return String(name).replace(/^\d+\.\s+/, '').replace(/\.md$/i, '');
  }
  function docTitle(path) {
    var base = path.split('/').pop();
    return stripNum(base);
  }
  function dirOf(path) {
    var i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(0, i) : '';
  }
  function fileBase(path) { return path.split('/').pop(); }
  // 供站内 .md 链接解析：current 相对路径 + 链接目标
  function resolveRel(baseDir, target) {
    var parts = baseDir ? baseDir.split('/') : [];
    var segs = target.split('/');
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s === '' || s === '.') continue;
      if (s === '..') { parts.pop(); }
      else parts.push(s);
    }
    return parts.join('/');
  }

  /* ---------------- 侧栏树渲染 ---------------- */
  var treeEl = document.getElementById('tree');
  var resEl = document.getElementById('search-results');
  var searchInput = document.getElementById('search');
  var searchClear = document.getElementById('search-clear');

  function countDocs(node) {
    if (node.type === 'file') return 1;
    var n = 0;
    (node.children || []).forEach(function (c) { n += countDocs(c); });
    return n;
  }

  function isTopDomain(name) {
    return name === '常识' || name === '法律' || name === '软件';
  }

  function renderNode(node, isTop, parentPath) {
    var div = document.createElement('div');
    div.className = 'tnode';

    if (node.type === 'file') {
      var frow = document.createElement('div');
      frow.className = 'trow file' + (isTop ? ' topdoc' : '');
      frow.dataset.path = node.path;
      frow.title = node.path;
      var fi = document.createElement('span');
      fi.className = 'ico f'; fi.textContent = '\u2013';
      var fn = document.createElement('span');
      fn.className = 'nm'; fn.textContent = stripNum(node.name);
      frow.appendChild(fi); frow.appendChild(fn);
      div.appendChild(frow);
      return div;
    }

    // folder —— 默认全部收起（配合“任意层级互斥”手风琴）
    var folderPath = parentPath ? parentPath + '/' + node.name : node.name;
    var g = document.createElement('div');
    g.className = 'tnode group';
    g.setAttribute('data-fpath', folderPath);
    var hrow = document.createElement('div');
    hrow.className = 'trow folder' + (isTop && isTopDomain(node.name) ? ' domain' : '');
    var caret = document.createElement('span');
    caret.className = 'ico caret'; caret.textContent = '\u25B6';
    var nm = document.createElement('span');
    nm.className = 'nm'; nm.textContent = node.name;
    var badge = document.createElement('span');
    badge.className = 'badge'; badge.textContent = countDocs(node);
    hrow.appendChild(caret); hrow.appendChild(nm); hrow.appendChild(badge);
    g.appendChild(hrow);

    var wrap = document.createElement('div');
    wrap.className = 'tchildren';
    wrap.style.display = 'none';
    (node.children || []).forEach(function (c) {
      wrap.appendChild(renderNode(c, false, folderPath));
    });
    g.appendChild(wrap);
    return g;
  }

  function buildTree() {
    treeEl.innerHTML = '';
    TREE.forEach(function (n) {
      treeEl.appendChild(renderNode(n, true, ''));
    });
  }

  // 打开/收起一个文件夹组；返回该组 element
  function setGroup(g, open, alsoCloseOthers) {
    if (!g) return;
    var wasOpen = g.classList.contains('open');
    if (open === wasOpen) { if (open && alsoCloseOthers) collapseBranchesExcept(g); return; }
    if (open) {
      g.classList.add('open');
      if (alsoCloseOthers) collapseBranchesExcept(g);
    } else {
      g.classList.remove('open');
    }
    syncGroup(g);
  }
  function syncGroup(g) {
    var wrap = g.querySelector(':scope > .tchildren');
    var row = g.querySelector(':scope > .trow');
    var open = g.classList.contains('open');
    if (row) row.classList.toggle('open', open);
    if (wrap) wrap.style.display = open ? '' : 'none';
  }
  // 手风琴：关闭所有“非 g、也非 g 的祖先”的组（保证同时只展开一条链）
  function collapseBranchesExcept(g) {
    var all = treeEl.querySelectorAll('.tnode.group');
    for (var i = 0; i < all.length; i++) {
      var x = all[i];
      if (x === g) continue;
      if (isAncestorOf(x, g)) continue;   // g 的祖先保持展开
      if (g.contains(x)) continue;         // g 的后代（子目录）不强制
      if (x.classList.contains('open')) {
        x.classList.remove('open');
        syncGroup(x);
      }
    }
  }
  function isAncestorOf(anc, node) {
    var p = node.parentElement;
    while (p) {
      if (p === anc) return true;
      p = p.parentElement;
    }
    return false;
  }

  /* 展开/收起（事件委托） */
  treeEl.addEventListener('click', function (e) {
    var row = e.target.closest ? e.target.closest('.trow') : null;
    if (!row || !treeEl.contains(row)) return;
    if (row.classList.contains('folder')) {
      var g = row.parentElement;
      var open = !g.classList.contains('open');
      setGroup(g, open, true);
      if (open) revealActive();
    } else if (row.dataset.path) {
      selectDoc(row.dataset.path);
    }
  });

  function revealActive() {
    var active = treeEl.querySelector('.trow.file.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function setActiveInTree(path) {
    var rows = treeEl.querySelectorAll('.trow.file');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('active', rows[i].dataset.path === path);
    }
  }
  // 展开到目标文档的祖先链；同时收起所有不在该链上的文件夹（单链手风琴）
  function expandTo(path) {
    var segs = path.split('/');
    var chain = [];
    var acc = '';
    for (var i = 0; i < segs.length - 1; i++) {   // 最后一节是文件名
      acc = acc ? acc + '/' + segs[i] : segs[i];
      chain.push(acc);
    }
    var all = treeEl.querySelectorAll('.tnode.group');
    for (var i = 0; i < all.length; i++) {
      var f = all[i].getAttribute('data-fpath');
      var open = chain.indexOf(f) !== -1;
      if (open !== all[i].classList.contains('open')) {
        all[i].classList.toggle('open', open);
        syncGroup(all[i]);
      }
    }
  }
  function findGroupByFolderPath(root, folderPath) {
    var all = root.querySelectorAll('.tnode.group');
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute('data-fpath') === folderPath) return all[i];
    }
    return null;
  }

  /* ---------------- 文档渲染 ---------------- */
  var docEl = document.getElementById('doc');
  var contentScroll = document.querySelector('.content-scroll');

  function openDoc(path) {
    var raw = DOCS[path];
    if (raw == null) { renderMissing(path); return; }

    // 索引文件预处理：URL 中的空格转义，让 marked 识别为合法链接
    var src = preProcessMdLinks(raw);

    // 标记渲染
    var html = marked.parse(src);

    // 先插入再后处理
    docEl.innerHTML = html;

    postProcess(path);

    // 更新 UI
    currentOpenPath = path;
    setActiveInTree(path);
    document.title = docTitle(path) + ' · ' + ROOT_LABEL;
    updateFoot(path);
    refreshActiveInResults();
    contentScroll.scrollTop = 0;

    // 记录 hash（不触发重复渲染）
    if (location.hash !== ('#doc=' + encodeURIComponent(path))) {
      try { history.replaceState(null, '', '#doc=' + encodeURIComponent(path)); } catch (e) {}
    }
  }

  function renderMissing(path) {
    docEl.innerHTML = '<h2>未找到文档</h2><p>路径：<code>' + escapeHtml(path) + '</code></p>';
    document.title = '未找到 · ' + ROOT_LABEL;
  }

  function postProcess(path) {
    var baseDir = dirOf(path);

    // 1) 标题锚点 + id
    var headings = docEl.querySelectorAll('h1,h2,h3,h4,h5,h6');
    var used = {};
    var idx = 0;
    headings.forEach(function (h) {
      idx++;
      var id = 'sec-' + idx;
      if (used[id]) id = id + '-' + idx;
      used[id] = true;
      h.id = id;
      var a = document.createElement('a');
      a.className = 'anchor'; a.href = '#' + id; a.textContent = '\u00B6';
      h.appendChild(a);
    });

    // 2) 代码高亮：仅带语言标注的围栏（裸 ``` 不染色）
    var codes = docEl.querySelectorAll('pre code');
    codes.forEach(function (code) {
      var cls = (code.className || '').trim();
      if (/language-/.test(cls)) {
        try { hljs.highlightElement(code); } catch (e) {}
      }
    });

    // 3) 任务列表复选框（编写规范.md 自检清单）。marked 在 gfm 下会原生产出
    //    <li class="task-list-item"><input...>，故此处仅在未产出 input 时兜底。
    docEl.querySelectorAll('li').forEach(function (li) {
      if (li.querySelector('input[type="checkbox"]')) return;
      if (li.className.indexOf('task-list-item') >= 0 || li.className.indexOf('task-item') >= 0) return;
      var firstText = li.firstChild;
      if (firstText && firstText.nodeType === 3) {
        var m = /^\[( |x|X)\]\s+(.*)$/.exec(firstText.textContent);
        if (m) {
          li.classList.add('task-list-item');
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.disabled = true;
          if (m[1] !== ' ') cb.checked = true;
          li.insertBefore(cb, firstText);
          firstText.textContent = m[2];
        }
      }
    });

    // 4) 站内 .md 链接点击委托（交给全局监听，此处不绑）
    decorateMdLinks(docEl, baseDir, path);

    // 5) 依据已生成 id 的标题，重建右侧目录
    buildToc();
  }

  /* ============================================================
     右侧目录（TOC）：自动提取正文标题 → 点击平滑滚动 → scrollspy 高亮
     纯原生实现：DOM 遍历 + scroll 事件 + rAF 节流，不依赖任何库
     ============================================================ */
  var tocEl = document.getElementById('toc');
  var tocListEl = document.getElementById('toc-list');
  var tocFab = document.getElementById('toc-fab');
  var tocMask = document.getElementById('toc-mask');
  var tocClose = document.getElementById('toc-close');

  var NARROW_MQ = window.matchMedia ? window.matchMedia('(max-width: 1180px)') : null;
  function isNarrow() { return NARROW_MQ ? NARROW_MQ.matches : window.innerWidth <= 1180; }

  var tocItems = [];        // { id, level, text, el, target }
  var SPY_OFFSET = 18;      // 判定“当前章节”的顶部容差
  var GO_OFFSET = 14;       // 点击滚动后标题距容器顶部的留白
  var spyLockUntil = 0;     // 程序滚动期间暂时锁定 scrollspy，避免高亮乱跳
  var spyTarget = -1;       // 程序滚动的目标位置；到达即解锁（比死等超时更准）

  /* 提取标题（H2~H6；H1 由文档标题占用，不进目录） */
  function collectHeadings() {
    var hs = docEl.querySelectorAll('h2,h3,h4,h5,h6');
    var minLevel = 6;
    var list = [];
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      var lv = parseInt(h.tagName.charAt(1), 10);
      if (lv < minLevel) minLevel = lv;
      list.push({ id: h.id, level: lv, text: headingText(h), target: h });
    }
    // 以最小层级为基准压平缩进（如文档只有 H3/H4，则 H3 顶格）
    for (var j = 0; j < list.length; j++) list[j].depth = list[j].level - minLevel;
    return list;
  }
  // 标题文本：去掉尾部追加的锚点符号 ¶
  function headingText(h) {
    var clone = h.cloneNode(true);
    var a = clone.querySelector('.anchor');
    if (a) a.parentNode.removeChild(a);
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function buildToc() {
    tocItems = collectHeadings();
    tocListEl.innerHTML = '';
    spyLockUntil = 0;          // 换文档时清除遗留的滚动锁定
    spyTarget = -1;

    if (!tocItems.length) {
      var empty = document.createElement('div');
      empty.id = 'toc-empty';
      empty.textContent = '本文无小节标题';
      tocListEl.appendChild(empty);
      tocEl.classList.add('is-empty');
      return;
    }
    tocEl.classList.remove('is-empty');

    var frag = document.createDocumentFragment();
    for (var i = 0; i < tocItems.length; i++) {
      var it = tocItems[i];
      var a = document.createElement('a');
      a.className = 'toc-link toc-lv' + (it.depth + 1);
      a.href = '#' + it.id;                 // 保留锚点语义；点击被 preventDefault 接管
      a.textContent = it.text;
      a.title = it.text;
      a.dataset.target = it.id;
      a.setAttribute('role', 'button');
      frag.appendChild(a);
      it.el = a;
    }
    tocListEl.appendChild(frag);
    tocListEl.scrollTop = 0;
    syncTocActive(tocItems[0].id);
  }

  /* 点击目录项 → 平滑滚动定位（滚动容器是 .content-scroll，不是 window） */
  tocListEl.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('.toc-link') : null;
    if (!a || !tocListEl.contains(a)) return;
    e.preventDefault();
    var id = a.dataset.target;
    var h = document.getElementById(id);
    if (!h) return;
    var cTop = contentScroll.getBoundingClientRect().top;
    var hTop = h.getBoundingClientRect().top;
    var top = contentScroll.scrollTop + (hTop - cTop) - GO_OFFSET;
    spyTarget = top;                          // 到达目标即解锁
    spyLockUntil = Date.now() + 900;          // 超时兜底
    syncTocActive(id);
    smoothScrollTo(top);
    if (isNarrow()) closeTocDrawer();
  });

  function smoothScrollTo(top) {
    if (top < 0) top = 0;
    spyTarget = top;                          // 以 clamp 后的最终值为准
    try {
      contentScroll.scrollTo({ top: top, behavior: 'smooth' });
    } catch (err) {
      contentScroll.scrollTop = top;           // 不支持平滑滚动时直接定位
    }
  }

  /* scrollspy：滚动时高亮当前所在章节 */
  var spyTicking = false;
  contentScroll.addEventListener('scroll', function () {
    if (spyTicking) return;
    spyTicking = true;
    window.requestAnimationFrame(function () {
      spyTicking = false;
      // 程序滚动已到位 → 立即解锁并同步高亮
      if (spyTarget >= 0 && Math.abs(contentScroll.scrollTop - spyTarget) <= 2) {
        spyTarget = -1; spyLockUntil = 0; updateSpy(); return;
      }
      if (Date.now() < spyLockUntil) return;
      updateSpy();
    });
  }, { passive: true });

  function updateSpy() {
    if (!tocItems.length) return;
    var cTop = contentScroll.getBoundingClientRect().top;
    var current = tocItems[0];
    for (var i = 0; i < tocItems.length; i++) {
      var t = tocItems[i].target;
      if (!t || !t.isConnected) continue;
      if (t.getBoundingClientRect().top - cTop - SPY_OFFSET <= 0) current = tocItems[i];
      else break;
    }
    // 滚到底部时强制高亮最后一项，避免末节因高度不足永不激活
    if (contentScroll.scrollTop + contentScroll.clientHeight >= contentScroll.scrollHeight - 4) {
      current = tocItems[tocItems.length - 1];
    }
    syncTocActive(current.id);
  }

  function syncTocActive(id) {
    if (!id) return;
    for (var i = 0; i < tocItems.length; i++) {
      if (tocItems[i].el) tocItems[i].el.classList.toggle('active', tocItems[i].id === id);
    }
    var act = tocListEl.querySelector('.toc-link.active');
    if (!act) return;
    // 让高亮项始终留在目录可视区内（目录自身可独立滚动）
    var lr = tocListEl.getBoundingClientRect();
    var ar = act.getBoundingClientRect();
    if (ar.top < lr.top + 4) tocListEl.scrollTop -= (lr.top + 4 - ar.top);
    else if (ar.bottom > lr.bottom - 4) tocListEl.scrollTop += (ar.bottom - (lr.bottom - 4));
  }

  /* 目录的展开 / 收起：宽屏为常驻栏可手动收起，窄屏自动折叠为抽屉 */
  function openTocDrawer() {
    if (isNarrow()) {
      tocEl.classList.add('open');
      tocMask.hidden = false;
    } else {
      document.body.classList.remove('toc-off');
    }
  }
  function closeTocDrawer() {
    if (isNarrow()) {
      tocEl.classList.remove('open');
      tocMask.hidden = true;
    } else {
      document.body.classList.add('toc-off');
    }
  }
  tocFab.addEventListener('click', function () { openTocDrawer(); });
  tocClose.addEventListener('click', function () { closeTocDrawer(); });
  tocMask.addEventListener('click', function () { closeTocDrawer(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && tocEl.classList.contains('open')) closeTocDrawer();
  });
  // 视口变化时清理抽屉状态（如从窄屏拉宽）
  if (NARROW_MQ && NARROW_MQ.addEventListener) {
    NARROW_MQ.addEventListener('change', function () {
      tocEl.classList.remove('open');
      tocMask.hidden = true;
    });
  }

  /* 让正文中的 .md 相对链接指向本地文档；其余链接保留但阻止默认跳转并提示 */
  function decorateMdLinks(container, baseDir, currentPath) {
    var links = container.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute('href') || '';
      if (href.charAt(0) === '#') continue;           // 页内锚点
      if (/\.md(?:\?|#|$)/i.test(href)) {             // 指向 md
        var target = href.split('#')[0].split('?')[0];
        try { target = decodeURIComponent(target); } catch (e) {}
        var resolved = resolveRel(baseDir, target);
        a.dataset.docTarget = DOCS[resolved] != null ? resolved : '';
        if (DOCS[resolved] != null) {
          a.classList.add('doc-link');
          if (resolved !== currentPath) {
            a.href = '#doc=' + encodeURIComponent(resolved);
          } else {
            a.href = 'javascript:void(0)';
            a.title = '当前文档';
          }
        }
      } else if (/^https?:/i.test(href)) {
        a.target = '_blank'; a.rel = 'noopener';
      } else {
        // 其他本地相对引用（如图片等）——当前库无图片；保留原样
      }
    }
  }

  function updateFoot(path) {
    var fp = document.getElementById('foot-path');
    var fm = document.getElementById('foot-meta');
    fp.textContent = path;
    if (DOCS[path] != null) {
      var raw = DOCS[path];
      var lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
      fm.textContent = lines.length + ' 行 · ' + (raw.length) + ' 字符';
    } else {
      fm.textContent = '';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------------- 文档切换 ---------------- */
  function selectDoc(path) {
    if (!DOCS[path]) return;
    expandTo(path);
    openDoc(path);
  }

  /* ---------------- 搜索（文件名 + 正文全文） ---------------- */
  var docIdxCache = [];          // {path, name, text(小写全文)}
  var idxBuilt = false;

  function ensureIdx() {
    if (idxBuilt) return;
    var paths = Object.keys(DOCS);
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      var raw = DOCS[p];
      docIdxCache.push({
        path: p,
        name: stripNum(p.split('/').pop()).toLowerCase(),
        text: raw.toLowerCase()
      });
    }
    idxBuilt = true;
  }

  function searchDocs(q) {
    ensureIdx();
    var name = [];
    var content = [];
    for (var i = 0; i < docIdxCache.length; i++) {
      var d = docIdxCache[i];
      if (d.name.indexOf(q) !== -1 || d.text.indexOf(q) !== -1) {
        (d.name.indexOf(q) !== -1 ? name : content).push(d.path);
      }
    }
    // 名称命中在前（按路径自然序），正文命中在后
    name.sort(); content.sort();
    return name.concat(content);
  }

  function makeSnippet(text, q) {
    var idx = text.indexOf(q);
    if (idx < 0) return '';
    var start = Math.max(0, idx - 26);
    var slice = text.slice(start, idx + q.length + 34);
    slice = slice.replace(/\s+/g, ' ');
    // 高亮
    var esc = escapeHtml(slice);
    var hl = esc.replace(new RegExp('(' + escReg(q) + ')', 'gi'), '<mark>$1</mark>');
    var prefix = start > 0 ? '…' : '';
    return prefix + hl + '…';
  }
  function escReg(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function runSearch() {
    var q = searchInput.value.trim().toLowerCase();
    treeEl.hidden = q.length > 0;
    resEl.hidden = q.length === 0;
    searchClear.style.visibility = q.length ? 'visible' : 'hidden';
    if (!q) return;

    resEl.innerHTML = '';
    var hits = searchDocs(q);
    // 顶部汇总行
    var meta = document.createElement('div');
    meta.id = 'search-meta';
    meta.textContent = '命中 ' + hits.length + ' 篇' + (hits.length ? '' : '');
    resEl.appendChild(meta);

    if (!hits.length) {
      var empty = document.createElement('div');
      empty.id = 'search-empty';
      empty.innerHTML = '未找到与 “' + escapeHtml(q) + '” 相关的文档';
      resEl.appendChild(empty);
      return;
    }
    for (var i = 0; i < hits.length; i++) {
      var path = hits[i];
      var item = document.createElement('div');
      item.className = 'sresult' + (path === currentOpenPath ? ' active' : '');
      item.dataset.path = path;
      var nm = document.createElement('div');
      nm.className = 'r-name';
      nm.innerHTML = highlight(escapeHtml(docDisplayName(path)), escReg(q));
      var pt = document.createElement('div');
      pt.className = 'r-path'; pt.textContent = dirOf(path) ? dirOf(path) + '/' : '';
      item.appendChild(nm); item.appendChild(pt);
      // 正文片段（若命中正文）
      if (docIdxLookup(path).name.indexOf(q) === -1) {
        var sn = document.createElement('div');
        sn.className = 'r-snippet';
        sn.innerHTML = makeSnippet(docIdxLookup(path).text, q);
        item.appendChild(sn);
      }
      resEl.appendChild(item);
    }
  }
  var currentOpenPath = '';
  function refreshActiveInResults() {
    var items = resEl.querySelectorAll('.sresult');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', items[i].dataset.path === currentOpenPath);
    }
  }
  function docIdxLookup(path) {
    ensureIdx();
    for (var i = 0; i < docIdxCache.length; i++) if (docIdxCache[i].path === path) return docIdxCache[i];
    return { name: '', text: '' };
  }
  function docDisplayName(path) {
    return stripNum(path.split('/').pop());
  }
  function highlight(escaped, re) {
    return escaped.replace(new RegExp('(' + re + ')', 'gi'), '<mark>$1</mark>');
  }

  // 搜索框交互
  searchInput.addEventListener('input', function () { runSearch(); });
  searchClear.addEventListener('click', function () {
    searchInput.value = '';
    runSearch();
    searchInput.focus();
  });
  resEl.addEventListener('click', function (e) {
    var it = e.target.closest ? e.target.closest('.sresult') : null;
    if (!it || !it.dataset.path) return;
    if (DOCS[it.dataset.path]) selectDoc(it.dataset.path);
  });

  /* ---------------- 全局点击委托（站内 md 链接 / 页内锚点） ---------------- */
  docEl.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !docEl.contains(a)) return;

    // 锚点链接（含标题 ¶）
    if (a.hash && a.hash.length > 1 && a.hash.charAt(0) === '#' && a.pathname === location.pathname) {
      var t = docEl.querySelector(a.hash);
      if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); e.preventDefault(); return; }
    }
    // 站内 .md 链接
    if (a.hash && a.hash.indexOf('#doc=') === 0) {
      var p;
      try { p = decodeURIComponent(a.hash.slice(5)); } catch (err) { return; }
      if (DOCS[p]) { e.preventDefault(); selectDoc(p); }
    }
  });

  /* ---------------- hash 路由（浏览器前进/后退/刷新恢复） ---------------- */
  function routeFromHash() {
    var h = location.hash;
    if (h.indexOf('#doc=') === 0) {
      var p;
      try { p = decodeURIComponent(h.slice(5)); } catch (e) { return null; }
      if (DOCS[p]) return p;
    }
    return null;
  }
  window.addEventListener('hashchange', function () {
    var p = routeFromHash();
    if (p) selectDoc(p);
  });

  /* ---------------- 启动 ---------------- */
  function start() {
    buildTree();
    var init = routeFromHash();
    var docToOpen = init || (DOCS['编写规范.md'] ? '编写规范.md' : firstDoc(TREE));
    if (init) expandTo(init);
    openDoc(docToOpen);   // openDoc 内 replaceState 记 hash，不触发 hashchange
    var i = setTimeout(function () {
      var active = treeEl.querySelector('.trow.file.active');
      if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }, 60);
  }
  function firstDoc(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.type === 'file') return n.path;
      if (n.children) { var r = firstDoc(n.children); if (r) return r; }
    }
    return null;
  }

  start();
})();
