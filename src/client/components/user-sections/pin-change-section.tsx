import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionActions, SectionBody, SectionField } from '@/components/section-layout'
import { Input } from '@/components/ui/input'
import { authFacadeClient } from '@/lib/auth-facade-client'
import { isUnlocked } from '@/lib/key-manager'
import { deriveKekProof, isValidPin, loadEncryptedKey, rewrapWithNewPin } from '@/lib/key-store'
import { useChangePin } from '@/lib/queries/security-actions'

export function PinChangeSection() {
  const { t } = useTranslation()
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const change = useChangePin()

  const submit = async () => {
    setError(null)
    setSuccess(false)
    if (newPin !== confirmPin) {
      setError(t('security.pin.mismatch', 'New PINs do not match'))
      return
    }
    if (!isValidPin(newPin)) {
      setError(t('security.pin.tooShort', 'PIN must be 6-8 digits'))
      return
    }
    const unlocked = await isUnlocked()
    if (!unlocked) {
      setError(t('security.pin.locked', 'Account is locked; unlock first'))
      return
    }
    const blob = loadEncryptedKey()
    if (!blob) {
      setError(t('security.pin.locked', 'Account is locked; unlock first'))
      return
    }
    try {
      const userInfo = await authFacadeClient.getUserInfo()
      if (!userInfo) {
        setError(t('security.pin.locked', 'Account is locked; unlock first'))
        return
      }
      const newCiphertext = await rewrapWithNewPin(newPin, { idpValue: userInfo.nsecSecret }, blob)
      const currentPinProof = deriveKekProof(currentPin)
      const newKekProof = deriveKekProof(newPin)
      await change.mutateAsync({
        currentPinProof,
        newKekProof,
        newEncryptedSecretKey: newCiphertext,
      })
      setSuccess(true)
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN change failed')
    }
  }

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">{t('security.pin.title', 'Change PIN')}</h3>
      <SectionBody surface="user" data-testid="pin-change-form">
        <SectionField label={t('security.pin.current', 'Current PIN')} htmlFor="pin-current">
          <Input
            id="pin-current"
            type="password"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
            data-testid="current-pin"
          />
        </SectionField>
        <SectionField label={t('security.pin.new', 'New PIN')} htmlFor="pin-new">
          <Input
            id="pin-new"
            type="password"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            data-testid="new-pin"
          />
        </SectionField>
        <SectionField label={t('security.pin.confirm', 'Confirm new PIN')} htmlFor="pin-confirm">
          <Input
            id="pin-confirm"
            type="password"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            data-testid="confirm-pin"
          />
        </SectionField>
        {error && (
          <p className="text-sm text-red-600" data-testid="pin-error">
            {error}
          </p>
        )}
        <SectionActions
          surface="user"
          slug="pin"
          saveButtonTestId="submit-pin"
          onSave={submit}
          saving={change.isPending}
          saveLabel={t('security.pin.save', 'Change PIN')}
        />
        {success && (
          <p className="text-sm text-green-600" data-testid="pin-success">
            {t('security.pin.success', 'PIN changed successfully')}
          </p>
        )}
      </SectionBody>
    </div>
  )
}
