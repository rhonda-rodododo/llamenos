import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SAS_EMOJI_TABLE } from '@/lib/mls/emoji-table'
import { deriveSasEmoji, deriveSasNamesEn } from '@/lib/mls/sas'

interface VerifyFingerprintModalProps {
  open: boolean
  /** The verifier's own device pubkey (the admin/user doing the verification). */
  verifierDevicePubkey: Uint8Array
  /** The pubkey of the device being verified. */
  targetDevicePubkey: Uint8Array
  /**
   * A fresh per-session nonce that both parties agree on out-of-band. Binding
   * the SAS to this nonce prevents an attacker with knowledge of the two
   * pubkeys (which are public) from pre-computing the SAS a victim will see.
   */
  sessionNonce: Uint8Array
  onVerify: () => Promise<void>
  onCancel: () => void
}

export function VerifyFingerprintModal(props: VerifyFingerprintModalProps) {
  const { t } = useTranslation()
  const correctEmoji = useMemo(
    () => deriveSasEmoji(props.verifierDevicePubkey, props.targetDevicePubkey, props.sessionNonce),
    [props.verifierDevicePubkey, props.targetDevicePubkey, props.sessionNonce]
  )
  const correctNames = useMemo(
    () =>
      deriveSasNamesEn(props.verifierDevicePubkey, props.targetDevicePubkey, props.sessionNonce),
    [props.verifierDevicePubkey, props.targetDevicePubkey, props.sessionNonce]
  )
  const [picked, setPicked] = useState<string[]>([])
  const [verifying, setVerifying] = useState(false)

  const mismatch =
    picked.length > 0 && picked[picked.length - 1] !== correctEmoji[picked.length - 1]
  const complete = picked.length === 7 && !mismatch

  const reset = () => setPicked([])

  const handleVerify = async () => {
    setVerifying(true)
    try {
      await props.onVerify()
    } finally {
      setVerifying(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onCancel()}>
      <DialogContent data-testid="verify-fingerprint-modal">
        <DialogHeader>
          <DialogTitle>{t('verifyFingerprint.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('verifyFingerprint.instructions')}</p>

        <div className="grid grid-cols-7 gap-2 my-4">
          {correctEmoji.map((e, i) => (
            <div
              key={i}
              data-testid={`sas-emoji-${i}`}
              className="text-3xl text-center"
              role="img"
              aria-label={correctNames[i]}
            >
              {e}
            </div>
          ))}
        </div>

        <p className="text-sm font-medium">{t('verifyFingerprint.clickPrompt')}</p>
        <div className="grid grid-cols-8 gap-1" data-testid="sas-picker">
          {SAS_EMOJI_TABLE.map((e, idx) => (
            <button
              key={idx}
              type="button"
              data-testid={`sas-picker-${idx}`}
              onClick={() => setPicked((p) => [...p, e])}
              disabled={mismatch || complete}
              className="text-2xl p-1 border rounded hover:bg-accent disabled:opacity-50"
            >
              {e}
            </button>
          ))}
        </div>

        {mismatch ? (
          <div
            data-testid="sas-mismatch-warning"
            className="mt-4 p-2 bg-destructive/10 text-destructive rounded"
            role="alert"
          >
            {t('verifyFingerprint.mismatch')}
          </div>
        ) : null}

        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="ghost" onClick={reset} data-testid="sas-reset">
            {t('verifyFingerprint.reset')}
          </Button>
          <Button
            data-testid="sas-verify-confirm"
            disabled={!complete || verifying}
            onClick={handleVerify}
          >
            {t('verifyFingerprint.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
