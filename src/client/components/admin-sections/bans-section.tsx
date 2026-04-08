import {
  SectionBody,
  SectionDescription,
  SectionField,
} from '@/components/admin-shell/section-layout'
import { isValidE164 } from '@/components/phone-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { BanEntry } from '@/lib/api'
import {
  useAddGlobalBan,
  useBulkAddGlobalBans,
  useGlobalBans,
  useRemoveGlobalBan,
} from '@/lib/queries/bans'
import { useToast } from '@/lib/toast'
import { Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Super-admin-only section for managing the GLOBAL (platform-wide) ban list.
 *
 * The `/bans` endpoint is mounted twice in src/server/app.ts:
 *   - on `authenticated` (no hubContext → `c.get('hubId')` is undefined → rows
 *     with `hub_id = 'global'`), and
 *   - on `hubScoped` (`c.get('hubId')` is the active hub → hub-scoped rows).
 *
 * This section talks exclusively to the un-prefixed `/bans` endpoint via the
 * `useGlobalBans` hooks, which bypass `hp()` and so ignore the active hub.
 * A dedicated `queryKeys.bans.globalList()` cache scope keeps these rows out
 * of the hub-scoped ban-list cache.
 *
 * Numbers banned here are blocked across ALL hubs at intake.
 */
export function BansSection() {
  const { t } = useTranslation()
  const { toast } = useToast()

  const { data: bans = [], isLoading } = useGlobalBans()
  const addBan = useAddGlobalBan()
  const bulkAddBans = useBulkAddGlobalBans()
  const removeBan = useRemoveGlobalBan()

  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BanEntry | null>(null)
  const [csvReason, setCsvReason] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleAddBan() {
    const trimmedPhone = phone.trim()
    const trimmedReason = reason.trim()
    if (!trimmedPhone) return
    if (!isValidE164(trimmedPhone)) {
      toast(
        t('bans.invalidPhone', {
          defaultValue: 'Invalid phone number. Use E.164 format (e.g. +12125551234).',
        }),
        'error'
      )
      return
    }
    addBan.mutate(
      { phone: trimmedPhone, reason: trimmedReason },
      {
        onSuccess: () => {
          setPhone('')
          setReason('')
          toast(t('bans.banned', { defaultValue: 'Number banned' }), 'success')
        },
        onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
      }
    )
  }

  function handleDelete() {
    if (!deleteTarget) return
    // deleteTarget.phone may be decrypted plaintext already — if decrypt-array
    // hasn't populated it (locked key store) the server returns empty string.
    const phoneToDelete = deleteTarget.phone
    if (!phoneToDelete) {
      toast(t('common.error', { defaultValue: 'Error' }), 'error')
      return
    }
    removeBan.mutate(phoneToDelete, {
      onSuccess: () => {
        setDeleteTarget(null)
        toast(t('bans.removed', { defaultValue: 'Ban removed' }), 'success')
      },
      onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
    })
  }

  async function handleCsvUpload() {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    const text = await file.text()
    // CSV: one E.164 phone per line. First column is the phone. Optional
    // header row starting with a non-"+" char is tolerated (and skipped).
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const phones = lines
      .map((line) => line.split(',')[0]?.trim() ?? '')
      .filter((p) => p?.startsWith('+'))
    if (phones.length === 0) {
      toast(
        t('bans.emptyCsv', {
          defaultValue: 'CSV contains no valid phone numbers (one E.164 number per line).',
        }),
        'error'
      )
      return
    }
    const invalid = phones.filter((p) => !isValidE164(p))
    if (invalid.length > 0) {
      toast(
        t('bans.invalidCsvPhone', {
          defaultValue: `Invalid phone in CSV: ${invalid[0]}`,
          phone: invalid[0],
        }),
        'error'
      )
      return
    }
    bulkAddBans.mutate(
      { phones, reason: csvReason.trim() || 'Bulk import' },
      {
        onSuccess: (res) => {
          if (fileInputRef.current) fileInputRef.current.value = ''
          setCsvReason('')
          toast(
            t('bans.bulkImported', {
              defaultValue: `Imported ${res.count} bans`,
              count: res.count,
            }),
            'success'
          )
        },
        onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
      }
    )
  }

  return (
    <SectionBody>
      <SectionDescription>
        {t('bans.description', {
          defaultValue: 'Block phone numbers from calling the hotline across all hubs.',
        })}
      </SectionDescription>

      {/* Create single ban */}
      <div className="space-y-4 rounded-md border border-border p-4">
        <h3 className="text-sm font-semibold">
          {t('bans.addTitle', { defaultValue: 'Ban a number' })}
        </h3>
        <SectionField
          label={t('bans.phone', { defaultValue: 'Phone number' })}
          htmlFor="admin-bans-add-phone"
          help={t('bans.phoneHelp', {
            defaultValue: 'E.164 format, e.g. +12125551234',
          })}
        >
          <Input
            id="admin-bans-add-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+12125551234"
            data-testid="admin-bans-add-phone-input"
          />
        </SectionField>
        <SectionField
          label={t('bans.reason', { defaultValue: 'Reason' })}
          htmlFor="admin-bans-add-reason"
        >
          <Input
            id="admin-bans-add-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('bans.reasonPlaceholder', {
              defaultValue: 'e.g. Repeated spam',
            })}
            data-testid="admin-bans-add-reason-input"
          />
        </SectionField>
        <div className="flex items-center gap-3">
          <Button
            onClick={handleAddBan}
            disabled={addBan.isPending || !phone.trim()}
            data-testid="admin-bans-add-button"
          >
            {addBan.isPending
              ? t('common.loading', { defaultValue: 'Loading...' })
              : t('bans.addButton', { defaultValue: 'Ban number' })}
          </Button>
        </div>
      </div>

      {/* Bulk CSV upload */}
      <div className="space-y-3 rounded-md border border-border p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Upload className="h-4 w-4 text-muted-foreground" />
          {t('bans.bulkTitle', { defaultValue: 'Bulk import (CSV)' })}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('bans.bulkHelp', {
            defaultValue: 'One E.164 phone number per line (first column if comma-separated).',
          })}
        </p>
        <div className="space-y-2">
          <Label htmlFor="admin-bans-bulk-file">
            {t('bans.bulkFile', { defaultValue: 'CSV file' })}
          </Label>
          <Input
            id="admin-bans-bulk-file"
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            data-testid="admin-bans-bulk-upload-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="admin-bans-bulk-reason">
            {t('bans.reason', { defaultValue: 'Reason' })}
          </Label>
          <Input
            id="admin-bans-bulk-reason"
            value={csvReason}
            onChange={(e) => setCsvReason(e.target.value)}
            placeholder={t('bans.bulkReasonPlaceholder', {
              defaultValue: 'Applied to all imported numbers',
            })}
            data-testid="admin-bans-bulk-reason-input"
          />
        </div>
        <Button
          variant="outline"
          onClick={handleCsvUpload}
          disabled={bulkAddBans.isPending}
          data-testid="admin-bans-bulk-submit"
        >
          {bulkAddBans.isPending
            ? t('common.loading', { defaultValue: 'Loading...' })
            : t('bans.bulkSubmit', { defaultValue: 'Import bans' })}
        </Button>
      </div>

      {/* Existing bans table */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">
          {t('bans.listTitle', { defaultValue: 'Active bans' })}
        </h3>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">
            {t('common.loading', { defaultValue: 'Loading...' })}
          </div>
        ) : bans.length === 0 ? (
          <div
            className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
            data-testid="admin-bans-empty"
          >
            {t('bans.empty', { defaultValue: 'No global bans yet.' })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm" data-testid="admin-bans-table">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2">
                    {t('bans.columns.phone', { defaultValue: 'Phone' })}
                  </th>
                  <th className="px-4 py-2">
                    {t('bans.columns.reason', { defaultValue: 'Reason' })}
                  </th>
                  <th className="px-4 py-2">
                    {t('bans.columns.bannedAt', { defaultValue: 'Banned at' })}
                  </th>
                  <th className="px-4 py-2 text-right">
                    {t('bans.columns.actions', { defaultValue: 'Actions' })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {bans.map((ban, idx) => {
                  const displayPhone = ban.phone || '—'
                  const displayReason = ban.reason || '—'
                  const displayDate = ban.bannedAt ? new Date(ban.bannedAt).toLocaleString() : '—'
                  // Stable row key: prefer the ciphertext (unique per ban even
                  // when the key store is locked and plaintext decrypts to the
                  // server placeholder), then raw phone, then position.
                  const rowKey = ban.encryptedPhone || ban.phone || `idx-${idx}`
                  return (
                    <tr
                      key={rowKey}
                      data-testid={`admin-bans-row-${displayPhone}`}
                      className="border-t border-border"
                    >
                      <td className="px-4 py-3 font-mono">{displayPhone}</td>
                      <td className="px-4 py-3 text-muted-foreground">{displayReason}</td>
                      <td className="px-4 py-3 text-muted-foreground">{displayDate}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(ban)}
                            data-testid={`admin-bans-delete-${displayPhone}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            <span className="sr-only">
                              {t('common.delete', { defaultValue: 'Delete' })}
                            </span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('bans.deleteTitle', { defaultValue: 'Remove ban' })}</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? t('bans.deleteConfirm', {
                    defaultValue: `Unblock ${deleteTarget.phone}? They will be able to call again.`,
                    phone: deleteTarget.phone,
                  })
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={removeBan.isPending}
              data-testid="admin-bans-cancel-delete"
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={removeBan.isPending}
              data-testid="admin-bans-confirm-delete"
            >
              {removeBan.isPending
                ? t('common.loading', { defaultValue: 'Loading...' })
                : t('common.delete', { defaultValue: 'Remove' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionBody>
  )
}
