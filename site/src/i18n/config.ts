export const languages = {
  en: { label: 'English', dir: 'ltr' as const },
  es: { label: 'Español', dir: 'ltr' as const },
  zh: { label: '中文', dir: 'ltr' as const },
  tl: { label: 'Tagalog', dir: 'ltr' as const },
  vi: { label: 'Tiếng Việt', dir: 'ltr' as const },
  ar: { label: 'العربية', dir: 'rtl' as const },
  fr: { label: 'Français', dir: 'ltr' as const },
  ht: { label: 'Kreyòl Ayisyen', dir: 'ltr' as const },
  ko: { label: '한국어', dir: 'ltr' as const },
  ru: { label: 'Русский', dir: 'ltr' as const },
  hi: { label: 'हिन्दी', dir: 'ltr' as const },
  pt: { label: 'Português', dir: 'ltr' as const },
  de: { label: 'Deutsch', dir: 'ltr' as const },
} as const;

export const defaultLang = 'en' as const;
export type Lang = keyof typeof languages;
export const locales = Object.keys(languages) as Lang[];
export const nonDefaultLocales = locales.filter(l => l !== defaultLang);
