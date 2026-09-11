/**
 * remark-exam —— 把试卷类 Markdown 的固定写法转成可样式化 / 可交互的 HTML 结构。
 *
 * 约定（见 .workbuddy/tmp/MD_SPEC.md）：
 *   ##  一、单项选择题（……）      → 题型分组
 *   ### 1. 题干                    → 单道题目（连同其后的选项 / 答案 / 解析包进 <section class="exam-q">）
 *   **答案：** C                   → <p class="exam-answer">
 *   **解析：** ……                  → <p class="exam-analysis">
 *   **考点：** ……                  → <p class="exam-point">
 *   **问题：** ……                  → <p class="exam-ask">
 */
import { visit } from 'unist-util-visit';

/** 行首标签 → CSS 类名 */
const LABELS = [
  [/^(答案|参考答案|答案要点|【答案】|【答案要点】)\s*[：:]\s*/, 'exam-answer'],
  [/^(解析|答案解析|试题解析|【解析】)\s*[：:]\s*/, 'exam-analysis'],
  [/^(考点|知识点|【考点】)\s*[：:]\s*/, 'exam-point'],
  [/^(问题|【问题】)\s*[：:]\s*/, 'exam-ask'],
];

function decorateParagraph(node) {
  const first = node.children?.[0];
  if (!first || first.type !== 'text') return;
  const raw = first.value;
  for (const [re, cls] of LABELS) {
    if (re.test(raw)) {
      node.data = node.data || {};
      node.data.hProperties = node.data.hProperties || {};
      const prev = node.data.hProperties.className || [];
      node.data.hProperties.className = Array.isArray(prev) ? [...prev, cls] : [prev, cls];
      return;
    }
  }
}

/** 把每个 ### 题目块包进一个 section，便于整体高亮 / 折叠 */
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
