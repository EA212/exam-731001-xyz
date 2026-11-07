# Astro 模板

这是一个 [Astro](https://astro.build) 项目，展示了各种 Astro 特性和功能。此模板展示了服务器端渲染、API 路由、内容集合、框架集成等功能。

## 📚 功能演示

本项目包含多个示例页面，展示了不同的 Astro 功能：

### 页面

- **`/`** - 首页，包含基础 Astro 组件和布局
- **`/components`** - 多框架集成示例，使用 React、Vue 和 Svelte 组件
- **`/inter`** - 交互式页面，包含 API 路由和服务器端数据获取
- **`/md`** - 使用 Astro 内容集合的 Markdown 内容示例
- **`/mdx`** - 结合 Markdown 和 JSX 组件的 MDX 内容示例
- **`/static`** - 使用预渲染的静态页面生成示例

### 核心特性

- ✨ **多框架支持** - React、Vue 和 Svelte 集成
- 🔄 **服务器端渲染** - 使用 EdgeOne Pages 适配器
- 📝 **内容集合** - Markdown 和 MDX 内容管理
- 🛣️ **API 路由** - 用于数据获取的服务器端点
- 🎨 **组件岛屿** - 使用 `client:*` 指令的客户端交互
- 📦 **内容集合** - 类型安全的内容管理

## 🧞 命令

所有命令都需要在项目根目录，通过终端运行：

| 命令              | 操作                                   |
| :---------------- | :------------------------------------- |
| `npm install`     | 安装依赖                               |
| `npm run dev`     | 在 `localhost:4321` 启动本地开发服务器 |
| `npm run build`   | 构建你的生产站点到 `./dist/`           |
| `npm run preview` | 在部署之前本地预览构建结果             |

Astro 会在 `src/pages/` 目录中寻找 `.astro` 或 `.md` 文件。每个页面根据其文件名被暴露为一个路由。

`src/components/` 并没有什么特别之处，但我们喜欢把任何 Astro/React/Vue/Svelte/Preact 组件放在这里。

任何静态资产，比如图像，可以放在 `public/` 目录中。

## 🛠️ 使用的技术

- [Astro](https://astro.build) - 面向内容驱动网站的网络框架
- [React](https://react.dev) - UI 库
- [Vue](https://vuejs.org) - 渐进式 JavaScript 框架
- [Svelte](https://svelte.dev) - 组件框架
- [MDX](https://mdxjs.com) - 带 JSX 的 Markdown
- [TypeScript](https://www.typescriptlang.org) - 类型化 JavaScript
- [EdgeOne Pages](https://edgeone.ai/pages) - 部署平台

## 📖 了解更多

- [Astro 文档](https://docs.astro.build)
- [Astro Discord](https://astro.build/chat)
- [Astro 集成指南](https://docs.astro.build/en/guides/integrations-guide/)

## 部署

一键部署此项目到 EdgeOne Pages：

[![Deploy with EdgeOne Pages](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?from=github&template=astro-template)

更多模板: [EdgeOne Pages 模板](https://edgeone.ai/pages/templates)

## 适老化 / 旧浏览器基础版 与 RSS 订阅

按根目录 `PROMPT-zsb-tiku.md` 第七节（政务网站硬性建设规范）落地。`npm run build` 时由 `postbuild` 自动生成，无需人工操作；主站与基础版**共用同一份 `src/content/专升本/**` 内容源**。

### 产物

| 路径 | 说明 |
| --- | --- |
| `/l/` | 适老化 / IE9 / Android 4.0 WebView 基础版：51 份资料全文 + 科目/类别静态索引 + RSS 说明页，答案默认展开，零 JS 可完整阅读 |
| `/l/legacy.css` | 编译后的扁平化样式（CSS 变量已展开为静态值） |
| `/l/enhance.js` | ES5 渐进增强脚本（字号切换 + 偏好继承），普通 `defer` script，非 module |
| `/rss.xml` | 全站 RSS 2.0 源（51 条） |
| `/rss/subject-*.xml`、`/rss/category-*.xml` | 按科目 / 类别的栏目级订阅源（共 8 个） |
| `/l/rss.xml`、`/l/rss/*.xml` | 同样内容的副本，供离线包自包含 |

主站每页右上角有固定「长者版」入口，`<head>` 含 RSS 自动发现链接；基础版每页有「返回正常版」与订阅说明。

### 命令

| 命令 | 操作 |
| --- | --- |
| `npm run build` | 主站构建 + 自动生成降级页与 RSS + 校验门禁 |
| `npm run build:legacy` | 只重新生成降级页与 RSS |
| `npm run verify:legacy` | 只跑校验门禁（违规则构建失败） |
| `npm run check:es5` | 单独校验增强脚本的 ES5 语法 |

部署时请设置真实域名，否则 RSS 里的绝对链接是占位值 `https://example.com`：

```bash
SITE_URL=https://your.domain npm run build
```

### 校验门禁

`scripts/verify-legacy.mjs` 把 `PROMPT-zsb-tiku.md` 7.7 的验收清单代码化：断言产物中无 `type="module"`、`var(--`、grid、flex、`gap`、`clamp()`、`:is()`、`<details>`、`hidden`；校验 ES5、RSS XML 合法性与必填字段、`pubDate` 格式、`guid` 唯一、item 数与内容一致、link 指向真实预渲染页、分类字典与 `taxonomy.ts` 一致。任何一项失败都会让构建失败。

### 范围与未实现项（如实标注）

- **B 档只承诺**「看得清、点得开、看得到答案」；答题判分、错题本、导入导出不提供，请返回主站。
- **未实现**：语音朗读（政务评测要求正文页至少实现）、邮件订阅（因此无退订流程）。二者未假装完成。
- **偏好继承**以固定 URL + cookie 实现（字号选择），不做 UA 嗅探。
- **TLS 边界**：Win7 上 IE9 默认不启用 TLS 1.2、Android < 7.1.1 不信任 ISRG Root X1，公网 HTTPS 可能在握手阶段失败。基础版的现实交付方式是内网 HTTP 或离线 HTML 包。
- **政务专属项**（党政机关标识、ICP 备案、「我为政府网站找错」入口、IPv6 改造）本项目不是政务站，未套用。
