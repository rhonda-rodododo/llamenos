import { SectionBody, SectionDescription } from '@/components/user-shell/section-layout'
import { API_BASE } from '@/lib/api/client'
import { setAutoLockMs } from '@/lib/key-manager'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Prefs {
  autoLockMs: number
}

const MIN_MS = 60_000 // 1 minute
const MAX_MS = 3_600_000 // 60 minutes
const STEP_MS = 60_000 // 1 minute
const DEFAULT_MS = 900_000 // 15 minutes

export function IdleLockSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: prefs } = useQuery<Prefs>({
    queryKey: ['security', 'prefs'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/auth/security-prefs`, { credentials: 'include' })
      if (!res.ok) return { autoLockMs: DEFAULT_MS }
      return res.json()
    },
  })
  const [draft, setDraft] = useState(DEFAULT_MS)

  useEffect(() => {
    if (prefs) setDraft(prefs.autoLockMs)
  }, [prefs])

  const update = useMutation({
    mutationFn: async (ms: number) => {
      const res = await fetch(`${API_BASE}/auth/security-prefs`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoLockMs: ms }),
      })
      return res.json()
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['security', 'prefs'] })
      setAutoLockMs(variables)
    },
  })

  const format = (ms: number) => {
    const min = Math.round(ms / 60_000)
    if (min === 1) return t('security.autoLock.oneMinute', '1 min')
    return `${min} min`
  }

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">
        {t('security.autoLock.title', 'Auto-lock after inactivity')}
      </h3>
      <SectionBody data-testid="idle-lock-slider">
        <SectionDescription>
          {t(
            'security.autoLock.desc',
            'Lock the app after this long without activity. Applies whether the tab is visible or hidden.'
          )}
        </SectionDescription>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={MIN_MS}
            max={MAX_MS}
            step={STEP_MS}
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
