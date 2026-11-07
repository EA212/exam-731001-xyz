/**
 * 内容读取：只从 src/content/专升本/** 读，主站与 /zz/zsb/ 镜像页、RSS 共用这一份内容源。
 * 对应 PROMPT-zsb-tiku.md 7.2「页面内容应与原网站的主要内容保持一致」。
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {
  CONTENT_ROOT,
  SUBJECTS,
  CATEGORIES,
  SITE_URL,
  pathToSlug,
  stripMd
} from './config.mjs';

function walk(dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(p));
    else if (/\.md$/i.test(item.name)) out.push(p);
  }
  return out;
}

export function loadEntries() {
  if (!fs.existsSync(CONTENT_ROOT)) {
    throw new Error('内容目录不存在：' + CONTENT_ROOT);
  }

  const files = walk(CONTENT_ROOT).sort();

  return files
    .map((file) => {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = matter(raw);
      const d = parsed.data || {};
      const body = parsed.content || '';
      const rel = path.relative(CONTENT_ROOT, file).split(path.sep).join('/');
      const slug = pathToSlug(rel, d.subjectKey);
      const stat = fs.statSync(file);
      const subjectKey = String(d.subjectKey || '');
      const category = String(d.category || 'qita');

      return {
        slug,
        rel,
        file,
        body,
        url: SITE_URL + '/zsb/' + slug + '/',
        legacyRel: 'zz/zsb/' + slug + '/index.html',
        legacyUrl: '/zz/zsb/' + slug + '/',
        title: String(d.title || path.basename(file, '.md')),
        subject: String(d.subject || SUBJECTS[subjectKey] || ''),
        subjectKey,
        subjectLabel: SUBJECTS[subjectKey] || String(d.subject || subjectKey),
        category,
        categoryLabel: CATEGORIES[category] || category,
        year: d.year ? Number(d.year) : null,
        tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
        answerProvided: !!d.answerProvided,
        analysisProvided: !!d.analysisProvided,
        order: Number(d.order || 0),
        draft: !!d.draft,
        sections: Array.isArray(d.sections) ? d.sections : [],
        excerpt: stripMd(body).slice(0, 160),
        // pubDate 取文件 mtime（真实可核验），不伪造发稿日期
        pubDate: stat.mtime.toUTCString(),
        mtime: stat.mtime
      };
    })
    .filter((e) => !e.draft);
}
