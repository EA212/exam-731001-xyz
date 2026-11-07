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
 *
 * 所有 /l/ 页面自包含（CSS 内联、JS 用相对路径），可单独打包成离线 HTML 包。
 */
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import customProperties from 'postcss-custom-properties';
import autoprefixer from 'autoprefixer';
import { marked } from 'marked';
import { loadEntries } from './lib/content.mjs';
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
    '<style>',
    opts.css,
    '</style>',
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

  // ---- 4.3 每份资料全文（答案默认展开，线性化） ----
  for (const e of entries) {
    const file = path.join(L_DIR, e.slug + '.html');
    const prefix = lPrefix(file, L_DIR);
    const markedHtml = String(await marked.parse(e.body))
      .replace(/<script[\s\S]*?<\/script>/gi, '');
    const body = [
      '<p class="l-crumb"><a href="' + prefix + 'index.html">资料库</a> / ' +
        '<a href="' + prefix + 'subject/' + e.subjectKey + '.html">' + escHtml(e.subjectLabel) +
        '</a> / 正文</p>',
      '<h1>' + escHtml(e.title) + '</h1>',
      '<p class="l-meta">科目：' + escHtml(e.subjectLabel) +
        '　类别：' + escHtml(e.categoryLabel) +
        (e.year ? '　年份：' + e.year + ' 年' : '') +
        '　答案：' + (e.answerProvided ? '原卷提供' : '原卷未提供') +
        '　解析：' + (e.analysisProvided ? '原卷提供' : '原卷未提供') + '</p>',
      '<p class="l-note">答案与解析默认全部展开，无折叠、无 tab 页；本页无需 JavaScript，可直接打印或另存。</p>',
      '<div class="l-body">',
      markedHtml,
      '</div>',
      '<p><a class="l-btn" href="' + prefix + 'index.html">← 返回资料库</a></p>'
    ].join('\n');
    writeText(file, page({
      title: e.title,
      description: (e.excerpt || e.title).slice(0, 150),
      bodyHtml: body, css, prefix
    }));
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
  console.log('[build-legacy] 内容条目: ' + entries.length + ' 份');
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
