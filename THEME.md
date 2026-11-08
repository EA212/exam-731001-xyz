# 答题主题层设计说明

本文档描述「答题主题」这一层的构想与契约，供后续 AI / 开发者在此基础上新增主题时参照。阅读完第 3、4、6 节即可动手，不需要改动站点现有代码。

## 1. 定位与边界

主题不是 A/B 实验，也不是标准答题界面的皮肤，而是**独立于站点的一层全屏世界**。

| 要求 | 说明 |
| --- | --- |
| 完全沉浸 | 进入主题后不出现站点 header、面包屑（首页 / 斜杠）、首页内容、旧答题组件。屏幕上只有主题自己的画面。 |
| 手机优先 | 竖屏布局、手指拖动 / 点按操作，不依赖键盘，不做桌面端专用操控。 |
| 彻底解耦 | 标准模式的页面、组件、存储逻辑零改动；主题只通过契约拿题目、回写结果。删掉整个 `src/themes/` 目录，标准模式照常工作。 |
| 平级扩展 | 所有主题是注册表里平级的一项，没有分组、没有实验对照。首页自动列出注册表中的主题。 |
| 后端复用 | 题目解析、判分、错题本、进度存储沿用站点既有实现，主题不自己造一套数据层。 |

## 2. 分层

```
站点页面（首页 / 列表页 / 详情页 / 错题本）
        │  仅判断「当前是否有主题」
        ▼
宿主适配层（theme-host.ts / exam-quiz.ts / wrong-book.ts）
        │  组装 ThemeHost：题目、关卡、持久化回调
        ▼
主题契约（themes/index.ts）  ← 唯一的接缝
        │  attachTheme() 挂载全屏容器并加锁
        ▼
主题实现（themes/catch/*）  ← 每个主题自成一个目录
```

| 文件 | 职责 |
| --- | --- |
| `src/themes/index.ts` | 契约、注册表、主题状态、沉浸锁、挂载与销毁 |
| `src/lib/theme-host.ts` | 列表页 → 主题：把资料卡片变成关卡，按 URL 抓取并解析题目 |
| `src/lib/exam-quiz.ts` | 详情页 → 主题：有主题时直接进游戏，否则走原有 `createQuizPlayer()` |
| `src/lib/wrong-book.ts` | 错题重做 → 主题：有主题时进游戏，否则走原有组件 |
| `src/pages/index.astro` | 遍历注册表渲染主题入口卡片 |
| `src/pages/zsb/index.astro` | 列表页只有一行主题判断，其余全是原有逻辑 |
| `src/themes/catch/` | 当前主题「光舱接星」的全部实现 |
| `.research/` | 本地参考的开源游戏案例，已在 `.gitignore` 排除 |

## 3. 契约（唯一接缝）

```ts
export interface QuizTheme {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  create(ctx: ThemeContext): () => void;   // 返回 dispose，用于清理
}

export interface ThemeContext {
  mount: HTMLElement;   // 全屏 .theme-root，主题只在这里渲染
  title: string;
  host: ThemeHost;
}

export interface ThemeHost {
  questions: QuizQuestion[];      // 可直接开玩的题目
  chapters: ThemeChapter[];       // 可选关卡列表，替代 questions 作为入口
  variants: ThemeVariant[];       // 可选题库变体，如「只练错题」
  notes?: string[];               // 非选择题材料，作为知识点奖励
  load?(href: string): Promise<QuizQuestion[]>;  // 切换关卡时取题
  onGrade(q, pick, correct): void;   // 必须回写：markSeen / saveWrong
  onFinish(correct, total): void;
  onClose(): void;                   // 必须 clearTheme() 并回到标准模式
}

export function currentTheme(): QuizTheme | null;
export function clearTheme(): void;
export function attachTheme(theme, title, host): ThemeBinding;  // Binding 只有 destroy()
export const themes: QuizTheme[];
```

**主题状态**：URL 的 `?theme=<id>` 优先，`?theme=none` 表示退出；否则读 `sessionStorage["zsb.theme.v1"]`。刷新页面仍留在主题世界，显式退出才清除。

**沉浸锁**：`attachTheme()` 在挂载任何异步资源之前，先同步注入一段 `<style>`，给 `<html>` 加 `theme-lock`：

```
html.theme-lock body > :not(.theme-root) { display: none !important; }
.theme-root { position: fixed; inset: 0; ... background: #05070f; }
```

这样站点的 header / 面包屑 / 首页从第一帧起就不可见，且主题 CSS 异步到达前已有深色底，不会白屏闪烁。`host.onClose` 被 `attachTheme` 包装：先 `destroy()` 移除容器与锁，再执行宿主的清理回调。

**关键约束**：主题不需要、也不应该知道页面 URL、localStorage、错题本结构、Astro 页面 ID。一切数据走 `host`。

## 4. 宿主接线（已就位，新增主题无需改动）

| 入口 | 行为 |
| --- | --- |
| 首页卡片 | `/zsb/?theme=<id>` → 列表页 `currentTheme()` 命中 → `openThemeIndex(theme)` 展示关卡 |
| 列表页 | `chapters` 取自 `.zsb-card`，`load(href)` 用 `fetch` + `DOMParser` 复用 `parseQuestions()` |
| 详情页 | `initQuiz()` 命中主题时构造 host 并 `attachTheme()` 后 `return`，不创建标准答题组件 |
| 错题本 | `startRedo()` 命中主题时用错题组 `questions` 进游戏；否则用 `createQuizPlayer()` |

`onGrade` 统一做 `markSeen(q.id, docId, correct)` 与 `saveWrong(...)`，因此主题里的每一次作答都会进错题本和进度统计，跟标准模式完全一致。

## 5. 当前主题：光舱接星（catch）

**玩法**：题干固定在上方，选项变成从顶部坠落的星体；手指左右拖动底部「光舱」去接正确答案。单选接一颗，多选要接齐所有正确项；接到干扰项或漏接掉一格生命，连击提高得分，宝箱星体掉落时给出一条知识点。生命耗尽或题目答完进入结算。

**为何这样设计**：借鉴了开源接物类小游戏（下落物体 + overlap 接取 + `Phaser.Scale.FIT` 适配）与触屏滑行游戏（`pointermove` 驱动 + DOM HUD 与游戏画布分离），把「点击选项」彻底换成「物理接取」，因此界面里没有任何旧答题表单元素，也不需要键盘。

| 模块 | 职责 |
| --- | --- |
| `catch.ts` | 状态机：菜单 / 关卡 / 暂停 / 结算、题目推进、计分连击、事件委托、触摸坐标映射 |
| `catch/engine.ts` | Phaser 3 场景：星空背景、光舱、坠落星体、接取判定、粒子与镜头反馈；只暴露 `drop / moveTo / pause / destroy` |
| `catch/audio.ts` | 浏览器内合成 WAV 音效（Howler.js），不依赖外部音频文件 |
| `catch/style.css` | 全屏视觉，全部限定在 `.theme-root` 作用域内，不污染站点样式 |

三者都在 `create()` 里**动态 import**，标准模式不会下载 Phaser（约 1.5 MB）与 Howler。`Field.moveTo()` 接收 0~1 的归一化横坐标，主题不需要知道画布内部尺寸。

## 6. 新增一个主题

只需要三步，**不要改站点任何页面**：

1. 新建 `src/themes/<id>/`，实现 `QuizTheme` 对象；`create(ctx)` 里渲染 `ctx.mount`，用 `ctx.host` 取题、判分回写。
2. 在 `src/themes/index.ts` 的 `themes` 数组里注册该对象。
3. 首页卡片、列表页关卡、详情页、错题本会自动出现新主题，无需其它接线。

最小骨架：

```ts
import type { QuizTheme } from './index';

export const myTheme: QuizTheme = {
  id: 'my',
  name: '主题名',
  tagline: '一句话玩法',
  accent: '#6c8cff',
  create(ctx) {
    const root = ctx.mount;
    let style: HTMLStyleElement | null = null;
    root.innerHTML = `<div class="my-hud"></div><div class="my-stage"></div>`;
    const onClick = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b?.dataset.act === 'exit') ctx.host.onClose();
    };
    root.addEventListener('click', onClick);
    void import('./my/style.css?inline').then((css) => {
      style = document.createElement('style');
      style.textContent = css.default;
      document.head.appendChild(style);
    });
    return () => { root.removeEventListener('click', onClick); style?.remove(); };
  },
};
```

接入题目时用 `ctx.host.questions` 或 `ctx.host.load?.(href)`；每答一题调用 `ctx.host.onGrade(q, pick, correct)`；结束调用 `ctx.host.onFinish(correct, total)`；退出调用 `ctx.host.onClose()`。

## 7. 编码约定

- **零注释、命名简洁、单一职责**，代码本身说明意图；不写分节横幅注释。
- 重资源（游戏引擎、音频、主题 CSS）一律动态导入，标准模式零负担。
- 只用 pointer / touch，不引入键盘快捷键；不复用 `.quiz-*`、`.wb-*` 等旧答题 DOM。
- 样式全部写在 `.theme-root` 作用域内；全局只由契约注入那一段锁屏样式。
- `dispose()` 必须清理定时器、事件监听、canvas / Phaser 实例和注入的 `<style>`，保证反复进出不泄漏。
- 主题代码不写站点业务判断；需要新能力时扩展 `ThemeHost`，而不是反过来读页面。
- `.research/` 仅供本地参考，不入库、不上传。

## 8. 验证口径

手机视口（390×844）实测需覆盖：进入后 `html.theme-lock` 生效且 `body` 下非 `.theme-root` 元素全部不可见；关卡载入出题；触摸拖动无报错；游戏循环能推进题号与生命；暂停 / 静音 / 退出正常；退出后 header 恢复、标准答题与错题本功能不受影响；全程无 JS 异常。`npm run build` 需通过 `astro check`、`astro build` 与 `verify-legacy`。
