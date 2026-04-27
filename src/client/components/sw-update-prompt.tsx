import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  acceptSwUpdate,
  dismissSwUpdate,
  type SwUpdateState,
  subscribeSwUpdate,
} from '@/lib/sw-register'

export function SwUpdatePrompt() {
  const { t } = useTranslation()
  const [state, setState] = useState<SwUpdateState>({
    needRefresh: false,
    offlineReady: false,
    pendingVersion: null,
  })

  useEffect(() => {
    return subscribeSwUpdate(setState)
  }, [])

  if (!state.needRefresh && !state.offlineReady) return null

  return (
    <div
      data-testid="sw-update-prompt"
      role="alert"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg"
    >
      <p className="text-sm font-medium text-card-foreground" data-testid="sw-update-message">
        {state.needRefresh ? t('sw.updateAvailable') : t('sw.offlineReady')}
      </p>
      {state.needRefresh && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            data-testid="sw-update-accept"
            onClick={() => void acceptSwUpdate()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('sw.updateAction')}
          </button>
          <button
            type="button"
            data-testid="sw-update-dismiss"
            onClick={dismissSwUpdate}
            className="rounded-md border border-input px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            {t('sw.laterAction')}
          </button>
        </div>
      )}
    </div>
  )
}
