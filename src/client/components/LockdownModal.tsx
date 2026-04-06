import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deriveKekProof } from '@/lib/key-store-v2'
import { useLockdown } from '@/lib/queries/security-actions'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type Tier = 'A' | 'B' | 'C'

const TIER_DESCRIPTIONS: Record<Tier, { titleKey: string; descKey: string; color: string }> = {
  A: {
    titleKey: 'security.lockdown.tierA.title',
    descKey: 'security.lockdown.tierA.desc',
    color: 'border-yellow-400',
  },
  B: {
    titleKey: 'security.lockdown.tierB.title',
    descKey: 'security.lockdown.tierB.desc',
    color: 'border-orange-400',
  },
  C: {
    titleKey: 'security.lockdown.tierC.title',
    descKey: 'security.lockdown.tierC.desc',
    color: 'border-red-500',
  },
}

export function LockdownModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [tier, setTier] = useState<Tier | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const lockdown = useLockdown()

  const submit = async () => {
    if (!tier) return
    if (confirmation !== 'LOCKDOWN') {
      setError(t('security.lockdown.typeWord', 'Type LOCKDOWN to confirm'))
      return
    }
    setError(null)
    try {
      const pinProof = deriveKekProof(pin)
      const result = await lockdown.mutateAsync({ tier, pinProof })
      onClose()
      if (result.accountDeactivated) {
        window.location.href = '/login'
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lockdown failed')
    }
  }

  const reset = () => {
    setTier(null)
    setConfirmation('')
    setPin('')
    setError(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-2xl" data-testid="lockdown-modal">
        <DialogHeader>
          <DialogTitle>{t('security.lockdown.title', 'Emergency lockdown')}</DialogTitle>
        </DialogHeader>
        {!tier ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t(
                'security.lockdown.intro',
                'Choose the scope of the lockdown. This cannot be undone.'
              )}
            </p>
            {(['A', 'B', 'C'] as Tier[]).map((x) => (
              <button
                type="button"
                key={x}
                onClick={() => setTier(x)}
                className={`w-full text-left p-4 rounded border-2 ${TIER_DESCRIPTIONS[x].color} hover:bg-muted`}
                data-testid={`tier-${x}`}
              >
                <div className="font-semibold">{t(TIER_DESCRIPTIONS[x].titleKey)}</div>
                <div className="text-sm text-muted-foreground">
                  {t(TIER_DESCRIPTIONS[x].descKey)}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className={`p-3 rounded border-2 ${TIER_DESCRIPTIONS[tier].color}`}>
              <div className="font-semibold">{t(TIER_DESCRIPTIONS[tier].titleKey)}</div>
              <div className="text-sm text-muted-foreground">
                {t(TIER_DESCRIPTIONS[tier].descKey)}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('security.lockdown.confirmLabel', 'Type LOCKDOWN to confirm')}</Label>
              <Input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                data-testid="confirmation-input"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('security.lockdown.pinLabel', 'Enter your PIN')}</Label>
              <Input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                data-testid="pin-input"
              />
            </div>
            {error && (
              <div className="text-sm text-red-600" data-testid="lockdown-error">
                {error}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setTier(null)}>
                {t('common.back', 'Back')}
              </Button>
              <Button
                variant="destructive"
                onClick={submit}
                disabled={lockdown.isPending || !confirmation || !pin}
                data-testid="submit-lockdown"
              >
                {lockdown.isPending
                  ? t('security.lockdown.locking', 'Locking…')
                  : t('security.lockdown.execute', 'Execute lockdown')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
