/**
 * 构建期校验门禁（挂 postbuild，在 build-legacy.mjs 之后执行）
 *
 * 把 PROMPT-zsb-tiku.md 7.7 的验收清单代码化：任何一项不通过就让构建失败。
 * 覆盖：禁用语法串、必需文档标记、条目数一致、ES5、RSS 合法性、
 *       RSS link 可达、分类字典与 src/lib/taxonomy.ts 一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEntries } from './lib/content.mjs';
import {
  ROOT,
  TAXONOMY_TS,
  SUBJECTS,
  CATEGORIES,
  SITE_URL,
  outDir
} from './lib/config.mjs';

const OUT_ROOT = outDir();
const L_DIR = path.join(OUT_ROOT, 'l');
const errors = [];
const notes = [];

function check(cond, msg) {
  if (!cond) errors.push(msg);
}

function walk(dir, ext) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(p, ext));
    else if (item.name.toLowerCase().endsWith(ext)) out.push(p);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 1. /l/ HTML：必需标记 + 禁用串
 * ------------------------------------------------------------------ */
const REQUIRED = [
  ['<!DOCTYPE html>', '标准 DOCTYPE'],
  ['X-UA-Compatible', 'IE 文档模式声明'],
  ['lang="zh-CN"', '页面语言'],
  ['rel="alternate"', 'RSS 自动发现'],
  ['<title>', '页面标题'],
  ['name="description"', '页面描述'],
  ['返回正常版', '适老化版退出入口']
];

// 这些字符串一旦出现，IE9 / Android 4.0 WebView 就会整段失效或布局塌陷
const FORBIDDEN = [
  ['type="module"', 'module script'],
  ['var(--', 'CSS 变量 var()'],
  ['display:grid', 'grid 布局'],
  ['display: grid', 'grid 布局'],
  ['display:flex', 'flex 布局'],
  ['display: flex', 'flex 布局'],
  ['gap:', 'gap 属性'],
  ['clamp(', 'clamp()'],
  [':is(', ':is() 选择器'],
  ['<details', '<details> 折叠'],
  ['@supports', '@supports'],
  ['backdrop-filter', 'backdrop-filter']
];

const htmlFiles = walk(L_DIR, '.html');
check(htmlFiles.length > 0, '未生成任何 /l/ 页面');

for (const file of htmlFiles) {
  const rel = path.relative(OUT_ROOT, file);
  const html = fs.readFileSync(file, 'utf8');
  // 禁用串只针对「实际生效的标记与样式」；说明性注释里的文字不算违规
  const scan = html
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  for (const [needle, label] of REQUIRED) {
    check(html.includes(needle), rel + ' 缺少：' + label);
  }
  for (const [needle, label] of FORBIDDEN) {
    check(!scan.includes(needle), rel + ' 含禁用特性：' + label);
  }
  check(!/<[^>]*\shidden[\s>]/i.test(scan), rel + ' 含 hidden 属性（老浏览器不认识）');

  // 只允许一个普通 defer script（enhance.js），不允许 module / 内联脚本
  const scripts = scan.match(/<script[^>]*>/gi) || [];
  check(scripts.length <= 1, rel + ' 出现多个 <script> 标签');
  for (const s of scripts) {
    check(/\bdefer\b/i.test(s), rel + ' script 未加 defer');
    check(/enhance\.js/.test(s), rel + ' 引入了非预期的脚本');
    check(!/\btype\s*=/i.test(s), rel + ' script 带了 type 属性');
  }
}
notes.push('/l/ HTML ' + htmlFiles.length + ' 个：必需标记与禁用串检查完成');

/* ------------------------------------------------------------------ *
 * 2. 内容一致性：每份资料都有对应降级页
 * ------------------------------------------------------------------ */
const entries = loadEntries();
const missing = entries.filter((e) => !fs.existsSync(path.join(L_DIR, e.slug + '.html')));
check(missing.length === 0, '缺少降级页：' + missing.map((e) => e.slug).join(', '));
check(entries.length > 0, '未读取到任何内容条目');
notes.push('内容条目 ' + entries.length + ' 份，降级页一一对应');

/* ------------------------------------------------------------------ *
 * 3. CSS 编译产物：变量必须全部展开
 * ------------------------------------------------------------------ */
const cssPath = path.join(L_DIR, 'legacy.css');
check(fs.existsSync(cssPath), '缺少 legacy.css');
if (fs.existsSync(cssPath)) {
  const css = fs.readFileSync(cssPath, 'utf8');
  check(!/var\(--/.test(css), 'legacy.css 仍含 var()（postcss-custom-properties 未生效）');
  check(css.includes('display: block'), 'legacy.css 缺少语义标签 display:block 重置');
  notes.push('legacy.css ' + Buffer.byteLength(css) + ' 字节，var() 已展开');
}

/* ------------------------------------------------------------------ *
 * 4. ES5 语法门禁
 * ------------------------------------------------------------------ */
const jsPath = path.join(L_DIR, 'enhance.js');
const cli = path.join(ROOT, 'node_modules', '.bin', 'es-check');
check(fs.existsSync(jsPath), '缺少 enhance.js');
check(fs.existsSync(cli), '缺少 es-check CLI');
if (fs.existsSync(jsPath) && fs.existsSync(cli)) {
  const r = spawnSync(cli, ['es5', jsPath], { encoding: 'utf8' });
  check(r.status === 0, 'es-check es5 未通过：' + ((r.stdout || '') + (r.stderr || '')).trim());
  notes.push('es-check es5 通过：enhance.js');
}

/* ------------------------------------------------------------------ *
 * 5. RSS：XML 良构性、必填字段、日期格式、guid 唯一
 * ------------------------------------------------------------------ */
const rssFiles = walk(OUT_ROOT, '.xml');
check(rssFiles.length > 0, '未生成任何 RSS 源');

const PY = [
  'import sys',
  'import xml.etree.ElementTree as ET',
  'from email.utils import parsedate_to_datetime',
  'errs = []',
  'for f in sys.argv[1:]:',
  '    try:',
  '        root = ET.parse(f).getroot()',
  '    except Exception as exc:',
  '        errs.append(f + " XML 解析失败: " + str(exc)); continue',
  '    if root.tag != "rss": errs.append(f + " 根元素不是 rss")',
  '    ch = root.find("channel")',
  '    if ch is None:',
  '        errs.append(f + " 缺少 channel"); continue',
  '    for tag in ("title","link","description","language","lastBuildDate"):',
  '        el = ch.find(tag)',
  '        if el is None or not (el.text or "").strip(): errs.append(f + " channel 缺 " + tag)',
  '    items = ch.findall("item")',
  '    if not items: errs.append(f + " 没有 item")',
  '    seen = set()',
  '    for it in items:',
  '        for tag in ("title","link","guid","pubDate","description","category"):',
  '            el = it.find(tag)',
  '            if el is None or not (el.text or "").strip(): errs.append(f + " item 缺 " + tag)',
  '        g = it.findtext("guid") or ""',
  '        if g in seen: errs.append(f + " guid 重复: " + g)',
  '        seen.add(g)',
  '        try: parsedate_to_datetime(it.findtext("pubDate") or "")',
  '        except Exception: errs.append(f + " pubDate 非法: " + (it.findtext("pubDate") or ""))',
  'print("\\n".join(errs))',
  'sys.exit(1 if errs else 0)'
].join('\n');

if (rssFiles.length > 0) {
  const r = spawnSync('python3', ['-c', PY, ...rssFiles], { encoding: 'utf8' });
  check(r.status === 0, 'RSS 校验未通过：\n' + ((r.stdout || '') + (r.stderr || '')).trim());
  notes.push('RSS 源 ' + rssFiles.length + ' 个：XML / 必填字段 / pubDate / guid 检查完成');
}

/* ------------------------------------------------------------------ *
 * 6. 全站 RSS：item 数与内容一致、link 指向真实主站页
 * ------------------------------------------------------------------ */
const mainRss = path.join(OUT_ROOT, 'rss.xml');
check(fs.existsSync(mainRss), '缺少全站 rss.xml');
if (fs.existsSync(mainRss)) {
  const xml = fs.readFileSync(mainRss, 'utf8');
  const itemCount = (xml.match(/<item>/g) || []).length;
  check(itemCount === entries.length,
    '全站 RSS item 数(' + itemCount + ') 与内容条目数(' + entries.length + ') 不一致');

  const links = [...xml.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1]).slice(1);
  let bad = 0;
  for (const link of links) {
    if (!link.startsWith(SITE_URL + '/zsb/')) { bad++; continue; }
    const rel = link.slice(SITE_URL.length + 1).replace(/\/$/, '');
    const page = path.join(OUT_ROOT, rel, 'index.html');
    if (!fs.existsSync(page)) bad++;
  }
  check(bad === 0, 'RSS 中有 ' + bad + ' 条 link 指向不存在的主站页面');
  notes.push('全站 RSS ' + itemCount + ' 条，link 全部指向已生成的预渲染页');
}

/* ------------------------------------------------------------------ *
 * 7. 分类字典与 src/lib/taxonomy.ts 一致
 * ------------------------------------------------------------------ */
const ts = fs.readFileSync(TAXONOMY_TS, 'utf8');
function keysOf(name) {
  const m = ts.match(new RegExp('export const ' + name + '\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*as const'));
  if (!m) return null;
  return [...m[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((x) => x[1]).sort();
}
for (const [name, dict] of [['SUBJECTS', SUBJECTS], ['CATEGORIES', CATEGORIES]]) {
  const fromTs = keysOf(name);
  check(fromTs !== null, '无法从 taxonomy.ts 解析 ' + name);
  if (fromTs) {
    check(JSON.stringify(fromTs) === JSON.stringify(Object.keys(dict).sort()),
      name + ' 与 taxonomy.ts 不一致：' + fromTs.join(',') + ' vs ' + Object.keys(dict).join(','));
  }
}
notes.push('SUBJECTS / CATEGORIES 与 src/lib/taxonomy.ts 一致');

/* ------------------------------------------------------------------ *
 * 结果
 * ------------------------------------------------------------------ */
console.log('[verify-legacy] 输出目录: ' + path.relative(ROOT, OUT_ROOT));
for (const n of notes) console.log('[verify-legacy]   ✓ ' + n);

if (errors.length) {
  console.error('\n[verify-legacy] 校验失败（' + errors.length + ' 项）：');
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log('[verify-legacy] 全部通过（对应 PROMPT-zsb-tiku.md 7.7 验收清单）');
