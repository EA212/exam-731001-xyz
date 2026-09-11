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
  }
});
