/**
 * 资料库分类字典（构建期 / 前端共用，纯数据，无 Astro 依赖）
 *
 * 注意：内容目录使用中文命名（src/content/专升本/民法、政治理论），
 * 而 collection 名与 URL 仍沿用英文 key，映射关系见 DIR_TO_SUBJECT。
 */

/** 考试科目：英文 key（用于 URL / 筛选） → 中文名 */
export const SUBJECTS = {
  mingfa: '民法',
  zhengzhililun: '政治理论',
} as const;

export type SubjectKey = keyof typeof SUBJECTS;

/** 资料类别 */
export const CATEGORIES = {
  zhenti: '真题', // 历年真题试卷
  lianxi: '练习题', // 章节练习 / 主观题练习
  biji: '背诵笔记', // 知识点笔记
  bibei: '必背考点', // 高频必背
  daan: '习题答案', // 教材课后题答案
  tiku: '题库汇总', // 多年真题汇编
  muban: '答题模板', // 主观题万能模板 / 答题技巧
  daotu: '思维导图', // 知识框架图
  jiaocai: '教材', // 教材原文
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

/** 题型 */
export const QUESTION_TYPES = {
  danxuan: '单选',
  duoxuan: '多选',
  panduan: '判断',
  tiankong: '填空',
  mingci: '名词解释',
  jianada: '简答',
  bianxi: '辨析',
  lunshu: '论述',
  anli: '案例分析',
  jisuan: '计算',
  qita: '其他',
} as const;

export type QuestionTypeKey = keyof typeof QUESTION_TYPES;

/** 内容目录中文名 → 科目 key（新增科目目录时在这里登记） */
export const DIR_TO_SUBJECT: Record<string, SubjectKey> = {
  民法: 'mingfa',
  政治理论: 'zhengzhililun',
};

/**
 * 把内容文件的相对路径转成稳定的 slug（即 URL 段）。
 *   民法/2018-民法真题.md                 → mingfa/2018-民法真题
 *   政治理论/2025-政治理论真题.md          → zhengzhililun/2025-政治理论真题
 *   政治理论/新思想高分背诵笔记/第一章.md   → zhengzhililun/新思想高分背诵笔记-第一章
 */
export function pathToSlug(relativePath: string, subjectKey?: string): string {
  const rel = relativePath.replace(/\.(md|mdx)$/i, '');
  const parts = rel.split('/').filter(Boolean);
  const key = subjectKey || DIR_TO_SUBJECT[parts[0]] || parts[0] || 'misc';
  const rest = parts.slice(1).join('-');
  return rest ? `${key}/${rest}` : key;
}

/* ------------------------------------------------------------------ *
 *  客观题统计
 *  ----------------------------------------------------------------
 *  正文里的答案写法统一为：**答案：** B / **答案：** ABD / **答案：** 对
 *  这里只统计「能自动判分」的题（单选 / 多选 / 判断），主观题不计入。
 * ------------------------------------------------------------------ */

const ANSWER_LINE_RE =
  /^[ \t>*\-]*(?:【?答案要点】?|【?参考答案】?|【?答案】?|答案)\s*[：:]\s*(?:\*\*)?\s*(.*)$/;

/**
 * 从整篇 markdown 正文里统计「可自动判分的题目数量」。
 * 与前端答题模式（exam-quiz.ts 解析渲染后的 DOM）保持同一口径：
 *  - 单选 / 多选：`**答案：** ABD`
 *  - 判断 / 辨析：`**答案：** 正确`，或「答案：」换行后写「（1）错误。（2 分）」
 * 主观题（简答 / 论述 / 案例…）不计入。
 */
export function countObjectiveQuestions(body: string): number {
  const lines = body.split(/\r?\n/);
  let inVerdictSection = false;
  let n = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      inVerdictSection = /辨析|判断/.test(h[1]);
      continue;
    }

    const m = line.match(ANSWER_LINE_RE);
    if (!m) continue;

    const val = (m[1] || '').trim();
    if (normalizeObjectiveAnswer(val)) {
      n++;
      continue;
    }

    // 结论写在下一段的辨析题
    if (inVerdictSection) {
      const next =
        lines
          .slice(i + 1, i + 4)
          .map((s) => s.replace(/^\s+/, ''))
          .find((s) => s && s !== '---') || '';
      const vm = next.slice(0, 40).match(/正确|错误/);
      if (vm) n++;
    }
  }
  return n;
}

/** 归一化一行答案文本，返回可判分的答案（如 `ABD` / `对`），不可判分返回 null */
export function normalizeObjectiveAnswer(raw: string): string | null {
  let v = (raw || '').replace(/\*/g, '').replace(/\s+/g, '').trim();
  // 去掉夹在答案里的分值标注，如「（1 分）」「(2分)」
  v = v.replace(/[（(]\s*[0-9一二三四五六七八九十]+\s*分\s*[）)]/g, '');
  // 去掉包裹的括号与句末标点
  v = v.replace(/^[（(【\[]+/, '').replace(/[）)】\]]+$/, '');
  v = v.replace(/[。．.，,、；;！!？?：:]+$/g, '');
  if (/^[A-H](?:[、,，]?[A-H]){0,7}$/.test(v)) {
    return [...new Set(v.replace(/[、,，]/g, '').split(''))].sort().join('');
  }
  if (/^(对|错|正确|错误|√|×|✓|✗|T|F)$/.test(v)) {
    return /^(对|正确|√|✓|T)$/.test(v) ? '对' : '错';
  }
  return null;
}
