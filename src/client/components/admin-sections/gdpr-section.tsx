import { SectionBody, SectionDescription, SectionField } from '@/components/section-layout'
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
import {
  API_BASE,
  ApiError,
  fireApiActivity,
  fireAuthExpired,
  getAuthHeaders,
} from '@/lib/api/client'
import { useToast } from '@/lib/toast'
import { AlertTriangle, Download, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Admin-only GDPR erasure + data export section.
 *
 * Provides:
 *   - Force-erase a user account immediately (DELETE /gdpr/{targetPubkey})
 *   - Download a user's exported data (GET /gdpr/export/{targetPubkey})
 *
 * There is no server-side list endpoint for pending erasure requests, so this
 * section requires the admin to supply a target pubkey manually (e.g. from
 * the user management list or audit log).
 */
export function GdprAdminSection() {
  const { t } = useTranslation()
  const { toast } = useToast()

  const [targetPubkey, setTargetPubkey] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [erasing, setErasing] = useState(false)
  const [exporting, setExporting] = useState(false)

  async function handleAdminExport() {
    const pubkey = targetPubkey.trim()
    if (!pubkey) return
    setExporting(true)
    try {
      const headers = getAuthHeaders()
      const res = await fetch(`${API_BASE}/gdpr/export/${encodeURIComponent(pubkey)}`, { headers })
      if (!res.ok) {
        if (res.status === 401) fireAuthExpired()
        throw new ApiError(res.status, await res.text())
      }
      fireApiActivity()
      const blob = await res.blob()
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `llamenos-export-${pubkey.slice(0, 8)}-${date}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast(t('gdpr.admin.exportSuccess'), 'success')
    } catch {
      toast(t('gdpr.admin.exportError'), 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleAdminErase() {
    const pubkey = targetPubkey.trim()
    if (!pubkey) return
    setErasing(true)
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' }
      const res = await fetch(`${API_BASE}/gdpr/${encodeURIComponent(pubkey)}`, {
        method: 'DELETE',
        headers,
      })
      if (!res.ok) {
        if (res.status === 401) fireAuthExpired()
        throw new ApiError(res.status, await res.text())
      }
      fireApiActivity()
      toast(t('gdpr.admin.eraseSuccess'), 'success')
      setTargetPubkey('')
      setConfirmOpen(false)
    } catch {
      toast(t('gdpr.admin.eraseError'), 'error')
    } finally {
      setErasing(false)
    }
  }

  const isValidPubkey = targetPubkey.trim().length > 0

  return (
    <SectionBody>
      <SectionDescription>
        <p>{t('gdpr.admin.description')}</p>
      </SectionDescription>

      <SectionField label={t('gdpr.admin.pubkeyLabel')}>
        <div className="space-y-3">
          <Input
            value={targetPubkey}
            onChange={(e) => setTargetPubkey(e.target.value)}
            placeholder={t('gdpr.admin.pubkeyPlaceholder')}
            data-testid="gdpr-admin-pubkey-input"
          />

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAdminExport}
              disabled={!isValidPubkey || exporting}
              data-testid="gdpr-admin-export-button"
            >
              <Download className="mr-2 h-4 w-4" />
              {exporting ? t('gdpr.exportLoading') : t('gdpr.admin.exportButton')}
            </Button>

            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={!isValidPubkey || erasing}
              data-testid="gdpr-admin-erase-button"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('gdpr.admin.eraseButton')}
            </Button>
          </div>
        </div>
      </SectionField>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent data-testid="gdpr-admin-erase-confirm-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t('gdpr.admin.eraseConfirmTitle')}
            </DialogTitle>
            <DialogDescription>{t('gdpr.admin.eraseConfirmDescription')}</DialogDescription>
          </DialogHeader>

          <div className="rounded-md bg-muted px-3 py-2">
            <Label className="text-xs text-muted-foreground">{t('gdpr.admin.pubkeyLabel')}</Label>
            <p className="break-all font-mono text-xs mt-1">{targetPubkey.trim()}</p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              data-testid="gdpr-admin-erase-cancel"
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleAdminErase}
              disabled={erasing}
              data-testid="gdpr-admin-erase-confirm"
            >
              {t('gdpr.admin.eraseButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionBody>
  )
}
