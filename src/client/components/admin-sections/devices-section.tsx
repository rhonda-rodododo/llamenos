import { DeviceBadge } from '@/components/device-badge'
import { Button } from '@/components/ui/button'
import { VerifyFingerprintModal } from '@/components/verify-fingerprint-modal'
import { request } from '@/lib/api/client'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { hexToBytes } from '@noble/hashes/utils.js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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

export function DevicesSection() {
  const { t } = useTranslation()
  const { currentHubId } = useConfig()
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [verifying, setVerifying] = useState<Device | null>(null)
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

  const handleVerify = async () => {
    if (!verifying || !currentHubId) return
    await request(`/hubs/${currentHubId}/devices/${verifying.id}/verify`, {
      method: 'POST',
      body: JSON.stringify({
        signedEntry: {
          /* Placeholder — real implementation needs audit chain signing */
        },
      }),
    })
    void queryClient.invalidateQueries({ queryKey: ['hub', currentHubId, 'devices'] })
    setVerifying(null)
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
                  onClick={() => setVerifying(d)}
                >
                  {t('device.verifyButton')}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {verifying ? (
        <VerifyFingerprintModal
          open
          targetDevicePubkey={hexToBytes(verifying.ed25519Pubkey)}
          onVerify={handleVerify}
          onCancel={() => setVerifying(null)}
        />
      ) : null}
    </div>
  )
}
