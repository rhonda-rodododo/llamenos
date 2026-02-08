import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { LANGUAGE_CODES, DEFAULT_LANGUAGE } from '@shared/languages'
import en from '@/locales/en.json'
import es from '@/locales/es.json'
import zh from '@/locales/zh.json'
import tl from '@/locales/tl.json'
import vi from '@/locales/vi.json'
import ar from '@/locales/ar.json'
import fr from '@/locales/fr.json'
import ht from '@/locales/ht.json'
import ko from '@/locales/ko.json'
import ru from '@/locales/ru.json'
import hi from '@/locales/hi.json'
import pt from '@/locales/pt.json'
import de from '@/locales/de.json'

const resources: Record<string, { translation: Record<string, unknown> }> = {
  en: { translation: en },
  es: { translation: es },
  zh: { translation: zh },
  tl: { translation: tl },
  vi: { translation: vi },
  ar: { translation: ar },
  fr: { translation: fr },
  ht: { translation: ht },
  ko: { translation: ko },
  ru: { translation: ru },
  hi: { translation: hi },
  pt: { translation: pt },
  de: { translation: de },
}

const savedLang = typeof window !== 'undefined'
  ? localStorage.getItem('llamenos-lang') || navigator.language.split('-')[0]
  : DEFAULT_LANGUAGE

i18n.use(initReactI18next).init({
  resources,
  lng: LANGUAGE_CODES.includes(savedLang) ? savedLang : DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
})

export function setLanguage(lang: string) {
  i18n.changeLanguage(lang)
  localStorage.setItem('llamenos-lang', lang)
}

export default i18n
