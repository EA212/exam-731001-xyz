import edgeoneAdapter from '@edgeone/astro';
import react from '@astrojs/react';
import vue from '@astrojs/vue';
import svelte from '@astrojs/svelte';
import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';
import remarkExam from './src/plugins/remark-exam.mjs';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: edgeoneAdapter(),
  integrations: [react(), vue(), svelte(), mdx()],
  markdown: {
    remarkPlugins: [remarkExam]
  },
  build: {
    // 全站仅一份站内本地 CSS（src/styles/site.css），无任何外部 CDN 依赖。
    // 默认外链：单个文件可被浏览器缓存，跨 51+ 个页面零重复下载，最省流量。
    // 若需「单个 HTML 完全自包含、零额外请求」（如离线单页分发），
    // 用 INLINE_CSS=1 pnpm build 切换为全量内联。
    inlineStylesheets: process.env.INLINE_CSS === '1' ? 'always' : 'never'
  }
});
