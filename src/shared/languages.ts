/**
 * Centralized language configuration for Llámenos.
 * Used by both frontend (i18n, UI) and backend (telephony, voice prompts).
 *
 * Languages selected: English + top 10 most spoken by US immigrant communities
 * (Census ACS data). All have Twilio TTS support.
 *
 * To add a new language:
 * 1. Add entry here with all fields
 * 2. Create src/client/locales/{code}.json with all translation keys
 * 3. Import and register it in src/client/lib/i18n.ts
 * 4. Add voice prompts in src/worker/telephony/twilio.ts
 */

export interface LanguageConfig {
  /** ISO 639-1 code (e.g. 'en', 'es', 'fr') */
  code: string
  /** Native language name (e.g. 'Español', 'Français') */
  label: string
  /** Short display code for UI buttons (e.g. 'EN', 'ES') */
  flag: string
  /** Twilio TwiML voice language code (e.g. 'en-US', 'es-MX') */
  twilioVoice: string
  /** Phone number prefixes for auto-detection (E.164 format) */
  phonePrefixes: string[]
}

export const LANGUAGES: LanguageConfig[] = [
  // --- Base ---
  {
    code: 'en',
    label: 'English',
    flag: 'EN',
    twilioVoice: 'en-US',
    phonePrefixes: ['+1', '+44', '+61', '+64'], // US/Canada, UK, Australia, NZ
  },
  // --- Top 10 US immigrant languages ---
  {
    code: 'es',
    label: 'Español',
    flag: 'ES',
    twilioVoice: 'es-MX',
    phonePrefixes: [
      '+52',  '+34',  '+54',  '+56',  '+57',  '+58',  '+51',  '+53',
      '+591', '+593', '+595', '+598', '+502', '+503', '+504', '+505',
      '+506', '+507', '+809', '+829', '+849',
    ],
  },
  {
    code: 'zh',
    label: '中文',
    flag: '中',
    twilioVoice: 'cmn-CN',
    phonePrefixes: [
      '+86',  // China
      '+886', // Taiwan
      '+852', // Hong Kong
      '+853', // Macau
    ],
  },
  {
    code: 'tl',
    label: 'Tagalog',
    flag: 'TL',
    twilioVoice: 'fil-PH',
    phonePrefixes: ['+63'], // Philippines
  },
  {
    code: 'vi',
    label: 'Tiếng Việt',
    flag: 'VI',
    twilioVoice: 'vi-VN',
    phonePrefixes: ['+84'], // Vietnam
  },
  {
    code: 'ar',
    label: 'العربية',
    flag: 'ع',
    twilioVoice: 'ar-XA',
    phonePrefixes: [
      '+20',  // Egypt
      '+212', // Morocco
      '+213', // Algeria
      '+216', // Tunisia
      '+218', // Libya
      '+249', // Sudan
      '+961', // Lebanon
      '+962', // Jordan
      '+963', // Syria
      '+964', // Iraq
      '+966', // Saudi Arabia
      '+967', // Yemen
      '+968', // Oman
      '+970', // Palestine
      '+971', // UAE
      '+973', // Bahrain
      '+974', // Qatar
    ],
  },
  {
    code: 'fr',
    label: 'Français',
    flag: 'FR',
    twilioVoice: 'fr-FR',
    phonePrefixes: [
      '+33',  // France
      '+32',  // Belgium
      '+225', // Côte d'Ivoire
      '+221', // Senegal
      '+243', // DR Congo
      '+237', // Cameroon
    ],
  },
  {
    code: 'ht',
    label: 'Kreyòl Ayisyen',
    flag: 'HT',
    twilioVoice: 'fr-FR', // Twilio doesn't support Haitian Creole; French is closest
    phonePrefixes: ['+509'], // Haiti
  },
  {
    code: 'ko',
    label: '한국어',
    flag: '한',
    twilioVoice: 'ko-KR',
    phonePrefixes: ['+82'], // South Korea
  },
  {
    code: 'ru',
    label: 'Русский',
    flag: 'RU',
    twilioVoice: 'ru-RU',
    phonePrefixes: [
      '+7',   // Russia & Kazakhstan
      '+380', // Ukraine (many speak Russian)
      '+375', // Belarus
    ],
  },
  {
    code: 'hi',
    label: 'हिन्दी',
    flag: 'हि',
    twilioVoice: 'hi-IN',
    phonePrefixes: ['+91'], // India
  },
  // --- Additional ---
  {
    code: 'pt',
    label: 'Português',
    flag: 'PT',
    twilioVoice: 'pt-BR',
    phonePrefixes: [
      '+55',  // Brazil
      '+351', // Portugal
      '+244', // Angola
      '+258', // Mozambique
    ],
  },
]

/** Map of code -> config for quick lookup */
export const LANGUAGE_MAP = Object.fromEntries(LANGUAGES.map(l => [l.code, l])) as Record<string, LanguageConfig>

/** All supported language codes */
export const LANGUAGE_CODES = LANGUAGES.map(l => l.code)

/** Default / fallback language */
export const DEFAULT_LANGUAGE = 'en'

/**
 * Detect caller language from phone number country code.
 * Longer prefixes are matched first for specificity.
 * Falls back to 'en' if no match.
 */
export function detectLanguageFromPhone(phone: string): string {
  // Build a flat list of [prefix, langCode] sorted by prefix length desc
  const prefixMap: Array<[string, string]> = []
  for (const lang of LANGUAGES) {
    for (const prefix of lang.phonePrefixes) {
      prefixMap.push([prefix, lang.code])
    }
  }
  prefixMap.sort((a, b) => b[0].length - a[0].length)

  for (const [prefix, code] of prefixMap) {
    if (phone.startsWith(prefix)) return code
  }
  return DEFAULT_LANGUAGE
}
