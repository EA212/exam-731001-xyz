/**
 * remark-exam —— 把试卷类 Markdown 的固定写法转成可样式化 / 可交互的 HTML 结构。
 *
 * 约定（见 src/content.config.ts 顶部注释）：
 *   ##  一、单项选择题（……）      → 题型分组
 *   ### 1. 题干                    → 单道题目（连同其后的选项 / 答案 / 解析包进 <section class="exam-q">）
 *   **答案：** C                   → <p class="exam-answer">
 *   **解析：** ……                  → <p class="exam-analysis">
 *   **考点：** ……                  → <p class="exam-point">
 *   **问题：** ……                  → <p class="exam-ask">
 *
 * ⚠️ 历史 bug：Markdown 的 `**答案：** B` 会被解析成 <p><strong>答案：</strong> B</p>，
 *    段落首个子节点是 strong（不是 text），早期实现只判断 `first.type === 'text'`，
 *    导致 exam-answer 类名从未被加上 —— 于是「显示答案 / 隐藏答案」按钮点了没反应
 *    （页面上根本没有可折叠的节点）。这里改成读取「段落开头的可见文本」，
 *    同时支持裸文本、**加粗**、*斜体* 三种写法。
 */
import { visit } from 'unist-util-visit';

/** 行首标签 → CSS 类名 */
const LABELS = [
  [/^(答案|参考答案|答案要点|【答案】|【答案要点】)\s*[：:]/, 'exam-answer'],
  [/^(解析|答案解析|试题解析|参考答案及解析|【解析】)\s*[：:]/, 'exam-analysis'],
  [/^(考点|知识点|【考点】)\s*[：:]/, 'exam-point'],
  [/^(问题|【问题】)\s*[：:]/, 'exam-ask'],
];

/** 把 inline 节点（text / strong / emphasis / link…）拼成纯文本 */
function inlineText(node, depth = 0) {
  if (!node || depth > 4) return '';
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map((c) => inlineText(c, depth + 1)).join('');
}

/**
 * 取段落开头的可见文本（用于识别「答案：」这类行首标签）。
 * 只看第一个 inline 子节点，避免把正文中间的「答案」也误判。
 */
function leadingText(node) {
  const first = node.children?.[0];
  if (!first) return '';
  if (first.type === 'text') return first.value;
  if (
    first.type === 'strong' ||
    first.type === 'emphasis' ||
    first.type === 'delete'
  ) {
    return inlineText(first).slice(0, 60);
  }
  return '';
}

function decorateParagraph(node) {
  const raw = leadingText(node);
  if (!raw) return;
  for (const [re, cls] of LABELS) {
    if (!re.test(raw)) continue;
    node.data = node.data || {};
    node.data.hProperties = node.data.hProperties || {};
    const prev = node.data.hProperties.className || [];
    const list = Array.isArray(prev) ? [...prev] : [prev];
    if (!list.includes(cls)) list.push(cls);
    node.data.hProperties.className = list;
    return;
  }
}

/** 把每个 ### 题目块包进一个 section，便于整体高亮 / 折叠 / 逐题作答 */
function wrapQuestionSections(tree) {
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur) {
      out.push(cur);
      cur = null;
    }
  };

  for (const node of tree.children) {
    const isHeading = node.type === 'heading';
    if (isHeading && node.depth <= 2) {
      flush();
      out.push(node);
      continue;
    }
    if (isHeading && node.depth === 3) {
      flush();
      cur = {
        type: 'examSection',
        children: [node],
        data: { hName: 'section', hProperties: { className: ['exam-q'] } },
      };
      continue;
    }
    if (cur) cur.children.push(node);
    else out.push(node);
  }
  flush();
  tree.children = out;
}

export default function remarkExam() {
  return (tree) => {
    visit(tree, 'paragraph', decorateParagraph);
    wrapQuestionSections(tree);
  };
}
