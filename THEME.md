# 答题主题层设计说明

本文描述「答题主题」这一层的契约与接线，供后续 AI / 开发者新增主题时参照。读第 3、4、6 节即可动手，不必改动站点现有代码。玩法与闭环的完整设计见 `DESIGN-QUEST.md`。

## 1. 定位与边界

主题不是 A/B 实验，也不是标准答题界面的皮肤，而是**独立于站点、可整包迁移的一层全屏游戏世界**。

| 要求 | 说明 |
| --- | --- |
| 完全沉浸 | 进入后不出现站点 header、面包屑、首页内容、旧答题组件；只有主题自己的画面。 |
| 手机优先 | 竖屏布局、手指点按 / 轻扫，不依赖键盘。 |
| 样式独立 | 主题自带唯一样式表，注入 Shadow DOM；不引用 `site.css`、不引用 `--c-*`、不改站点样式。 |
| 整包迁移 | 复制一个主题目录 + 装 `phaser` / `howler` 即可在别的项目跑通，双向不污染。 |
| 彻底解耦 | 标准模式页面 / 组件 / 存储零改动；删掉整个 `src/themes/`，标准模式照常工作。 |
| 平级扩展 | 主题是注册表里平级的一项，首页自动列出。 |

## 2. 分层

```
src/content/专升本/**/*.md（题源，Markdown）
        │ remark-exam.mjs → <article> > section.exam-q
        ▼
宿主接线（theme-host.ts / exam-quiz.ts / wrong-book.ts）
        │  解析成 QuestQuestion[]（客观 + 主观），挂 3 个回调
        ▼
主题契约（themes/index.ts）  ← 唯一接缝：注册表 / 状态 / 沉浸锁 / 挂载销毁
        │  create(hostEl, ctx) → dispose
        ▼
src/themes/quest/  ← 唯一可迁移单元，自带一切
   types.ts     自带全部类型，不 import 任何 lib
   parse.ts     MD 渲染态 → 结构化题目（题干/选项/答案/主观答案全文/解析）
   model.ts     地图节点、判分、稀有度、奖励、结算（纯函数）
   engine.ts    Phaser 轮盘答题器 + 宝箱掉落/开箱（只认数据）
   audio.ts     运行时合成 WAV + Howler，零音频文件
   view.ts      HUD / 菜单 / 地图 / 卷轴 / 结算 DOM
   tokens.css   唯一样式表，注入 shadowRoot
   index.ts     状态机把各层串成完整闭环
```

依赖单向：`index → view/engine/audio → model/parse → types`。禁止主题包出现 `../../lib/*`、`site.css`、`--c-*`。

## 3. 契约（唯一接缝）

```ts
interface QuestQuestion {
  id: string; num: string; typeName: string;
  type: 'danxuan' | 'duoxuan' | 'panduan' | 'other';
  kind: 'choice' | 'scroll';   // choice 进轮盘判分；scroll 是主观题记忆卷轴
  stem: string; material: string;
  options: { label: string; text: string }[];
  answer: string;              // choice: 'B' / 'ABD' / '对'；scroll: ''
  answerText: string;          // 主观题参考答案全文
  analysis: string; keyPoints: string; point: number;
}

interface QuestHost {
  questions: QuestQuestion[];
  chapters: { label: string; href: string; meta: string }[];
  variants: { id: string; label: string; questions: QuestQuestion[] }[];
  load?(href: string): Promise<QuestQuestion[]>;
  onGrade(q, pick, correct): void;   // 必须回写 markSeen / saveWrong
  onFinish(correct, total): void;
  onClose(): void;                   // 必须 clearTheme() 回标准模式
}

interface QuizTheme {
  id: string; name: string; tagline: string; accent: string;
  create(ctx: { mount: HTMLElement; title: string; host: QuestHost }): () => void;
}

export const themes: QuizTheme[];
export function currentTheme(): QuizTheme | null;
export function clearTheme(): void;
export function attachTheme(theme, title, host): { destroy(): void };
export function parseArticle(article: Element, docId?: string): QuestQuestion[];
```

- 主题自带类型，宿主用 duck typing 对接，不 import 站点 `QuizQuestion`。
- `parseArticle` 是主题包自带的纯函数，宿主复用它把 MD 渲染态解析成题目（**含主观题答案全文**），无需自己造解析器。
- 判分 `isCorrect` 也是主题包自带纯函数，结果先算、动画后播。

**主题状态**：URL `?theme=<id>` 优先，`?theme=none` 退出；否则读 `sessionStorage["zsb.theme.v1"]`。

**沉浸锁**：`attachTheme()` 同步注入一段 `<style>` 给 `<html>` 加 `theme-lock`（`body > :not(.theme-root) { display:none }`），第一帧起站点 header / 面包屑 / 首页就不可见，主题 CSS 异步到达前已有深色底。`host.onClose` 被包装：先 `destroy()` 再执行宿主清理。

**Shadow DOM**：`create()` 里 `mount.attachShadow({mode:'open'})`，`tokens.css` 注入 shadowRoot（含完整 reset + 全套 `--q-*` token）。外部 `* { color:red !important }` 进不来，主题样式也出不去。契约层的锁屏样式用 `background-color`（非 `background` 简写）以免覆盖主题渐变。

## 4. 宿主接线（已就位，新增主题无需改动）

| 入口 | 行为 |
| --- | --- |
| 首页卡片 | `/zsb/?theme=<id>` → 列表页命中 `currentTheme()` → `openThemeIndex(theme)` |
| 列表页 | `chapters` 取自 `.zsb-card`，`load(href)` 用 `fetch` + `DOMParser` + `parseArticle()` |
| 详情页 | `initQuiz()` 命中主题时构造 host 并 `attachTheme()` 后 `return`，不创建标准组件 |
| 错题本 | `startRedo()` 命中主题时用错题组进游戏，否则 `createQuizPlayer()` |

`onGrade` 统一做 `markSeen` 与 `saveWrong`，主题里的每次作答都进错题本和进度统计。主观题「记住了」按 `onGrade(q,'',true)` 记为通过，不写错题本。

## 5. 当前主题：秘境寻宝（quest）

**闭环**：`进入 → 菜单/地图 → 轮盘答题 → 判分 → 答对掉宝箱→开箱奖励→点亮节点→下一题 / 答错掉生命→错题回流 → 题尽或生命耗尽 → 星级结算 → 再来/换关/退出`。

题目出来，选项铺在轮盘扇区上，点选正确扇区即答对，宝箱随后掉落、点击开箱得奖励（星币 / 钥匙 / 生命 / 双倍分 / 图鉴碎片 / 知识点）。主观题（简答 / 论述 / 材料分析 / 辨析 / 背诵笔记）走「记忆卷轴」：先默写 → 翻开答案全文 → 自评记住，同样通关并收进图鉴。详细玩法、状态机与音效分层见 `DESIGN-QUEST.md` §8–§13。

| 模块 | 职责 |
| --- | --- |
| `index.ts` | 状态机：菜单 / 地图 / 答题 / 判分 / 开箱 / 结算 / 退出，事件委托 |
| `parse.ts` | MD → 题目（客观 + 主观全文），判分纯函数 |
| `model.ts` | 节点生成、稀有度、奖励表、星级（纯函数） |
| `engine.ts` | Phaser：轮盘绘制与旋转、宝箱掉落与开箱、粒子与相机；只暴露 `wheel / chest / pause / destroy` |
| `audio.ts` | 合成 WAV，固定答对音 + 稀有度分档揭晓音 + 转盘 tick |
| `view.ts` | Shadow DOM 下的 HUD / 菜单 / 地图 / 题干 / 卷轴 / 结算卡片 |
| `tokens.css` | 唯一样式表，物理隔离 |

`engine` / `tokens.css` 动态 import，标准模式不会下载 Phaser（约 1.5 MB）与 Howler。

## 6. 新增一个主题

1. 新建 `src/themes/<id>/`，实现 `QuizTheme` 对象；`create(ctx)` 里 `attachShadow`、渲染 `ctx.mount`、用 `ctx.host` 取题判分。
2. 在 `src/themes/index.ts` 的 `themes` 数组注册。
3. 首页卡片 / 列表页关卡 / 详情页 / 错题本自动生效，无需其它接线。

最小骨架：

```ts
import type { QuizTheme } from './index';

export const myTheme: QuizTheme = {
  id: 'my', name: '主题名', tagline: '一句话玩法', accent: '#6c8cff',
  create(ctx) {
    const shadow = ctx.mount.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>/* 自带 reset + 组件样式 */</style><main class="hud"></main>`;
    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b?.dataset.act === 'exit') ctx.host.onClose();
    };
    shadow.addEventListener('click', onClick);
    return () => shadow.removeEventListener('click', onClick);
  },
};
```

每答一题调 `ctx.host.onGrade(q, pick, correct)`，结束调 `onFinish(correct, total)`，退出调 `onClose()`。

## 7. 编码约定

- **零注释、命名简洁、单一职责**；不写分节横幅注释。
- 重资源（引擎、音频、样式）动态导入，标准模式零负担。
- 只用 pointer / touch，不引入键盘；不复用 `.quiz-*` / `.wb-*` 旧答题 DOM。
- 样式全部注入 shadowRoot；契约层只注入锁屏那一段（`background-color`，不留 `touch-action:none` 以免阻止关卡列表滚动）。
- `dispose()` 清理定时器、监听、Phaser.Game、Howl 与注入的 `<style>`。
- 主题代码不写站点业务判断；需要新能力时扩展 `QuestHost`。
- `.research/` 仅供本地参考，不入库。

## 8. 验证口径

手机视口（390×844）实测：`astro check` 0 错误；`npm run build` + `verify-legacy` 全绿；`theme-lock` 生效且 `body` 下非 `.theme-root` 元素全部不可见；Shadow DOM 抗污染（宿主注入全局 `!important` 主题视觉不变）；客观题与主观题全部解析进游戏；轮盘答题→答对掉宝箱→开箱→推进；答错掉生命→生命耗尽→结算→再来一局；主观题卷轴答案全文；暂停 / 静音 / 退出；退出后 header 恢复、标准答题与错题本不受影响；零横向溢出、零 JS 异常。
