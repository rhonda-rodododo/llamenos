import { defaultLang, languages, type Lang } from './config';

/** Extract the locale from a URL pathname */
export function getLangFromUrl(url: URL): Lang {
  const [, maybeLang] = url.pathname.split('/');
  if (maybeLang && maybeLang in languages) {
    return maybeLang as Lang;
  }
  return defaultLang;
}

/** Get the same path in a different locale */
export function getLocalizedPath(currentPath: string, targetLang: Lang): string {
  // Strip trailing slash for consistency
  const path = currentPath.replace(/\/$/, '') || '/';

  // Remove existing locale prefix
  const segments = path.split('/').filter(Boolean);
  const firstSegment = segments[0];
  let pathWithoutLocale: string;

  if (firstSegment && firstSegment in languages && firstSegment !== defaultLang) {
    pathWithoutLocale = '/' + segments.slice(1).join('/');
  } else {
    pathWithoutLocale = path;
  }

  if (targetLang === defaultLang) {
    return pathWithoutLocale || '/';
  }

  return `/${targetLang}${pathWithoutLocale}`;
}

/** Get a translation value, falling back to English */
export function getTranslation<T>(
  translations: Record<string, T>,
  lang: Lang,
): T {
  return translations[lang] ?? translations[defaultLang];
}
