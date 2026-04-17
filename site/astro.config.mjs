import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import pagefind from 'astro-pagefind';
import mermaid from 'astro-mermaid';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  output: 'static',
  integrations: [
    pagefind(),
    mermaid({
      // Dark theme for better readability on dark backgrounds
      theme: 'dark',
    }),
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en',
          es: 'es',
          zh: 'zh',
          tl: 'tl',
          vi: 'vi',
          ar: 'ar',
          fr: 'fr',
          ht: 'ht',
          ko: 'ko',
          ru: 'ru',
          hi: 'hi',
          pt: 'pt',
          de: 'de',
          uk: 'uk',
          fa: 'fa',
          tr: 'tr',
          ku: 'ku',
          so: 'so',
          am: 'am',
          my: 'my',
          quc: 'quc',
          mix: 'mix',
        },
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  site: 'https://llamenos-hotline.com',
  i18n: {
    locales: ['en', 'es', 'zh', 'tl', 'vi', 'ar', 'fr', 'ht', 'ko', 'ru', 'hi', 'pt', 'de', 'uk', 'fa', 'tr', 'ku', 'so', 'am', 'my', 'quc', 'mix'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
