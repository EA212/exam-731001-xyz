/**
 * 构建期生成器（由 package.json 的 build 显式调用，早于 astro build）
 *
 * 长者版是主站的镜像：主站 /zsb/** → 长者版 /zz/zsb/**，
 * 只加一层 /zz 前缀，页面与链接一一对应，不另立路径体系、不设入口页。
 *
 * 产物写进 public/，由 astro build 自身复制到 dist/client；
 * EdgeOne 适配器随后在 astro:build:done 把 dist/client 复制到发布目录，
 * 因此不需要 postbuild / CI / 额外钩子，云端一条 npm run build 即可带上。
 *
 * 内容源始终是 src/content/专升本/** 这一份；构建期分片只作用于内存，
 * 源文件保持完整；产物片按顺序拼接可逐字符还原原文（split.mjs 强断言）。
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
  PUBLIC_DIR,
  LEGACY_PUBLIC_DIR,
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

const L_DIR = LEGACY_PUBLIC_DIR;

/* ------------------------------------------------------------------ *
 * 1. 编译 legacy.css：CSS 变量 → 静态值，补老内核前缀
 * ------------------------------------------------------------------ */
async function buildCss() {
  const src = fs.readFileSync(LEGACY_CSS_SRC, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const targets = (pkg.browserslist && pkg.browserslist.legacy) || ['ie >= 9', 'Android >= 4'];
  const result = await postcss([
    customProperties({ preserve: false }),
    autoprefixer({ overrideBrowserslist: targets })
  ]).process(src, { from: LEGACY_CSS_SRC });
  return result.css;
}

/* ------------------------------------------------------------------ *
 * 2. HTML 模板（无自述文字、无开发说明，只有内容与导航）
 * ------------------------------------------------------------------ */
function bar(normalUrl) {
  return [
    '<div class="l-bar">',
    '  <a class="l-btn" href="' + escHtml(normalUrl) + '">← 返回正常版</a>',
    '  <span class="l-brand">长者版</span>',
    '  <span class="l-tools" id="l-tools"></span>',
    '</div>'
  ].join('\n');
}

function foot(normalUrl, prefix) {
  return [
    '<div class="l-foot">',
    '  <p><a href="' + prefix + 'rss.xml">RSS 订阅</a> · ' +
      '<a href="' + prefix + 'index.html">资料库目录</a> · ' +
      '<a href="' + escHtml(normalUrl) + '">返回正常版</a></p>',
    '</div>'
  ].join('\n');
}

function page(opts) {
  const prefix = opts.prefix;
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
      escHtml(SITE_TITLE) + ' RSS" href="/rss.xml">',
    INLINE_CSS
      ? '<style>\n' + opts.css + '\n</style>'
      : '<link rel="stylesheet" href="' + prefix + 'legacy.css">',
    '<script defer src="' + prefix + 'enhance.js"><\/script>',
    '</head>',
    '<body>',
    bar(opts.normalUrl),
    '<main class="l-main">',
    opts.bodyHtml,
    '</main>',
    foot(opts.normalUrl, prefix),
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

/** 按科目分组的扁平列表，对应主站 /zsb/ 的分组，无独立索引页 */
function renderList(entries, prefix) {
  if (entries.length === 0) return '<p>暂无资料。</p>';
  const groups = Object.keys(SUBJECTS)
    .map((key) => ({ key, label: SUBJECTS[key], items: entries.filter((e) => e.subjectKey === key) }))
    .filter((g) => g.items.length > 0);
  return groups.map((g) => [
    '<h2>' + escHtml(g.label) + '（' + g.items.length + ' 份）</h2>',
    '<ul class="l-list">',
    ...g.items.map((e) => {
      const meta = [
        e.categoryLabel,
        e.year ? e.year + ' 年' : '',
        e.answerProvided ? '含答案' : '暂无答案'
      ].filter(Boolean).join(' · ');
      return (
        '<li><a href="' + escHtml(prefix + e.slug + '/') + '">' +
        escHtml(e.title) +
        '<span class="l-list-meta">' + escHtml(meta) + '</span></a></li>'
      );
    }),
    '</ul>'
  ].join('\n')).join('\n');
}

/* ------------------------------------------------------------------ *
 * 2.1 分片导航：零 JS 可翻页，ES5 脚本可选做滚到底自动续读
 * ------------------------------------------------------------------ */
function pager(slug, index, total, prefix, withIds) {
  const hrefOf = (i) => prefix + partFilename(slug, i);
  const a = (href, label, id) =>
    '<a class="l-btn"' + (id ? ' id="' + id + '"' : '') +
    ' href="' + escHtml(href) + '">' + escHtml(label) + '</a>';

  const links = [];
  if (index > 1) links.push(a(hrefOf(index - 1), '← 上一页'));
  links.push(a(prefix + 'index.html', '资料库目录'));
  if (index < total) links.push(a(hrefOf(index + 1), '下一页 →', withIds ? 'l-next' : ''));

  const toc = [];
  for (let i = 1; i <= total; i++) {
    toc.push('<a class="' + (i === index ? 'l-cur' : '') +
      '" href="' + escHtml(hrefOf(i)) + '">' + i + '</a>');
  }

  return [
    '<div class="l-pager">',
    '  <p class="l-pageinfo"' + (withIds ? ' id="l-pageinfo"' : '') + '>第 ' + index +
      ' / ' + total + ' 页</p>',
    '  <div class="l-pager-links">' + links.join(' ') + '</div>',
    '  <div class="l-toc">跳到：' + toc.join(' ') + '</div>',
    '  <p class="l-loading"' + (withIds ? ' id="l-loading"' : '') + '></p>',
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

  // 每次全量重建，避免旧分片 / 旧结构残留
  fs.rmSync(L_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(PUBLIC_DIR, 'rss'), { recursive: true, force: true });
  fs.rmSync(path.join(PUBLIC_DIR, 'rss.xml'), { force: true });
  fs.mkdirSync(L_DIR, { recursive: true });

  fs.copyFileSync(ENHANCE_JS_SRC, path.join(L_DIR, 'enhance.js'));
  writeText(path.join(L_DIR, 'legacy.css'), css);

  // ---- 4.1 列表页 /zz/zsb/ → 对应主站 /zsb/ ----
  const homeBody = [
    '<h1>' + escHtml(SITE_TITLE) + '</h1>',
    '<p>共收录 <strong>' + entries.length + '</strong> 份资料。</p>',
    renderList(entries, '')
  ].join('\n');
  writeText(
    path.join(L_DIR, 'index.html'),
    page({
      title: SITE_TITLE,
      description: SITE_DESC,
      bodyHtml: homeBody,
      css,
      prefix: '',
      normalUrl: '/zsb/'
    })
  );

  // ---- 4.2 每份资料 /zz/zsb/<slug>/ → 对应主站 /zsb/<slug>/ ----
  // 大文档构建期分片：源文件保持完整，切分只作用于内存。
  let partCount = 0;
  let splitDocCount = 0;
  for (const e of entries) {
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
        '<p class="l-crumb"><a href="' + prefix + 'index.html">资料库</a> / 正文</p>',
        '<h1>' + escHtml(e.title) + badge + '</h1>',
        part.index === 1
          ? '<p class="l-meta">科目：' + escHtml(e.subjectLabel) +
              '　类别：' + escHtml(e.categoryLabel) +
              (e.year ? '　年份：' + e.year + ' 年' : '') +
              '　答案：' + (e.answerProvided ? '原卷提供' : '原卷未提供') + '</p>'
          : ''
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
        '<!--L_NEXT:' + nextHref + '-->',
        total > 1 ? pager(e.slug, part.index, total, prefix, true) : '',
        '<p><a class="l-btn" href="' + prefix + 'index.html">← 返回资料库</a></p>'
      ].filter(Boolean).join('\n');

      writeText(file, page({
        title: e.title + (total > 1 ? '（第 ' + part.index + ' / ' + total + ' 页）' : ''),
        description: (e.excerpt || e.title).slice(0, 150),
        bodyHtml: body, css, prefix,
        normalUrl: '/zsb/' + e.slug + '/'
      }));
    }
  }

  // ---- 4.3 RSS（全站 + 分频道），站点根一份，长者版目录一份供离线 ----
  const usedSubjects = [...new Set(entries.map((e) => e.subjectKey))].filter((k) => SUBJECTS[k]);
  const usedCategories = [...new Set(entries.map((e) => e.category))].filter((k) => CATEGORIES[k]);
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
      link: SITE_URL + '/zsb/',
      feedUrl: SITE_URL + '/rss/subject-' + key + '.xml',
      items: entries.filter((e) => e.subjectKey === key)
    });
  }
  for (const key of usedCategories) {
    feeds.push({
      file: 'rss/category-' + key + '.xml',
      title: SITE_TITLE + ' · ' + CATEGORIES[key],
      description: SITE_TITLE + ' - ' + CATEGORIES[key] + '栏目更新',
      link: SITE_URL + '/zsb/',
      feedUrl: SITE_URL + '/rss/category-' + key + '.xml',
      items: entries.filter((e) => e.category === key)
    });
  }
  for (const feed of feeds) {
    const xml = rssXml(feed);
    writeText(path.join(PUBLIC_DIR, feed.file), xml);
    writeText(path.join(L_DIR, feed.file), xml);
  }

  const htmlCount = fs.readdirSync(L_DIR, { recursive: true })
    .filter((f) => String(f).endsWith('.html')).length;

  console.log('[build-legacy] 镜像路径: /zz/zsb/**（主站 /zsb/**）');
  console.log('[build-legacy] 内容条目: ' + entries.length + ' 份（源文件保持完整）');
  console.log('[build-legacy] 构建期分片: ' + splitDocCount + ' 份大文档 → ' + partCount + ' 片');
  console.log('[build-legacy] 长者版页面: ' + htmlCount + ' 个');
  console.log('[build-legacy] RSS 源: ' + feeds.length + ' 个，各写 2 份');
  console.log('[build-legacy] 产物目录: public/zz/（由 astro build 带入 dist/client）');
}

main().catch((err) => {
  console.error('[build-legacy] 失败:', err);
  process.exit(1);
});
