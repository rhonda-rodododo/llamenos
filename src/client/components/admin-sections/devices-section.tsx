import { DeviceBadge } from '@/components/device-badge'
import { Button } from '@/components/ui/button'
import { VerifyFingerprintModal } from '@/components/verify-fingerprint-modal'
import { request } from '@/lib/api/client'
import { buildSignedAuditEntry, fetchAuditHead } from '@/lib/audit-log-client'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { pubkeyToHex } from '@/lib/device-identity'
import { queryKeys } from '@/lib/queries/keys'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { DeviceVerificationSuccess } from '@shared/schemas/device-verification'
import type { Device, DeviceList } from '@shared/schemas/devices'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const HEX64_RE = /^[0-9a-f]{64}$/

export function DevicesSection() {
  const { t } = useTranslation()
  const { currentHubId } = useConfig()
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [verifying, setVerifying] = useState<Device | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  // Fresh per-session nonce for SAS derivation. A new one is generated every
  // time a verification session starts, binding the 7-emoji sequence to this
  // specific session so an attacker who knows both device pubkeys cannot
  // pre-compute the SAS a victim will see.
  const sessionNonce = useMemo(() => {
    if (!verifying) return null
    const n = new Uint8Array(32)
    crypto.getRandomValues(n)
    return n
  }, [verifying])
  const isAdmin =
    auth.roles.includes('role-admin') ||
    auth.roles.includes('role-super-admin') ||
    auth.roles.includes('admin') ||
    auth.roles.includes('super_admin')

  const { data: devices = [] } = useQuery({
    queryKey: queryKeys.devices.list(currentHubId ?? undefined),
    queryFn: async () => {
      if (!currentHubId) return []
      const res = await request<DeviceList>(`/hubs/${currentHubId}/devices`)
      return res.devices
    },
    enabled: !!currentHubId,
  })

  const verifyMutation = useMutation({
    mutationFn: async (device: Device) => {
      if (!currentHubId) throw new Error('No hub context')
      // The admin's own device keypair (Tier 3) must be provisioned — it
      // supplies both the `verifierDeviceId` recorded in the payload and the
      // `signerDeviceId` hex label that goes into the signed entry. If the
      // device identity hasn't been bootstrapped yet the user cannot produce
      // an audit-chain entry, so we fail fast with a translated error.
      if (!auth.deviceKeypair) {
        throw new Error(
          t(
            'device.verificationRequiresDeviceIdentity',
            'Cannot verify: this device has no provisioned identity keypair'
          )
        )
      }

      // Fetch the current chain head so the new entry links correctly. The
      // server re-checks this on append and rejects on mismatch, so a racy
      // read here just becomes a chain_conflict error surfaced via onError.
      const prevEntryHash = await fetchAuditHead(currentHubId)

      const signerDeviceIdHex = pubkeyToHex(auth.deviceKeypair.signing.publicKey)
      const signedEntry = await buildSignedAuditEntry({
        hubId: currentHubId,
        payload: {
          type: 'device_fingerprint_verified',
          hubId: currentHubId,
          verifiedDeviceId: device.id,
          verifiedDevicePubkey: device.ed25519Pubkey,
          verifierDeviceId: auth.deviceKeypair.deviceId,
        },
        prevEntryHash,
        signerDeviceId: signerDeviceIdHex,
      })

      // Submit through the dedicated device-verification endpoint rather than
      // the generic /audit POST — the dedicated route double-checks payload
      // type, hubId, and deviceId alignment before appending to the chain.
      return await request<DeviceVerificationSuccess>(
        `/hubs/${currentHubId}/devices/${device.id}/verify`,
        {
          method: 'POST',
          body: JSON.stringify({ signedEntry }),
        }
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.devices.list(currentHubId ?? undefined),
      })
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

      {verifying && sessionNonce ? (
        <VerifyFingerprintModal
          open
          // Use the verifying admin's own Ed25519 signing pubkey from the
          // persistent device identity (Tier 3). Falls back to a zero-byte
          // placeholder if the device keypair isn't provisioned yet on this
          // browser — the mutationFn itself rejects in that case, so the SAS
          // grid renders but any subsequent confirm is blocked with a clear
          // error instead of producing a malformed signed entry.
          verifierDevicePubkey={auth.deviceKeypair?.signing.publicKey ?? new Uint8Array(32)}
          targetDevicePubkey={hexToBytes(verifying.ed25519Pubkey)}
          sessionNonce={sessionNonce}
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
