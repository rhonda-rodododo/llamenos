import { SectionBanner, SectionBody, SectionDescription } from '@/components/section-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDeletePasskey, usePasskeys, useRenamePasskey } from '@/lib/queries/security'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/security/passkeys')({
  component: PasskeysPage,
})

interface PasskeyRowData {
  id: string
  label: string
  transports: string[]
  backedUp: boolean
  createdAt: string
  lastUsedAt: string
}

function TransportBadges({ transports }: { transports: string[] }) {
  const { t } = useTranslation()
  const map: Record<string, string> = {
    usb: t('security.passkeys.transport.usb', 'USB'),
    internal: t('security.passkeys.transport.internal', 'Built-in'),
    hybrid: t('security.passkeys.transport.hybrid', 'Cross-device'),
    nfc: 'NFC',
    ble: 'Bluetooth',
    'smart-card': 'Smart card',
  }
  return (
    <span className="inline-flex gap-1">
      {transports.map((tr) => (
        <span
          key={tr}
          className="text-xs bg-muted px-2 py-0.5 rounded"
          data-testid={`transport-${tr}`}
        >
          {map[tr] ?? tr}
        </span>
      ))}
    </span>
  )
}

function PasskeyRow({
  cred,
  onRename,
  onDelete,
}: {
  cred: PasskeyRowData
  onRename: (id: string, label: string) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draftLabel, setDraftLabel] = useState(cred.label)

  return (
    <li
      className="flex items-center justify-between p-3 border rounded"
      data-testid={`passkey-row-${cred.id}`}
    >
      <div className="flex-1 min-w-0 mr-4">
        {editing ? (
          <div className="flex gap-2">
            <Input
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              data-testid="passkey-label-input"
            />
            <Button
              size="sm"
              onClick={() => {
                onRename(cred.id, draftLabel)
                setEditing(false)
              }}
              data-testid="save-rename"
            >
              {t('common.save', 'Save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
          </div>
        ) : (
          <>
            <div className="font-medium flex items-center gap-2">
              {cred.label || '(unnamed)'}
              {cred.backedUp && (
                <span className="text-xs text-green-600" data-testid="backup-indicator">
                  {t('security.passkeys.backedUp', 'Synced')}
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              <TransportBadges transports={cred.transports} />
              {' · '}
              {t('security.passkeys.createdAt', 'Added')}:{' '}
              {new Date(cred.createdAt).toLocaleDateString()}
              {' · '}
              {t('security.passkeys.lastUsedAt', 'Last used')}:{' '}
              {new Date(cred.lastUsedAt).toLocaleDateString()}
            </div>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraftLabel(cred.label)
              setEditing(true)
            }}
            data-testid={`rename-${cred.id}`}
          >
            {t('security.passkeys.rename', 'Rename')}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onDelete(cred.id)}
            data-testid={`delete-${cred.id}`}
          >
            {t('common.delete', 'Delete')}
          </Button>
        </div>
      )}
    </li>
  )
}

function PasskeysPage() {
  const { t } = useTranslation()
  const { data, isLoading } = usePasskeys()
  const rename = useRenamePasskey()
  const del = useDeletePasskey()

  if (isLoading) return <div>{t('common.loading', 'Loading...')}</div>
  if (!data) return null

  return (
    <SectionBody surface="user" data-testid="passkeys-page" className="min-h-[40px]">
      <SectionDescription surface="user">
        {t(
          'security.passkeys.description',
          'WebAuthn credentials that can sign you in. Add a backup to avoid lockout.'
        )}
      </SectionDescription>
      {data.warning && (
        <SectionBanner tone="warn" data-testid="passkey-warning">
          {data.warning}
        </SectionBanner>
      )}
      {data.credentials.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {t('security.passkeys.empty', 'No passkeys registered yet.')}
        </p>
      )}
      <ul className="space-y-2">
        {data.credentials.map((cred) => (
          <PasskeyRow
            key={cred.id}
            cred={cred}
            onRename={(id, label) => rename.mutate({ id, data: { label } })}
            onDelete={(id) => del.mutate(id)}
          />
        ))}
      </ul>
    </SectionBody>
  )
}
