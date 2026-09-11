import { defineCollection, z } from 'astro:content';

/**
 * 示例集合（模板自带）
 */
const examples = defineCollection({ type: 'content' });

/* ------------------------------------------------------------------ *
 *  专插本（zsb）资料集合
 *  ----------------------------------------------------------------
 *  设计目标：把「真题试卷 / 练习题 / 背诵笔记 / 答题模板 / 教材」等资料
 *  统一成一套可被网页直接渲染的数据结构。
 *
 *  目录约定（文件路径即 collection id）：
 *    src/content/zsb/<科目目录>/<文件>.md
 *      mingfa/          → 民法
 *      zhengzhililun/   → 政治理论
 *
 *  正文档内约定（供题库页面高亮 / 折叠）：
 *    ##  一、单项选择题（本大题共 25 小题，每小题 1 分，共 25 分）   ← 题型分组
 *    ### 1. 题干……                                                  ← 单题
 *    - A. 选项 / - B. 选项 ……                                       ← 选择题选项
 *    **答案：** C                                                    ← 答案
 *    **解析：** ……                                                   ← 解析
 *    **考点：** ……                                                   ← 知识点（可选）
 * ------------------------------------------------------------------ */

/** 考试科目 */
export const SUBJECTS = {
  mingfa: '民法',
  zhengzhililun: '政治理论',
} as const;

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

const questionTypeEnum = z.enum(
  Object.keys(QUESTION_TYPES) as [keyof typeof QUESTION_TYPES]
);
const categoryEnum = z.enum(
  Object.keys(CATEGORIES) as [keyof typeof CATEGORIES]
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

const zsb = defineCollection({
  type: 'content',
  schema: z.object({
    /** 文档标题 */
    title: z.string(),
    /** 科目（中文名，如「民法」） */
    subject: z.string(),
    /** 科目目录（英文 key，用于归档 / 筛选） */
    subjectKey: z.enum(
      Object.keys(SUBJECTS) as [keyof typeof SUBJECTS]
    ),
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
  }),
});

export const collections = { examples, zsb };
