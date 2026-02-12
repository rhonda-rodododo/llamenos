import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
  site: 'https://llamenos-hotline.com',
  i18n: {
    locales: ['en', 'es', 'zh', 'tl', 'vi', 'ar', 'fr', 'ht', 'ko', 'ru', 'hi', 'pt', 'de'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
