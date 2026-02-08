import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en.json'
import es from '@/locales/es.json'

const savedLang = typeof window !== 'undefined'
  ? localStorage.getItem('llamenos-lang') || navigator.language.split('-')[0]
  : 'en'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  lng: ['en', 'es'].includes(savedLang) ? savedLang : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export function setLanguage(lang: string) {
  i18n.changeLanguage(lang)
  localStorage.setItem('llamenos-lang', lang)
}

export default i18n
