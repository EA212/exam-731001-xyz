import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import {
  CATEGORIES,
  QUESTION_TYPES,
  SUBJECTS,
  pathToSlug,
} from './lib/taxonomy';

/* ------------------------------------------------------------------ *
 *  专插本（zsb）资料集合
 *  ----------------------------------------------------------------
 *  内容目录：src/content/专升本/<科目中文名>/<文件>.md
 *    （历史遗留目录名为 src/content/zsb/mingfa|zhengzhililun，
 *      为了不改动 URL 与既有代码，这里用 glob loader 做「目录 → slug」映射）
 *
 *  slug 规则见 lib/taxonomy.ts 的 pathToSlug()：
 *    民法/2021-民法真题.md  → mingfa/2021-民法真题  →  /zsb/mingfa/2021-民法真题/
 *
 *  正文约定（供题库页面高亮 / 折叠 / 答题模式解析）：
 *    ##  一、单项选择题（本大题共 25 小题，每小题 1 分，共 25 分）   ← 题型分组
 *    ### 1. 题干……                                                  ← 单题
 *    - A. 选项 / - B. 选项 ……                                       ← 选择题选项
 *    **答案：** C                                                    ← 答案
 *    **解析：** ……                                                   ← 解析
 *    **考点：** ……                                                   ← 知识点（可选）
 * ------------------------------------------------------------------ */

const questionTypeEnum = z.enum(
  Object.keys(QUESTION_TYPES) as [keyof typeof QUESTION_TYPES]
);
const categoryEnum = z.enum(
  Object.keys(CATEGORIES) as [keyof typeof CATEGORIES]
);
const subjectKeyEnum = z.enum(
  Object.keys(SUBJECTS) as [keyof typeof SUBJECTS]
);

/** 题型分组（正文里的一级标题，用于目录 / 统计） */
const sectionSchema = z.object({
  /** 分组标题，如「单项选择题」 */
  name: z.string(),
  /** 题型 */
  type: questionTypeEnum.default('qita'),
  /** 题量 */
  count: z.number().int().nonnegative().optional(),
  /** 分值 */
  score: z.number().nonnegative().optional(),
});

const examples = defineCollection({
  loader: glob({ base: './src/content/examples', pattern: '**/*.{md,mdx}' }),
});

const zsb = defineCollection({
  loader: glob({
    base: './src/content/专升本',
    pattern: '**/*.md',
    generateId: ({ entry, data }) =>
      pathToSlug(entry, data?.subjectKey as string | undefined),
  }),
  schema: z.object({
    /** 文档标题 */
    title: z.string(),
    /** 科目（中文名，如「民法」） */
    subject: z.string(),
    /** 科目目录（英文 key，用于归档 / 筛选） */
    subjectKey: subjectKeyEnum,
    /** 资料类别 */
    category: categoryEnum,
    /** 考试年份（非真题可为空） */
    year: z.number().int().min(1990).max(2100).optional(),
    /** 考试全称 */
    exam: z.string().optional(),
    /** 来源文件（raw 目录里的原始文件名） */
    source: z.string().optional(),
    /** 总分 */
    score: z.number().optional(),
    /** 考试时长（分钟） */
    duration: z.number().int().optional(),
    /** 题型分组 */
    sections: z.array(sectionSchema).default([]),
    /** 原卷是否提供答案（false → 页面提示「暂无答案」） */
    answerProvided: z.boolean().default(false),
    /** 是否附有逐题解析 */
    analysisProvided: z.boolean().default(false),
    /** 标签 */
    tags: z.array(z.coerce.string()).default([]),
    /** 列表排序权重（一般用年份） */
    order: z.number().default(0),
    /** 是否隐藏 */
    draft: z.boolean().default(false),
    /** 章节号（背诵笔记类专有，如「第一章」） */
    chapter: z.string().optional(),
    /** 资料类型补充说明 */
    type: z.string().optional(),
  }),
});

export const collections = { examples, zsb };
