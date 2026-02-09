import { useRef, useState, useEffect, type KeyboardEvent } from 'react'

interface PinInputProps {
  length?: number
  value: string
  onChange: (value: string) => void
  onComplete?: (value: string) => void
  disabled?: boolean
  error?: boolean
  autoFocus?: boolean
}

export function PinInput({
  length = 4,
  value,
  onChange,
  onComplete,
  disabled = false,
  error = false,
  autoFocus = true,
}: PinInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.split('').concat(Array(length).fill('')).slice(0, length)

  useEffect(() => {
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0].focus()
    }
  }, [autoFocus])

  function handleInput(index: number, char: string) {
    if (!/^\d$/.test(char)) return
    const newDigits = [...digits]
    newDigits[index] = char
    const newValue = newDigits.join('').replace(/[^\d]/g, '')
    onChange(newValue)

    if (index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
    if (newValue.length === length) {
      onComplete?.(newValue)
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const newDigits = [...digits]
      if (newDigits[index]) {
        newDigits[index] = ''
        onChange(newDigits.join('').replace(/[^\d]/g, ''))
      } else if (index > 0) {
        newDigits[index - 1] = ''
        onChange(newDigits.join('').replace(/[^\d]/g, ''))
        inputRefs.current[index - 1]?.focus()
      }
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowRight' && index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    if (pasted) {
      onChange(pasted)
      const focusIndex = Math.min(pasted.length, length - 1)
      inputRefs.current[focusIndex]?.focus()
      if (pasted.length === length) {
        onComplete?.(pasted)
      }
    }
  }

  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={el => { inputRefs.current[i] = el }}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={digits[i] || ''}
          disabled={disabled}
          onInput={e => handleInput(i, (e.target as HTMLInputElement).value.slice(-1))}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={e => e.target.select()}
          className={`h-12 w-10 rounded-lg border text-center text-lg font-mono transition-colors focus:outline-none focus:ring-2 focus:ring-ring sm:h-14 sm:w-12 sm:text-xl ${
            error
              ? 'border-destructive bg-destructive/5 focus:ring-destructive/50'
              : 'border-input bg-background focus:border-primary'
          } ${disabled ? 'opacity-50' : ''}`}
          aria-label={`PIN digit ${i + 1}`}
        />
      ))}
    </div>
  )
}
