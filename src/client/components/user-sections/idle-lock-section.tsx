import { SectionBody, SectionDescription } from '@/components/user-shell/section-layout'
import { setLockDelay } from '@/lib/key-manager'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Prefs {
  lockDelayMs: number
}

export function IdleLockSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: prefs } = useQuery<Prefs>({
    queryKey: ['security', 'prefs'],
    queryFn: async () => {
      const res = await fetch('/api/auth/security-prefs', { credentials: 'include' })
      if (!res.ok) return { lockDelayMs: 30_000 }
      return res.json()
    },
  })
  const [draft, setDraft] = useState(30_000)

  useEffect(() => {
    if (prefs) setDraft(prefs.lockDelayMs)
  }, [prefs])

  const update = useMutation({
    mutationFn: async (ms: number) => {
      const res = await fetch('/api/auth/security-prefs', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lockDelayMs: ms }),
      })
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security', 'prefs'] })
      setLockDelay(draft)
    },
  })

  const format = (ms: number) => {
    if (ms === 0) return t('security.lock.immediate', 'Immediate')
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m`
  }

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">{t('security.lock.title', 'Auto-lock delay')}</h3>
      <SectionBody data-testid="idle-lock-slider">
        <SectionDescription>
          {t('security.lock.desc', 'Lock the app after this long when the tab is hidden.')}
        </SectionDescription>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={600_000}
            step={10_000}
            value={draft}
            onChange={(e) => setDraft(Number(e.target.value))}
            onMouseUp={(e) => update.mutate(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => update.mutate(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => update.mutate(Number((e.target as HTMLInputElement).value))}
            className="flex-1"
            data-testid="lock-slider"
          />
          <span className="text-sm w-16 text-right" data-testid="lock-value">
            {format(draft)}
          </span>
        </div>
      </SectionBody>
    </div>
  )
}
