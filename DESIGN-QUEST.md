# 主题设想：秘境寻宝（Quest）

> 状态：**设想稿，待确认**。本轮不改动任何游戏代码；确认后按本文从零重写、整包删除旧主题。
> 参考资料见本地 `.research/`（不入库）。

## 1. 目标与硬约束

| 项 | 要求 |
| --- | --- |
| 玩法 | 抛弃「光舱接星」的下落接物，改为**开宝箱 + 探险地图 + 幸运转盘** |
| 样式独立 | 主题只用**自己的一套样式表**，完全不引用 `site.css`、不引用 `--c-*` token |
| 整包迁移 | 复制**一个目录**到别的项目即可运行，只依赖 `phaser` / `howler` 两个 npm 包 |
| 双向不污染 | 改主题不影响原站；原站改全局样式也不影响主题（Shadow DOM 物理隔离） |
| 代码 | 全部从零写，删除旧 `catch` 全部文件；零注释、零冗余、模块解耦 |
| 端 | 手机竖屏优先，单指点按 / 拖动，无键盘依赖 |
| 标准模式 | 页面、组件、存储、原有答题逻辑零改动 |
| 边界 | 仅虚拟奖励（金币 / 钥匙 / 生命 / 收藏），无下注、无真钱、无变现、无对抗排行榜 |

## 2. 独立性（第一优先级）

### 2.1 一个目录就是一个包

```
src/themes/quest/
├── index.ts      入口：mount(host, ctx) → dispose，注册到 themes 表
├── types.ts      自带全部类型（QuizQuestion / ThemeHost / QuestContext）
├── tokens.css    唯一样式表：reset + 全部 --q-* token + 全部组件样式
├── engine.ts     Phaser 场景：地图 / 宝箱 / 转盘 / 粒子
├── map.ts        节点生成与解锁（纯函数）
├── audio.ts      运行时合成 WAV + Howler 播放
└── vendor.d.ts   howler / css?inline 声明
```

**禁止出现**：`import ... from '../../lib/*'`、`import '../styles/*'`、`var(--c-*)`、任何对 `document.head` 之外全局样式的依赖。

### 2.2 Shadow DOM

```ts
const root = document.createElement('div');
root.attachShadow({ mode: 'open' }).innerHTML =
  `<style>${css /* 注入 shadowRoot，不是 document.head */}</style><main class="q-world">…</main>`;
```

- 主题 CSS 全部写在 shadowRoot 内；外部 `*` / `button` / `a` / `!important` 一律进不来，内部样式也出不去。
- 主题自带完整 reset：`box-sizing`、`margin`、`font`、`color`、`button`、`tap-highlight`、`touch-action`。
- 锁屏样式（`html.theme-lock`、`body>:not(.theme-root)`、`@media print`）由**主题包自带并同步注入 document.head**，不再放在契约层。
- `contain: layout style` 收窄重算范围。

### 2.3 极薄契约

```ts
mount(host: HTMLElement, ctx: QuestContext): () => void

interface QuestContext {
  title: string;
  questions: QuizQuestion[];          // 宿主传入，主题自带类型定义
  chapters: { label: string; href: string; meta?: string }[];
  variants?: { id: string; label: string; questions: QuizQuestion[] }[];
  notes?: string[];                   // 无客观题材料 → 知识碎片收藏品
  load?(href: string): Promise<QuizQuestion[]>;
  onGrade(q: QuizQuestion, pick: string, correct: boolean): void;
  onFinish(correct: number, total: number): void;
  onClose(): void;
}
```

判分仍由宿主的 `isCorrect()` 负责；主题**不碰 localStorage、不碰错题本、不碰站点 DOM**，只通过三个回调回写。宿主接线点保持现有 4 处（首页卡片 / 列表页 / 详情页 / 错题本），只改注册表里的主题 id。

### 2.4 迁移验收

1. 空白项目只装 `phaser` + `howler`，复制 `src/themes/quest/` 一个目录。
2. 一行 `mount(host, ctx)` 即可完整跑通。
3. 宿主注入 `* { color: red !important }`，主题视觉不变。
4. `dispose()` 后宿主 DOM / 样式零残留。

## 3. 玩法

### 3.1 主循环

```
出示题目 → 选择 → 判定
  ├ 答对 → 固定「叮」+ 1 把钥匙 + 连击 +1 → 开箱 / 转盘结算 → 点亮地图节点 → 自动下一题
  └ 答错 → 低沉反馈 + 断连击 + 短暂停顿 → 错题回流 → 下一题（不给钥匙）
```

答题始终是主界面；所有动画 ≤ 2.5s 且可跳过，不能盖过题干。借鉴 Blooket *Gold Quest*：**答对是开箱的唯一入场券**。

### 3.2 探险地图

一份试卷 = 一张地图，5 题 = 一个节点，完成才点亮并解锁下一节点（Duolingo 技能树 + Blooket *Tower of Doom*）。

| 节点 | 触发 | 作用 |
| --- | --- | --- |
| 题关 | 默认 | 一组题，答对累计钥匙 |
| 宝箱 | 攒够钥匙 | 三选一开箱 |
| 轮盘 | 连击 ≥ 3 / 章节通关 | 一次幸运转盘 |
| 休息 | 路径选择 | 答对 3 题换 1 点生命 |
| Boss | 章节末 | 综合题组，通关给大额奖励与收藏 |
| 重探 | 有错题 | 旧节点衰减褪色，复习后重新点亮 |

### 3.3 开宝箱

- 三个闭合宝箱 → 点选其一 → `tweens.chain` 编排「箱体晃动 → 钥匙飞入旋转 → 贴图切换 → 光柱 → 奖励弹出」（Phaser 官方 `chest-sequence`）。
- 结果表（单机化，去掉偷取 / 交换）：金币、额外钥匙、生命 +1、双倍分、免答卡、稀有收藏品、空箱、小恶魔（扣金币，不扣已得分）。
- 稀有度 4 档：**普通 / 稀有 / 史诗 / 传说**，颜色、光柱、粒子密度、震屏、音效时长逐档递增。
- 收藏品进「图鉴」，是长期动机，不影响答题正确性。

### 3.4 幸运转盘

- 8 扇区，运行时用 `Graphics.generateTexture()` 画盘面，零图片素材。
- `angle: 360*rounds + degrees`、`ease: 'Cubic.easeOut'`、~3s；中奖扇区用 `slices-1-floor(degrees/(360/slices))` 反算。
- **结果先算、动画后播**：由答题表现（连击数 / 正确率）决定奖项，转盘只负责表演，避免纯随机带来的挫败。
- 奖项：金币倍率、额外钥匙、生命、宝箱、双倍分、图鉴碎片、谢谢参与。

### 3.5 反馈节奏

`选择 → 即时图文反馈 → 0.3~1.5s 动画 → 奖励结算 → 自动推进`。答错也要清晰反馈但不给奖励。多选题、判断题统一走宿主判分；无客观题的背诵材料转成「知识碎片」收藏节点，不参与判分。

## 4. 声效

全部运行时合成 WAV（`DataView` + `btoa` + `Howl`），**零音频文件**，可整体静音。

| 阶段 | 声音 | 合成要点 |
| --- | --- | --- |
| 答对 | 固定「叮」 | 880Hz 短音，永不变化（emotional tagging） |
| 答错 | 低沉短音 | 220Hz，快速衰减 |
| 连击 | 每连升 1 半音 | 3 音上行，上限 5 连 |
| 开箱蓄势 | 上升琶音 | 523/659/784/1047Hz，轻混响 |
| 揭晓 | 按稀有度分档 | 1.2~2.0s，越稀有时长越长、和声越满 |
| 转盘旋转 | 低频 whirr + tick | tick 间隔随减速变长 = 听觉进度条 |
| 中奖 / 稀有 | 上扬 stinger + 琶音 | 小奖轻 jingle，传说用完整和声 |
| 留白 | 揭晓前 0.3s 静默 | 对比比堆叠更重要 |
| 环境 | 低频氛围 loop | 独立层，可单独静音；不做长 BGM |

对应三条心理原则：anticipation loops（蓄势）、variable reward cues（稀有度分档）、emotional tagging（固定答对音）。

## 5. 从零删除清单（确认后执行）

| 删除 | 说明 |
| --- | --- |
| `src/themes/catch.ts` | 旧主题控制器 |
| `src/themes/catch/` 整个目录 | engine / audio / style / 声明文件，全部作废 |
| `src/themes/index.ts` 中 `catchTheme` 引用与 `LOCK_CSS` | 锁屏样式移入主题包 |
| `THEME.md` 中 catch 相关描述 | 随实现同步更新 |

**保留不动**：`site.css`（上一轮已做到零主题选择器，本次改主题不再碰它）、`exam-quiz.ts` / `wrong-book.ts` / `theme-host.ts` 的接线结构、首页 `themes` 数组（自动跟随注册表）、标准答题组件 `quiz-player.ts`。

## 6. 验收口径

| 项 | 标准 |
| --- | --- |
| 构建 | `astro check` 0 错误；`npm run build` + `verify-legacy` 全绿 |
| 手机 | 390×844，零横向溢出、零 JS 异常，全部触点 ≥ 38px |
| 沉浸 | `html.theme-lock` 生效，`body` 下非 `.theme-root` 可见元素为 0 |
| 独立 | Shadow DOM 抗污染测试通过；空白项目复制目录能跑通 |
| 回归 | 标准模式筛选 / 答题 / 判分 / 错题本全部不受影响 |
| 玩法 | 答对得钥匙、答错不给；开箱 / 转盘 / 地图解锁 / 退出均可完成 |

## 7. 分期

| 期 | 内容 |
| --- | --- |
| P0 | 包骨架 + Shadow DOM + 地图 + 答题 + 开箱，跑通主循环 |
| P1 | 幸运转盘 + 稀有度分层 + 图鉴 / 成就 |
| P2 | 音效分层、粒子与相机动效、动效打磨 |
