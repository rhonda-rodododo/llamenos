import { DeviceBadge } from '@/components/device-badge'
import { Button } from '@/components/ui/button'
import { VerifyFingerprintModal } from '@/components/verify-fingerprint-modal'
import { request } from '@/lib/api/client'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { hexToBytes } from '@noble/hashes/utils.js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Device {
  id: string
  userId: string
  label: string | null
  ed25519Pubkey: string
  verified: boolean
  createdAt: string
}

const HEX64_RE = /^[0-9a-f]{64}$/

export function DevicesSection() {
  const { t } = useTranslation()
  const { currentHubId } = useConfig()
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [verifying, setVerifying] = useState<Device | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const isAdmin =
    auth.roles.includes('role-admin') ||
    auth.roles.includes('role-super-admin') ||
    auth.roles.includes('admin') ||
    auth.roles.includes('super_admin')

  const { data: devices = [] } = useQuery({
    queryKey: ['hub', currentHubId, 'devices'],
    queryFn: async () => {
      if (!currentHubId) return []
      const res = await request<{ devices: Device[] }>(`/hubs/${currentHubId}/devices`)
      return res.devices
    },
    enabled: !!currentHubId,
  })

  const verifyMutation = useMutation({
    mutationFn: async (device: Device) => {
      if (!currentHubId) throw new Error('No hub context')
      // TODO(tier6-pr2): Implement actual audit chain signing.
      // This requires constructing a SignedAuditEntry with proper hash chain
      // linking and Schnorr signature. Currently throws to prevent silent failure.
      throw new Error('Device verification signing is not yet implemented — coming in Tier 6 PR #2')
      // When implemented, the call will be:
      // await request(`/hubs/${currentHubId}/devices/${device.id}/verify`, {
      //   method: 'POST',
      //   body: JSON.stringify({ signedEntry }),
      // })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', currentHubId, 'devices'] })
      setVerifying(null)
      setVerifyError(null)
    },
    onError: (err: Error) => {
      setVerifyError(err.message)
    },
  })

  const handleVerify = async () => {
    if (!verifying) return
    verifyMutation.mutate(verifying)
  }

  const handleStartVerify = (device: Device) => {
    if (!HEX64_RE.test(device.ed25519Pubkey)) {
      setVerifyError(t('device.invalidPubkey', 'Invalid device public key'))
      return
    }
    setVerifyError(null)
    setVerifying(device)
  }

  return (
    <div data-testid="devices-section">
      <h2 className="text-lg font-semibold mb-4">{t('adminNav.items.devices')}</h2>
      {devices.length === 0 ? (
        <p className="text-muted-foreground">{t('common.noData')}</p>
      ) : (
        <div className="space-y-2">
          {devices.map((d) => (
            <div
              key={d.id}
              data-testid={`device-row-${d.id}`}
              className="flex items-center gap-3 p-3 rounded-lg border"
            >
              <span className="flex-1 font-medium">{d.label || d.id.slice(0, 8)}</span>
              <DeviceBadge verified={d.verified} />
              {!d.verified && isAdmin ? (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`verify-device-${d.id}`}
                  onClick={() => handleStartVerify(d)}
                >
                  {t('device.verifyButton')}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {verifyError ? (
        <div
          data-testid="verify-error"
          className="mt-4 p-2 bg-destructive/10 text-destructive rounded"
          role="alert"
        >
          {verifyError}
        </div>
      ) : null}

      {verifying ? (
        <VerifyFingerprintModal
          open
          targetDevicePubkey={hexToBytes(verifying.ed25519Pubkey)}
          onVerify={handleVerify}
          onCancel={() => {
            setVerifying(null)
            setVerifyError(null)
          }}
        />
      ) : null}
    </div>
  )
}
