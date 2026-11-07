/**
 * 构建期共享配置与工具（供 build-legacy.mjs / verify-legacy.mjs 复用）
 *
 * 注意：SUBJECTS / CATEGORIES / DIR_TO_SUBJECT 与 src/lib/taxonomy.ts 保持同步，
 * verify-legacy.mjs 会做一致性断言，防止字典漂移。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');

export const CONTENT_ROOT = path.join(ROOT, 'src/content/专升本');
export const LEGACY_CSS_SRC = path.join(ROOT, 'src/legacy/legacy.src.css');
export const ENHANCE_JS_SRC = path.join(ROOT, 'src/legacy/enhance.js');
export const TAXONOMY_TS = path.join(ROOT, 'src/lib/taxonomy.ts');

/**
 * 长者版是主站的镜像：主站 /zsb/** → 长者版 /zz/zsb/**。
 * 只加一层 /zz 前缀，页面与链接一一对应，不另立一套路径体系。
 */
export const LEGACY_PREFIX = '/zz/zsb/';
export const LEGACY_SUBDIR = 'zz/zsb';

/** 与 src/lib/taxonomy.ts 的 SUBJECTS 一致 */
export const SUBJECTS = {
  mingfa: '民法',
  zhengzhililun: '政治理论'
};

/** 与 src/lib/taxonomy.ts 的 CATEGORIES 一致 */
export const CATEGORIES = {
  zhenti: '真题',
  lianxi: '练习题',
  biji: '背诵笔记',
  bibei: '必背考点',
  daan: '习题答案',
  tiku: '题库汇总',
  muban: '答题模板',
  daotu: '思维导图',
  jiaocai: '教材'
};

/** 与 src/lib/taxonomy.ts 的 DIR_TO_SUBJECT 一致 */
export const DIR_TO_SUBJECT = {
  民法: 'mingfa',
  政治理论: 'zhengzhililun'
};

/**
 * 站点根地址，用于 RSS 的绝对 link / guid。
 * 部署时用环境变量 SITE_URL 覆盖，例如 SITE_URL=https://your.domain npm run build
 */
export const SITE_URL = (process.env.SITE_URL || 'https://example.com').replace(/\/+$/, '');
export const SITE_TITLE = '专插本资料库';
export const SITE_DESC = '专插本历年真题、背诵笔记与考点资料的结构化题库';

/**
 * 长者版页面默认外链 legacy.css（可缓存、跨分片只下载一次，省带宽）。
 * 需要「单个 HTML 拷走也能看」时：LEGACY_INLINE_CSS=1 npm run build 会把样式内联回去。
 */
export const INLINE_CSS = process.env.LEGACY_INLINE_CSS === '1';

/**
 * 产物先写进 public/，由 astro build 自己复制到 dist/client。
 * 这样 EdgeOne 适配器在 astro:build:done 复制 dist/client 时必然带上，
 * 不需要 postbuild、不需要 CI、不需要额外钩子。
 */
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const LEGACY_PUBLIC_DIR = path.join(PUBLIC_DIR, LEGACY_SUBDIR);

/** EdgeOne 适配器把静态资源放在 dist/client；兼容其他适配器直接放 dist */
export function outDir() {
  const client = path.join(ROOT, 'dist/client');
  return fs.existsSync(client) ? client : path.join(ROOT, 'dist');
}

/** 最终发布产物里的长者版目录（verify 检查用） */
export function legacyOutDir() {
  return path.join(outDir(), LEGACY_SUBDIR);
}

/** 复刻 src/lib/taxonomy.ts 的 pathToSlug()，保证降级页与主站 URL 一一对应 */
export function pathToSlug(relativePath, subjectKey) {
  const rel = String(relativePath).replace(/\.(md|mdx)$/i, '');
  const parts = rel.split('/').filter(Boolean);
  const key = subjectKey || DIR_TO_SUBJECT[parts[0]] || parts[0] || 'misc';
  const rest = parts.slice(1).join('-');
  return rest ? key + '/' + rest : key;
}

export function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 把 markdown 正文压成纯文本摘要（RSS description 用，纯文本不带 HTML/JS） */
export function stripMd(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/_{1,2}([^_]*)_{1,2}/g, '$1')
    .replace(/^\s*-{3,}\s*$/gm, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从目标 HTML 所在目录回到长者版根目录的相对前缀（离线 file:// 也可用） */
export function lPrefix(htmlFile, lDir) {
  const rel = path.relative(path.dirname(htmlFile), lDir);
  return rel === '' ? '' : rel.split(path.sep).join('/') + '/';
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function writeText(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, 'utf8');
}
