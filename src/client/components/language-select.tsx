import { useTranslation } from 'react-i18next'
import { setLanguage } from '@/lib/i18n'
import { LANGUAGES, LANGUAGE_MAP } from '@shared/languages'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Globe } from 'lucide-react'

export function LanguageSelect({ size = 'default', fullWidth = false }: { size?: 'sm' | 'default'; fullWidth?: boolean }) {
  const { i18n, t } = useTranslation()
  const current = LANGUAGE_MAP[i18n.language]

  return (
    <Select value={i18n.language} onValueChange={setLanguage}>
      <SelectTrigger
        size={size}
        className={`gap-1.5 ${fullWidth ? 'w-full' : ''}`}
        aria-label={t('a11y.switchToLanguage', { language: current?.label ?? 'English' })}
      >
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue>
          {current ? `${current.flag} ${current.label}` : 'EN English'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {LANGUAGES.map(lang => (
          <SelectItem key={lang.code} value={lang.code}>
            <span className="font-medium">{lang.flag}</span> {lang.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
