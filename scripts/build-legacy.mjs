/**
 * 构建期生成器（挂 package.json 的 postbuild）
 *
 * 从 src/content/专升本/** 这一份内容源，产出两套互不干扰的静态产物：
 *   1. /l/**        适老化 / 旧浏览器基础页（IE9 / Android 4.0 WebView 可用）
 *   2. rss*.xml      RSS 2.0 全站源 + 按科目/类别的分频道源
 *
 * 设计依据：PROMPT-zsb-tiku.md 第七节
 *   - 7.2 独立的适老化网站「页面内容应与原网站的主要内容保持一致」「扁平化」
 *   - 7.4 同一内容源、双份产物；不经过 Astro 的 Layout / 组件 / module script 链
 *   - 7.5 RSS 栏目级订阅、纯 XML 零 JS、自动发现
 *   - 7.8 大文档构建期分片：源文件保持完整，只在产物里切开，按需加载
 *
 * /l/ 页面默认外链同目录 legacy.css（可缓存、跨分片只下载一次，省带宽），
 * JS 用相对路径，整个目录可直接打包成离线 HTML 包用 file:// 打开；
 * LEGACY_INLINE_CSS=1 可切回全内联，供「单个 HTML 文件拷走」的场景。
 * 分片不改源文件：src/content/专升本/**.md 始终是一份完整文档，切分只发生在
 * 构建期内存里，产物片按顺序拼接可逐字符还原原文（split.mjs 内置强断言）。
 */
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import customProperties from 'postcss-custom-properties';
import autoprefixer from 'autoprefixer';
import { marked } from 'marked';
import { loadEntries } from './lib/content.mjs';
import { splitMarkdown, partFilename } from './lib/split.mjs';
import {
  ROOT,
  LEGACY_CSS_SRC,
  ENHANCE_JS_SRC,
  SUBJECTS,
  CATEGORIES,
  SITE_URL,
  SITE_TITLE,
  SITE_DESC,
  escHtml,
  escXml,
  lPrefix,
  INLINE_CSS,
  writeText
} from './lib/config.mjs';
import { outDir } from './lib/config.mjs';

const OUT_ROOT = outDir();
const L_DIR = path.join(OUT_ROOT, 'l');

/* ------------------------------------------------------------------ *
 * 1. 编译 legacy.css：CSS 变量 → 静态值，补老内核前缀
 * ------------------------------------------------------------------ */
async function buildCss() {
  const src = fs.readFileSync(LEGACY_CSS_SRC, 'utf8');
  // 目标浏览器由 package.json 的 browserslist.legacy 驱动，避免声明与实际构建脱节
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const targets = (pkg.browserslist && pkg.browserslist.legacy) || ['ie >= 9', 'Android >= 4'];
  const result = await postcss([
    // preserve: false 会把 var(--x) 全部展开并移除变量声明。
    // 若为 true（默认），IE9 会整条跳过带 var() 的声明 —— 这是最常见的坑。
    customProperties({ preserve: false }),
    autoprefixer({ overrideBrowserslist: targets })
  ]).process(src, { from: LEGACY_CSS_SRC });
  return result.css;
}

/* ------------------------------------------------------------------ *
 * 2. HTML 模板
 * ------------------------------------------------------------------ */
function bar(prefix) {
  return [
    '<div class="l-bar">',
    '  <a class="l-btn" href="/zsb/">← 返回正常版</a>',
    '  <span class="l-brand">长者版 / 极简版</span>',
    '  <span class="l-tools" id="l-tools"></span>',
    '</div>'
  ].join('\n');
}

function foot(prefix) {
  return [
    '<div class="l-foot">',
    '  <p>本页为适老化 / 旧浏览器基础版，与主站共用同一份内容源，题目与答案逐条一致；答案默认展开，无需 JavaScript 即可完整阅读。</p>',
    '  <p><a href="' + prefix + 'rss.xml">RSS 订阅（全站）</a> · ' +
      '<a href="' + prefix + 'rss.html">订阅说明与分频道</a> · ' +
      '<a href="/zsb/">返回正常版</a></p>',
    '  <p>未实现项：语音朗读。本项目无验证码、不提供邮件订阅，故不涉及退订流程。详见 PROMPT-zsb-tiku.md 7.2 / 7.5。</p>',
    '</div>'
  ].join('\n');
}

function page(opts) {
  const prefix = opts.prefix;
  // 标题已含站点名时不再追加后缀，避免「专插本资料库 · 长者版 | 长者版 · 专插本资料库」
  const fullTitle = opts.title.indexOf(SITE_TITLE) >= 0
    ? opts.title
    : opts.title + ' | 长者版 · ' + SITE_TITLE;
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, target-densitydpi=device-dpi">',
    '<title>' + escHtml(fullTitle) + '</title>',
    '<meta name="description" content="' + escHtml(opts.description) + '">',
    '<link rel="alternate" type="application/rss+xml" title="' +
      escHtml(SITE_TITLE) + ' RSS" href="' + escHtml(SITE_URL) + '/rss.xml">',
    // 外链可被浏览器缓存：分片后同一次阅读的 N 个页面只下载一次 CSS。
    // LEGACY_INLINE_CSS=1 时回到全内联，供「单个 HTML 文件拷走」的场景。
    INLINE_CSS
      ? '<style>\n' + opts.css + '\n</style>'
      : '<link rel="stylesheet" href="' + prefix + 'legacy.css">',
    '<script defer src="' + prefix + 'enhance.js"><\/script>',
    '</head>',
    '<body>',
    bar(prefix),
    '<main class="l-main">',
    opts.bodyHtml,
    '</main>',
    foot(prefix),
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

function renderList(entries, prefix) {
  if (entries.length === 0) return '<p>暂无资料。</p>';
  return [
    '<ul class="l-list">',
    ...entries.map((e) => {
      const meta = [
        e.subjectLabel,
        e.categoryLabel,
        e.year ? e.year + ' 年' : '',
        e.answerProvided ? '含答案' : '暂无答案'
      ].filter(Boolean).join(' · ');
      return (
        '<li><a href="' + escHtml(prefix + e.slug + '.html') + '">' +
        escHtml(e.title) +
        '<span class="l-list-meta">' + escHtml(meta) + '</span></a></li>'
      );
    }),
    '</ul>'
  ].join('\n');
}

function navLinks(entries, prefix) {
  const subjects = [...new Set(entries.map((e) => e.subjectKey))].filter((k) => SUBJECTS[k]);
  const categories = [...new Set(entries.map((e) => e.category))].filter((k) => CATEGORIES[k]);
  const a = (href, label) => '<a href="' + prefix + href + '">' + escHtml(label) + '</a>';
  return [
    '<div class="l-nav">按科目：' +
      subjects.map((k) => a('subject/' + k + '.html', SUBJECTS[k])).join(' · ') +
      '</div>',
    '<div class="l-nav">按类别：' +
      categories.map((k) => a('category/' + k + '.html', CATEGORIES[k])).join(' · ') +
      '</div>'
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * 2.1 分片导航（7.8）：零 JS 可翻页，ES5 脚本可选做滚到底自动续读
 * ------------------------------------------------------------------ */
function pager(slug, index, total, prefix, withIds) {
  const hrefOf = (i) => prefix + partFilename(slug, i);
  const a = (href, label, id) =>
    '<a class="l-btn"' + (id ? ' id="' + id + '"' : '') +
    ' href="' + escHtml(href) + '">' + escHtml(label) + '</a>';

  const links = [];
  if (index > 1) links.push(a(hrefOf(index - 1), '← 上一页'));
  links.push(a(prefix + 'index.html', '资料库目录'));
  // id="l-next" 只出现在页面底部那份导航，供 ES5 增强脚本定位；
  // 顶部导航不带 id，避免同一页出现重复 ID。
  if (index < total) links.push(a(hrefOf(index + 1), '下一页 →', withIds ? 'l-next' : ''));

  const toc = [];
  for (let i = 1; i <= total; i++) {
    toc.push('<a class="' + (i === index ? 'l-cur' : '') +
      '" href="' + escHtml(hrefOf(i)) + '">' + i + '</a>');
  }

  return [
    '<div class="l-pager">',
    '  <p class="l-pageinfo"' + (withIds ? ' id="l-pageinfo"' : '') + '>本资料共 ' + total +
      ' 页，当前第 ' + index + ' / ' + total +
      ' 页。按需加载：未读的页不会被下载，翻到本页末尾才会读取下一页。</p>',
    '  <div class="l-pager-links">' + links.join(' ') + '</div>',
    '  <div class="l-toc">跳到：' + toc.join(' ') + '</div>',
    '  <p class="l-loading"' + (withIds ? ' id="l-loading"' : '') + '></p>',
    '</div>'
  ].join('\n');
}

/**
 * 清理上一次构建留下的分片文件（源文档变小时片数会减少，避免残页）。
 * 只删 <slug>-<数字>.html，绝不碰首片 <slug>.html 与其他文档。
 */
function cleanOldParts(slug) {
  const dir = path.join(L_DIR, path.dirname(slug));
  const base = path.basename(slug);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.indexOf(base + '-') === 0 && /-\d+\.html$/.test(name)) {
      fs.unlinkSync(path.join(dir, name));
    }
  }
}

/* ------------------------------------------------------------------ *
 * 3. RSS 2.0
 * ------------------------------------------------------------------ */
function itemXml(e) {
  return [
    '<item>',
    '<title>' + escXml(e.title) + '</title>',
    '<link>' + escXml(e.url) + '</link>',
    '<guid isPermaLink="false">' + escXml('zsb:' + e.slug) + '</guid>',
    '<pubDate>' + escXml(e.pubDate) + '</pubDate>',
    '<description>' + escXml(e.excerpt) + '</description>',
    '<category>' + escXml(e.categoryLabel) + '</category>',
    '</item>'
  ].join('\n');
}

function rssXml(opts) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    '<title>' + escXml(opts.title) + '</title>',
    '<link>' + escXml(opts.link) + '</link>',
    '<description>' + escXml(opts.description) + '</description>',
    '<language>zh-CN</language>',
    '<lastBuildDate>' + escXml(new Date().toUTCString()) + '</lastBuildDate>',
    '<atom:link href="' + escXml(opts.feedUrl) + '" rel="self" type="application/rss+xml" />',
    ...opts.items.map(itemXml),
    '</channel>',
    '</rss>',
    ''
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * 4. 主流程
 * ------------------------------------------------------------------ */
async function main() {
  const css = await buildCss();
  const entries = loadEntries();

  fs.mkdirSync(L_DIR, { recursive: true });

  // ES5 增强脚本 + 编译后的 CSS（CSS 也单独留一份供查阅 / 复用）
  fs.copyFileSync(ENHANCE_JS_SRC, path.join(L_DIR, 'enhance.js'));
  writeText(path.join(L_DIR, 'legacy.css'), css);

  // ---- 4.1 首页 ----
  const homeBody = [
    '<p class="l-crumb"><a href="index.html">资料库</a> / 首页</p>',
    '<h1>' + escHtml(SITE_TITLE) + ' · 长者版</h1>',
    '<p class="l-note">大字号、线性排版、无脚本依赖。内容与主站完全一致；如需答题 / 错题本，请点右上角「返回正常版」。</p>',
    '<p>共收录 <strong>' + entries.length + '</strong> 份资料。</p>',
    navLinks(entries, ''),
    '<h2>全部资料</h2>',
    renderList(entries, '')
  ].join('\n');
  writeText(
    path.join(L_DIR, 'index.html'),
    page({
      title: SITE_TITLE + ' · 长者版',
      description: SITE_DESC + '（适老化 / 旧浏览器基础版）',
      bodyHtml: homeBody,
      css,
      prefix: ''
    })
  );

  // ---- 4.2 科目 / 类别静态索引页（零 JS 筛选，对应 7.4 允许的第二种形态） ----
  const usedSubjects = [...new Set(entries.map((e) => e.subjectKey))].filter((k) => SUBJECTS[k]);
  const usedCategories = [...new Set(entries.map((e) => e.category))].filter((k) => CATEGORIES[k]);

  for (const key of usedSubjects) {
    const list = entries.filter((e) => e.subjectKey === key);
    const file = path.join(L_DIR, 'subject', key + '.html');
    const body = [
      '<p class="l-crumb"><a href="' + lPrefix(file, L_DIR) + 'index.html">资料库</a> / ' +
        escHtml(SUBJECTS[key]) + '</p>',
      '<h1>' + escHtml(SUBJECTS[key]) + '（' + list.length + ' 份）</h1>',
      navLinks(entries, lPrefix(file, L_DIR)),
      renderList(list, lPrefix(file, L_DIR))
    ].join('\n');
    writeText(file, page({
      title: SUBJECTS[key],
      description: SITE_TITLE + ' - ' + SUBJECTS[key] + '资料列表',
      bodyHtml: body, css, prefix: lPrefix(file, L_DIR)
    }));
  }

  for (const key of usedCategories) {
    const list = entries.filter((e) => e.category === key);
    const file = path.join(L_DIR, 'category', key + '.html');
    const body = [
      '<p class="l-crumb"><a href="' + lPrefix(file, L_DIR) + 'index.html">资料库</a> / ' +
        escHtml(CATEGORIES[key]) + '</p>',
      '<h1>' + escHtml(CATEGORIES[key]) + '（' + list.length + ' 份）</h1>',
      navLinks(entries, lPrefix(file, L_DIR)),
      renderList(list, lPrefix(file, L_DIR))
    ].join('\n');
    writeText(file, page({
      title: CATEGORIES[key],
      description: SITE_TITLE + ' - ' + CATEGORIES[key] + '资料列表',
      bodyHtml: body, css, prefix: lPrefix(file, L_DIR)
    }));
  }

  // ---- 4.3 每份资料全文（答案默认展开、线性化；大文档构建期分片） ----
  // 源文件保持完整，切分只作用于构建期内存；片按顺序拼接 === 原 md。
  let partCount = 0;
  let splitDocCount = 0;
  for (const e of entries) {
    cleanOldParts(e.slug);
    const { parts, split } = splitMarkdown(e.body);
    const total = parts.length;
    if (split) splitDocCount++;
    partCount += total;

    for (const part of parts) {
      const file = path.join(L_DIR, partFilename(e.slug, part.index));
      const prefix = lPrefix(file, L_DIR);
      const markedHtml = String(await marked.parse(part.md))
        .replace(/<script[\s\S]*?<\/script>/gi, '');

      const badge = total > 1
        ? '<span class="l-pagebadge">（第 ' + part.index + ' / ' + total + ' 页）</span>'
        : '';
      const head = [
        '<p class="l-crumb"><a href="' + prefix + 'index.html">资料库</a> / ' +
          '<a href="' + prefix + 'subject/' + e.subjectKey + '.html">' + escHtml(e.subjectLabel) +
          '</a> / 正文</p>',
        '<h1>' + escHtml(e.title) + badge + '</h1>',
        part.index === 1
          ? '<p class="l-meta">科目：' + escHtml(e.subjectLabel) +
              '　类别：' + escHtml(e.categoryLabel) +
              (e.year ? '　年份：' + e.year + ' 年' : '') +
              '　答案：' + (e.answerProvided ? '原卷提供' : '原卷未提供') +
              '　解析：' + (e.analysisProvided ? '原卷提供' : '原卷未提供') + '</p>'
          : '<p class="l-note">本页接续上文，为同一份资料的拆分片段；内容连续、无删减。</p>',
        '<p class="l-note">答案与解析默认全部展开，无折叠、无 tab 页；本页无需 JavaScript，可直接打印或另存。</p>'
      ];

      const nextHref = part.index < total
        ? prefix + partFilename(e.slug, part.index + 1)
        : '';

      const body = [
        ...head,
        total > 1 ? pager(e.slug, part.index, total, prefix, false) : '',
        '<div class="l-body" id="l-body">',
        markedHtml,
        '<!--L_BODY_END-->',
        '</div>',
        // ES5 增强脚本据此推算下一片地址；最后一页留空表示终止。
        '<!--L_NEXT:' + nextHref + '-->',
        total > 1 ? pager(e.slug, part.index, total, prefix, true) : '',
        '<p><a class="l-btn" href="' + prefix + 'index.html">← 返回资料库</a></p>'
      ].filter(Boolean).join('\n');

      writeText(file, page({
        title: e.title + (total > 1 ? '（第 ' + part.index + ' / ' + total + ' 页）' : ''),
        description: (e.excerpt || e.title).slice(0, 150),
        bodyHtml: body, css, prefix
      }));
    }
  }

  // ---- 4.4 RSS（全站 + 分频道），同时写一份到 l/ 供离线包自包含 ----
  const feeds = [];
  feeds.push({
    file: 'rss.xml',
    title: SITE_TITLE,
    description: SITE_DESC,
    link: SITE_URL + '/',
    feedUrl: SITE_URL + '/rss.xml',
    items: entries
  });
  for (const key of usedSubjects) {
    feeds.push({
      file: 'rss/subject-' + key + '.xml',
      title: SITE_TITLE + ' · ' + SUBJECTS[key],
      description: SITE_TITLE + ' - ' + SUBJECTS[key] + '栏目更新',
      link: SITE_URL + '/l/subject/' + key + '.html',
      feedUrl: SITE_URL + '/rss/subject-' + key + '.xml',
      items: entries.filter((e) => e.subjectKey === key)
    });
  }
  for (const key of usedCategories) {
    feeds.push({
      file: 'rss/category-' + key + '.xml',
      title: SITE_TITLE + ' · ' + CATEGORIES[key],
      description: SITE_TITLE + ' - ' + CATEGORIES[key] + '栏目更新',
      link: SITE_URL + '/l/category/' + key + '.html',
      feedUrl: SITE_URL + '/rss/category-' + key + '.xml',
      items: entries.filter((e) => e.category === key)
    });
  }

  for (const feed of feeds) {
    const xml = rssXml(feed);
    writeText(path.join(OUT_ROOT, feed.file), xml);
    writeText(path.join(L_DIR, feed.file), xml);
  }

  // ---- 4.5 订阅说明页 ----
  const rssBody = [
    '<p class="l-crumb"><a href="index.html">资料库</a> / RSS 订阅</p>',
    '<h1>RSS 订阅</h1>',
    '<p class="l-note">RSS 是纯 XML、零 JavaScript 的内容分发通道，旧浏览器与阅读器均可直接读取；取消订阅即完成退订，无需账号。</p>',
    '<h2>全站订阅</h2>',
    '<ul class="l-list"><li><a href="rss.xml">全站 RSS<span class="l-list-meta">全部 ' +
      entries.length + ' 份资料</span></a></li></ul>',
    '<h2>按科目订阅</h2>',
    '<ul class="l-list">' +
      usedSubjects.map((k) => '<li><a href="rss/subject-' + k + '.xml">' +
        escHtml(SUBJECTS[k]) + '<span class="l-list-meta">栏目级订阅源</span></a></li>').join('') +
      '</ul>',
    '<h2>按类别订阅</h2>',
    '<ul class="l-list">' +
      usedCategories.map((k) => '<li><a href="rss/category-' + k + '.xml">' +
        escHtml(CATEGORIES[k]) + '<span class="l-list-meta">栏目级订阅源</span></a></li>').join('') +
      '</ul>',
    '<h2>说明</h2>',
    '<p>每个页面的 &lt;head&gt; 均含 &lt;link rel="alternate" type="application/rss+xml"&gt; 自动发现标记。' +
      '本项目仅提供静态 RSS 源，不收集订阅者信息、不发送邮件，因此不存在邮件退订流程。' +
      '部署时请用环境变量 SITE_URL 指定站点域名，以便生成可点击的绝对链接。</p>'
  ].join('\n');
  writeText(path.join(L_DIR, 'rss.html'), page({
    title: 'RSS 订阅',
    description: SITE_TITLE + ' RSS 订阅说明与分频道源',
    bodyHtml: rssBody, css, prefix: ''
  }));

  const htmlCount = fs.readdirSync(L_DIR, { recursive: true })
    .filter((f) => String(f).endsWith('.html')).length;

  console.log('[build-legacy] 输出目录: ' + path.relative(ROOT, OUT_ROOT));
  console.log('[build-legacy] 内容条目: ' + entries.length + ' 份（源文件保持完整、未切分）');
  console.log('[build-legacy] 构建期分片: ' + splitDocCount + ' 份大文档 → ' + partCount +
    ' 片；其余 ' + (entries.length - splitDocCount) + ' 份保持单页');
  console.log('[build-legacy] /l/ 页面: ' + htmlCount + ' 个（含索引与订阅说明）');
  console.log('[build-legacy] RSS 源:   ' + feeds.length + ' 个（全站 1 + 科目 ' +
    usedSubjects.length + ' + 类别 ' + usedCategories.length + '），各写 2 份');
  console.log('[build-legacy] legacy.css: ' + Buffer.byteLength(css) + ' 字节（var() 已展开）');
  console.log('[build-legacy] SITE_URL: ' + SITE_URL +
    (process.env.SITE_URL ? '' : '（默认占位，部署时请设置 SITE_URL）'));
}

main().catch((err) => {
  console.error('[build-legacy] 失败:', err);
  process.exit(1);
});
