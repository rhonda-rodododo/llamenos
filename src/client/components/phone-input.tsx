import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const E164_REGEX = /^\+\d{7,15}$/
const PARTIAL_REGEX = /^\+?\d{0,15}$/

type ValidationState = 'empty' | 'partial' | 'valid' | 'invalid'

function getValidationState(value: string): ValidationState {
  if (!value || value === '+') return 'empty'
  if (E164_REGEX.test(value)) return 'valid'
  if (PARTIAL_REGEX.test(value) && value.length < 16) return 'partial'
  return 'invalid'
}

interface PhoneInputProps {
  value: string
  onChange: (value: string) => void
  id?: string
  placeholder?: string
  required?: boolean
  className?: string
}

export function PhoneInput({ value, onChange, id, placeholder, required, className }: PhoneInputProps) {
  const { t } = useTranslation()
  const [touched, setTouched] = useState(false)

  const validationState = getValidationState(value)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value
    // Strip non-digit characters except leading +
    raw = raw.replace(/[^\d+]/g, '')
    // Ensure only one + at the start
    if (raw.includes('+')) {
      raw = '+' + raw.replace(/\+/g, '')
    }
    // Auto-prepend + when user starts typing digits
    if (raw && !raw.startsWith('+')) {
      raw = '+' + raw
    }
    onChange(raw)
  }, [onChange])

  const borderClass = touched && validationState === 'valid'
    ? 'border-green-500 focus-visible:border-green-500 focus-visible:ring-green-500/50'
    : touched && validationState === 'invalid'
      ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/50'
      : ''

  return (
    <div className="space-y-1">
      <Input
        id={id}
        value={value}
        onChange={handleChange}
        onBlur={() => setTouched(true)}
        type="tel"
        placeholder={placeholder || '+12125551234'}
        required={required}
        className={cn(borderClass, className)}
      />
      {touched && validationState === 'valid' && (
        <p className="text-xs text-green-600 dark:text-green-400">{t('phone.valid')}</p>
      )}
      {touched && validationState === 'invalid' && (
        <p className="text-xs text-destructive">{t('phone.invalid')}</p>
      )}
      {!touched && value === '' && (
        <p className="text-xs text-muted-foreground">{t('phone.hint')}</p>
      )}
    </div>
  )
}

export function isValidE164(phone: string): boolean {
  return E164_REGEX.test(phone)
}
