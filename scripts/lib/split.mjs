/**
 * 构建期大文档无损切分
 *
 * 目标（PROMPT-zsb-tiku.md 7.8）：
 *   - 源文件 src/content/专升本/**.md 保持完整，一个字都不改、不拆；
 *   - 只在 npm run build 的构建期，把「超大」的 Markdown 切成若干片，
 *     每片各自渲染成一个独立静态 HTML；
 *   - 浏览器一次只下载当前片，不读完就不请求后面的片 → 省带宽、首屏更快。
 *
 * 切分约束（保证渲染结果不坏、内容零丢失）：
 *   1. 只在 Markdown 标题行（# ~ ######）边界切，绝不切断表格、列表、题目块；
 *      fenced code block 内的 # 行不算标题。
 *   2. 单片目标 PART_TARGET 字节；超过阈值才切，小文件保持单页不动。
 *   3. 单个标题块本身过大时，只在「非表格区的空行」处二次切。
 *   4. 强断言：所有片按顺序拼接 === 原始 md（逐字符），否则构建直接失败。
 *
 * 命名：第 1 片沿用 <slug>.html（旧链接 / 书签 / 索引页 / RSS 全部不失效），
 *       后续片 <slug>-2.html、-3.html …… 平铺同目录，file:// 离线可用。
 */
export const SPLIT_THRESHOLD = 24 * 1024;   // 源 md 超过 24 KB 才切
export const PART_TARGET = 18 * 1024;       // 每片目标 18 KB 源文本
export const PART_HARD_MAX = 48 * 1024;     // 单个标题块超过此值才允许二次切
export const MAX_HTML_BYTES = 128 * 1024;   // 产物单页体积上限（门禁用）

/** 分片文件名：index 从 1 开始 */
export function partFilename(slug, index) {
  return index === 1 ? slug + '.html' : slug + '-' + index + '.html';
}

/** 把文本按行切开且保留每行换行符，保证 join('') 逐字符还原 */
function toLines(text) {
  if (!text) return [];
  return text.match(/[^\n]*\n|[^\n]+$/g) || [];
}

function isHeading(line) {
  return /^#{1,6}[ \t]+\S/.test(line);
}

function isTableLine(line) {
  return /^\s*\|/.test(line);
}

function headingText(line) {
  return line.replace(/^#{1,6}[ \t]+/, '').replace(/[ \t\r\n]+$/, '');
}

/**
 * 第一遍：按标题行把 md 切成「块」，块内包含其下所有表格 / 列表 / 正文。
 * 返回 [{ md, heading }]，所有块拼接 === 原文。
 */
function toBlocks(body) {
  const lines = toLines(body);
  const blocks = [];
  let cur = [];
  let heading = '';
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) inFence = !inFence;
    const boundary = !inFence && isHeading(line);

    if (boundary && cur.length) {
      blocks.push({ md: cur.join(''), heading: heading });
      cur = [];
      heading = '';
    }
    if (boundary) heading = headingText(line);
    cur.push(line);
  }
  if (cur.length) blocks.push({ md: cur.join(''), heading: heading });

  return blocks;
}

/**
 * 第二遍：单个超大块在非表格区的空行处二次切（避免切断表格渲染）。
 * 仅在块超过 PART_HARD_MAX 时调用。
 */
function splitOversized(md) {
  const lines = toLines(md);
  const pieces = [];
  let buf = [];
  let size = 0;
  let tableRun = false;

  for (const line of lines) {
    const isTbl = isTableLine(line);
    const blank = /^\s*$/.test(line);
    if (buf.length && size >= PART_TARGET && blank && !tableRun && !isTbl) {
      pieces.push(buf.join(''));
      buf = [];
      size = 0;
    }
    buf.push(line);
    size += Buffer.byteLength(line, 'utf8');
    tableRun = isTbl;
  }
  if (buf.length) pieces.push(buf.join(''));
  return pieces.length ? pieces : [md];
}

/**
 * 主入口。返回：
 *   { parts: [{ index, total, md, heading }], split, sourceBytes }
 * parts[i].md 拼接 === body（逐字符强校验）
 */
export function splitMarkdown(body) {
  const text = String(body == null ? '' : body);
  const sourceBytes = Buffer.byteLength(text, 'utf8');

  if (sourceBytes <= SPLIT_THRESHOLD) {
    return { parts: [{ index: 1, total: 1, md: text, heading: '' }], split: false, sourceBytes };
  }

  // 展开超大块后再按目标大小装片
  const units = [];
  for (const block of toBlocks(text)) {
    const size = Buffer.byteLength(block.md, 'utf8');
    if (size > PART_HARD_MAX) {
      for (const piece of splitOversized(block.md)) {
        units.push({ md: piece, heading: block.heading });
      }
    } else {
      units.push(block);
    }
  }

  const groups = [];
  let buf = [];
  let bufSize = 0;
  let heading = '';
  for (const unit of units) {
    const size = Buffer.byteLength(unit.md, 'utf8');
    // 只在块边界开新片：已经装了内容且再加这一块会超目标
    if (buf.length && bufSize + size > PART_TARGET) {
      groups.push({ md: buf.join(''), heading: heading });
      buf = [];
      bufSize = 0;
      heading = '';
    }
    buf.push(unit.md);
    bufSize += size;
    if (!heading) heading = unit.heading;
  }
  if (buf.length) groups.push({ md: buf.join(''), heading: heading });

  // 无损强校验：切分绝不能丢字、不能多字、不能改字
  const joined = groups.map((g) => g.md).join('');
  if (joined !== text) {
    throw new Error('[split] 切分结果与原 md 不一致（无损校验失败），已中止构建');
  }

  const total = groups.length;
  return {
    parts: groups.map((g, i) => ({ index: i + 1, total, md: g.md, heading: g.heading })),
    split: total > 1,
    sourceBytes
  };
}
