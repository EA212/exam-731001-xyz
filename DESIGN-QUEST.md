# 主题：秘境寻宝（Quest）

> 状态：**已实现并验证**。§8–§13 补充了代码分层、游戏闭环、MD 资料解析、轮盘→宝箱链路、主观题融合与编码红线，为本主题的最终口径；§3.4 早期把转盘当「奖励表演」的定位已被 §11 取代。实现见 `src/themes/quest/`，契约与新增主题步骤见 `THEME.md`。
> 参考资料见本地 `.research/`（不入库，`.gitignore` 已排除）。

## 实现结果（2026-11-09 验收）

| 项 | 结果 |
| --- | --- |
| 构建 | `astro check` 0 错误 / 0 警告；`npm run build` + `verify-legacy` 全绿；`engine` / `tokens.css` 正确动态分包 |
| 沉浸 | 390×844 下 `theme-lock` 生效，`body` 下非 `.theme-root` 可见元素 0，站点 header 消失 |
| 隔离 | Shadow DOM 抗污染：宿主注入 `*{color:red!important;background:yellow!important}`，主题金色 `rgb(255,209,102)` 不变 |
| MD 解析 | 详情页 `2021-政治理论真题` 解析出 37 题（客观 + 辨析 + 简答/论述/材料），纯简答卷 43 题全部为记忆卷轴；关卡 51 份可载入出题 |
| 闭环 | 轮盘点扇区判分 → 答对 `+120`/连击×1/钥匙+1 → 宝箱掉落 → 开箱得奖励 → 自动推进第 2 题；答错掉生命 → 生命耗尽 → 星级结算 → 再来一局重开 |
| 主观题 | 记忆卷轴「翻开答案」显示参考答案全文、自动换行无截断，「记住了 / 再看看」自评后收进图鉴 |
| 回归 | 退出后 header 恢复、标准模式筛选/答题/错题本不受影响；全程 0 横向溢出、0 JS 异常 |

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

---

# 定稿补充（实现口径）

以下 §8–§12 为最终实现依据，取代上文一切与之冲突的描述。

## 8. 代码组成与分层

**一句话：一个目录就是一个可整体搬走的游戏；站点只负责「喂数据 + 收回调」，游戏内部零站点依赖。**

```
src/content/专升本/**/*.md          资料层  不动。Markdown 是唯一题源
        │ remark-exam.mjs（已有，不动）
        ▼  <article> > section.exam-q（h3 题干 / ul 选项 / p.exam-answer 答案 / 解析…）
src/lib/theme-host.ts · exam-quiz.ts · wrong-book.ts   宿主层  仅 4 处「薄接线」
        │  职责：把 DOM 解析成 QuestQuestion[]，构造 chapters，挂 3 个回调
        ▼  QuestContext（纯数据 + 回调，不含任何 DOM / 样式 / 玩法）
src/themes/index.ts                  契约层  只做：注册表、theme 参数、挂载、生命周期
        │  职责：create(hostEl, ctx) → dispose；锁屏，销毁， Zero 玩法逻辑
        ▼
src/themes/quest/                    主题包  ★唯一可迁移单元，自带一切
   ├── types.ts      自带全部类型（QuizQuestion / QuestContext / Reward…），不 import 任何 lib
   ├── parse.ts      MD 渲染态 → 结构化题目（客观 + 主观），纯函数
   ├── model.ts      地图节点生成、判分、稀有度、奖励表、状态推进，纯函数
   ├── engine.ts     Phaser 场景：轮盘 / 宝箱 / 粒子 / 相机，只认数据不认业务
   ├── audio.ts      运行时合成 WAV + Howler
   ├── view.ts       HUD / 菜单 / 关卡 / 题干 / 结算的 DOM 与事件（挂 shadowRoot）
   ├── tokens.css    唯一样式表：reset + 全套 --q-* token + 组件样式 + 锁屏/打印隔离
   └── index.ts      装配：状态机把 parse / model / engine / audio / view 串成闭环
```

**依赖方向单向**：`index → view/engine/audio → model/parse → types`，`tokens.css` 只被注入一次。禁止 `quest/*` 出现 `../../lib/*`、`site.css`、`--c-*`、`document.head`（锁屏样式由契约层在 `attachTheme` 同步注入，主题包不碰宿主 head）。

| 层 | 依赖 | 被依赖 | 迁移时 |
| --- | --- | --- | --- |
| 资料/解析 | 无 | 宿主 | 留在原项目 |
| 宿主接线 | 契约 | 站点页面 | 换成新项目自己的数据源 |
| 契约 | 主题注册表 | 宿主 | 复制极薄一层 |
| **主题包** | 仅 `phaser` / `howler` | 契约 | **整目录复制即可** |

设计要点（对应「简洁 / 结构合理 / 逻辑优秀」）：
- **纯函数下沉**：判分、节点生成、奖励、状态推进全部无副作用，可单测；Phaser 只负责画与播。
- **单一数据源**：`state` 一处，视图是 `render(state)` 的投影，无散落标志位。
- **结果先算、动画后播**：轮盘/开箱的中奖在按下的瞬间已定，tween 只是表演，杜绝「动画与结果不一致」。
- **dispose 对称**：定时器、事件、Phaser.Game、Howl 全在 `dispose()` 释放，宿主零残留。

## 9. MD 资料解析：哪个是题目、哪个是答案

`src/content/专升本/**/*.md` 是唯一题源。经 `remark-exam.mjs` 渲染后，每道题是一个 `section.exam-q`：

| Markdown 写法 | 渲染 DOM | 解析为 |
| --- | --- | --- |
| `### 1. 题干…` | `h3` | `stem`（去题号） |
| `- A. … - B. …` | `ul > li` | `options[]`（label + text） |
| `**答案：** B` | `p.exam-answer` | `answer`（归一化 `B` / `ABD` / `对`） |
| `**答案：**` 换行后多段 | `p.exam-answer` + 后续兄弟 `p` | `answerText`（**主观题答案全文**） |
| `**解析：**` / `**答题关键点：**` / `**考点：**` | `p.exam-analysis` / `p.exam-point` / `p.exam-ask` | `analysis` / `keyPoints` |
| `## 一、单项选择题…` | `h2` | `typeName` / `type`（决定玩法通道） |

**关键修正**：现有 `parseQuestions()` 主观题只取了答案第一段，且宿主 `filter(isGradable)` 直接丢弃主观题。新解析 `parse.ts` 做两件事：

1. **客观题**（单选/多选/辨析/判断，`answer` 可归一化 + 有选项）→ `kind: 'choice'`，进轮盘判分。
2. **主观题**（简答/论述/材料分析/名词解释/背诵笔记，`answerText` 为长文）→ `kind: 'scroll'`，`answerText` 全文保留，进「记忆卷轴」节点（不判分、不进错题本、可收藏）。
3. 无 `exam-q` 的纯背诵资料 → 章节标题/段落转成 `kind: 'scroll'` 知识碎片，照样能玩，不会出现「无可玩内容」。

统一结构（主题包自带类型，宿主用 duck typing 对接）：

```ts
interface QuestQuestion {
  id: string; num: string; typeName: string;
  kind: 'choice' | 'scroll';
  stem: string;
  options: { label: string; text: string }[];  // scroll 为空
  answer: string;        // choice: 'B' | 'ABD' | '对'；scroll: ''
  answerText: string;    // scroll: 参考答案全文；choice: 解析/考点
  analysis: string;
}
```

判分 `isCorrect(q, pick)` 沿用站点既有口径（`panduan` 比 `对/错`，其余按字母集合排序比对），由**宿主**通过回调执行，主题不碰 `localStorage` / 错题本 / 站点 DOM。

## 10. 游戏闭环（状态机）

```
        ┌──────────────────────────────────────────────┐
        │                                              │
   [enter] ─► MENU ─► MAP ─► PLAY ─(判分)─► REWARD ─────┤─► 下一节点
                ▲       ▲      │                        │
                │       │      └─ 答错 ─► FEEDBACK ──────┤
                │       │                               │
                │    [选关]                    [节点全部完成 / 生命=0]
                │       │                               ▼
                └──── RESULT ◄────────────────────── RESULT
                          │
                     [再来/换关/退出] ─► dispose → 标准模式
```

| 阶段 | 进入条件（精确） | 动作 | 退出条件 |
| --- | --- | --- | --- |
| **ENTER / 开始** | URL `?theme=quest` 或 session 命中 | 同步锁屏 → Shadow DOM 挂载 → 解析题目 → 建地图 | 有题目 → MENU；无题目但有关卡 → MAP |
| **MENU** | 进入或有题 | 显示规则 / 变体（全部 / 只练错题）/ 开始 / 选关 | 点「开始」→ PLAY |
| **MAP** | 点选关、或关卡完成返回 | 章节/节点列表，已点亮的可重探 | 选节点载入题目 → PLAY |
| **PLAY·选择题** | 当前节点取一道 `choice` 题 | 题干 + 轮盘（扇区=选项） | 点/转选一个扇区 → 判定 |
| **PLAY·主观题** | 当前节点取一道 `scroll` 题 | 记忆卷轴：先盖住答案，点「翻开」看全文，自评「记住了」 | 自评完成 → 计一次通过 |
| **判定** | 已提交答案 | 宿主 `isCorrect` → 回调 `onGrade(q, pick, ok)` 写错题/进度 | 正确 → REWARD；错误 → FEEDBACK |
| **REWARD·答对** | `ok === true` | 固定「叮」+ 钥匙+1 + 连击+1 + 得分 → **宝箱掉落** | 开箱动画结束 → 结算 → 下一节点 |
| **FEEDBACK·答错** | `ok === false` | 低沉音 + 断连击 + 掉 1 生命 + 显示正确扇区/答案 | 停顿 → 下一节点（无宝箱） |
| **REWARD·开箱** | 答对 / 攒够钥匙 / 连击达标 | 三选一或单箱，`tweens.chain` 开箱，稀有度 4 档 | 奖励入袋（金币/钥匙/生命/图鉴碎片/知识点） |
| **推进** | 单节点结算完 | 点亮节点、解锁下一节点 | 还有节点 → PLAY；否则 → RESULT |
| **结束·成功** | 所有节点完成 | `onFinish(correct,total)` → 星级/正确率/宝箱/收藏结算 | 再来 / 换关 / 退出 |
| **结束·失败** | `生命 ≤ 0` | 同上，标「生命耗尽」 | 同上 |
| **退出** | 任意阶段点 ✕ / 结算页「退出」 | `dispose()`：解绑、销毁 Game/音频、移除锁屏与 DOM | `clearTheme()` → 回标准模式 |

**边界规则**：一份试卷=一张地图，5 题=一个节点；生命固定 3；答错不扣已得分；所有动画 ≤ 2.5s 且可点击跳过；答题信息始终可读，动画不盖题干。

## 11. 轮盘 → 宝箱链路（按你举的例子）

> 「有个题目，我点选择轮盘哪一个它是正确的，正确就掉落宝箱，宝箱又怎么样」

把「轮盘」从「抽奖表演」改成**答题器本身**：题目出来，每个选项=轮盘一个扇区，玩家点扇区或拨动轮盘让指针停在某个扇区 = 提交答案。

```
出示题目（题干在上方常驻）
   │
   ├─ 绘制轮盘：N 扇区 = N 个选项（A/B/C/D 或 对/错），扇区上写选项文字摘要
   │            多选/辨析：需点亮多个扇区或选「对/错」两扇区
   │
   ├─ 玩家点扇区 / 轻扫转盘 → 指针锁定某扇区 → 提交
   │
   ├─ 判定（宿主 isCorrect，结果此刻已定，随后只播动画）
   │
   ├─ ✔ 正确：固定「叮」→ 扇区高亮 → 连击+1 钥匙+1 得分+
   │            → ★宝箱从轮盘中心掉落★（连击/正确率决定稀有度）
   │            → 三选一 / 点箱开箱：箱体晃动 → 钥匙飞入 → 开盖 → 光柱 → 奖励弹出
   │            → 奖励：金币 / 额外钥匙 / 生命+1 / 双倍分 / 图鉴碎片 / 主观题知识点
   │            → 揭晓前 0.3s 静默，稀有度越高光柱/粒子/音效越强
   │            → 自动下一题
   │
   └─ ✘ 错误：低沉反馈 → 指针指向正确扇区 → 显示答案/解析
              → 断连击、掉 1 生命、错题回流 → 停顿 → 下一题（无宝箱）
```

- **宝箱是什么**：答对的兑现物，不是随机的挫败源。结果先算、动画后播，稀有度由答题表现决定而非纯随机。
- **主观题也能开箱**：`scroll` 题自评「记住了」视为通过，同样给宝箱与「知识碎片」收藏，答案全文进图鉴。
- **幸运转盘**退居为「连击 ≥ 3 / 章节通关」时的额外奖励关，8 扇区 `Cubic.easeOut` ~3s，不占用主答题节奏。

## 12. 主观题融合

| 题型 | 通道 | 交互 | 判分 | 产出 |
| --- | --- | --- | --- | --- |
| 单选 / 多选 / 辨析 / 判断 | 轮盘 | 点扇区 | 宿主 `isCorrect` | 对→宝箱，错→错题本 |
| 简答 / 论述 / 材料分析 / 名词解释 | 记忆卷轴 | 先默写→翻开答案全文→自评 | 不判分 | 通过→宝箱 + 知识碎片图鉴 |
| 纯背诵笔记（无 exam-q） | 记忆卷轴 | 章节片段逐条翻看 | 不判分 | 收藏碎片 |

主观题 `answerText` 全文保留并排版（分值标注、分点、材料引用都在），「翻开」前后各有一次音效（蓄势 / 揭晓），自评「再看看」会衰减该节点、引导重探。这样 MD 里的**题目、答案、主观题、解析、考点**全部进入游戏，没有资料被丢掉。

## 13. 编码约定（实现红线）

- 零注释、零冗余；每层单一职责；`parse`/`model` 纯函数；`engine` 只画不判；`view` 只渲染不决策。
- `tokens.css` 注入 `shadowRoot`，主题不含任何 `--c-*` / `site.css` 引用；锁屏/打印隔离样式由契约层同步注入 `document.head`，避免异步白屏。
- 手机竖屏 390×844 优先，扇区/按钮触点 ≥ 38px，无键盘依赖，无横向溢出。
- `site.css`、`quiz-player.ts`、`remark-exam.mjs`、标准模式页面零改动。
