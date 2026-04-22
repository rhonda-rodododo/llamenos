import { SectionBody, SectionDescription, SectionField } from '@/components/section-layout'
import { Badge } from '@/components/ui/badge'
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
import type { ErasureRequest } from '@/lib/api'
import {
  API_BASE,
  ApiError,
  fireApiActivity,
  fireAuthExpired,
  getAuthHeaders,
} from '@/lib/api/client'
import { useAdminEraseUser, useErasureRequests } from '@/lib/queries/gdpr'
import { useToast } from '@/lib/toast'
import { AlertTriangle, Clock, Download, Loader2, Trash2, UserX } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function GdprAdminSection() {
  const { t } = useTranslation()
  const { toast } = useToast()

  const [targetPubkey, setTargetPubkey] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState('')
  const [exporting, setExporting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<
    'pending' | 'cancelled' | 'executed' | undefined
  >(undefined)

  const { data: erasureRequests = [], isLoading: requestsLoading } =
    useErasureRequests(statusFilter)
  const adminEraseMutation = useAdminEraseUser()

  async function handleAdminExport(pubkey: string) {
    if (!pubkey.trim()) return
    setExporting(true)
    try {
      const headers = getAuthHeaders()
      const res = await fetch(`${API_BASE}/gdpr/export/${encodeURIComponent(pubkey.trim())}`, {
        headers,
      })
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
      a.download = `llamenos-export-${pubkey.trim().slice(0, 8)}-${date}.json`
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

  function handleEraseClick(pubkey: string) {
    setConfirmTarget(pubkey)
    setConfirmOpen(true)
  }

  function handleConfirmErase() {
    if (!confirmTarget.trim()) return
    adminEraseMutation.mutate(confirmTarget.trim(), {
      onSuccess: () => {
        toast(t('gdpr.admin.eraseSuccess'), 'success')
        setConfirmTarget('')
        setTargetPubkey('')
        setConfirmOpen(false)
      },
      onError: () => {
        toast(t('gdpr.admin.eraseError'), 'error')
      },
    })
  }

  const isValidPubkey = targetPubkey.trim().length > 0

  return (
    <SectionBody>
      <SectionDescription>
        <p>{t('gdpr.admin.description')}</p>
      </SectionDescription>

      {/* Manual pubkey actions */}
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
              onClick={() => handleAdminExport(targetPubkey)}
              disabled={!isValidPubkey || exporting}
              data-testid="gdpr-admin-export-button"
            >
              <Download className="mr-2 h-4 w-4" />
              {exporting ? t('gdpr.exportLoading') : t('gdpr.admin.exportButton')}
            </Button>

            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleEraseClick(targetPubkey)}
              disabled={!isValidPubkey}
              data-testid="gdpr-admin-erase-button"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('gdpr.admin.eraseButton')}
            </Button>
          </div>
        </div>
      </SectionField>

      {/* Erasure Requests Queue */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t('gdpr.admin.requestsTitle')}</h3>
          <div className="flex gap-1">
            {([undefined, 'pending', 'executed', 'cancelled'] as const).map((status) => (
              <Button
                key={status ?? 'all'}
                variant={statusFilter === status ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setStatusFilter(status)}
                data-testid={`gdpr-filter-${status ?? 'all'}`}
              >
                {t(`gdpr.admin.filter.${status ?? 'all'}`)}
              </Button>
            ))}
          </div>
        </div>

        {requestsLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : erasureRequests.length === 0 ? (
          <p
            className="text-sm text-muted-foreground py-4 text-center"
            data-testid="gdpr-requests-empty"
          >
            {t('gdpr.admin.noRequests')}
          </p>
        ) : (
          <div className="space-y-2" data-testid="gdpr-requests-list">
            {erasureRequests.map((req) => (
              <ErasureRequestCard
                key={req.pubkey}
                request={req}
                onExport={() => handleAdminExport(req.pubkey)}
                onErase={() => handleEraseClick(req.pubkey)}
                exporting={exporting}
              />
            ))}
          </div>
        )}
      </div>

      {/* Confirm Erase Dialog */}
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
            <p className="break-all font-mono text-xs mt-1">{confirmTarget}</p>
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
              onClick={handleConfirmErase}
              disabled={adminEraseMutation.isPending}
              data-testid="gdpr-admin-erase-confirm"
            >
              {adminEraseMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('gdpr.admin.eraseButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionBody>
  )
}

function ErasureRequestCard({
  request,
  onExport,
  onErase,
  exporting,
}: {
  request: ErasureRequest
  onExport: () => void
  onErase: () => void
  exporting: boolean
}) {
  const { t } = useTranslation()
  const isPending = request.status === 'pending'
  const hoursUntilErasure = isPending
    ? Math.max(0, Math.round((new Date(request.executeAt).getTime() - Date.now()) / 3_600_000))
    : 0

  return (
    <div
      className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
      data-testid="gdpr-request-row"
    >
      <div className="space-y-1 min-w-0 flex-1">
        <p className="font-mono text-xs break-all" data-testid="gdpr-request-pubkey">
          {request.pubkey.slice(0, 16)}...
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={request.status} />
          <span className="text-xs text-muted-foreground">
            {t('gdpr.admin.requestedAt', {
              date: new Date(request.requestedAt).toLocaleDateString(),
            })}
          </span>
          {isPending && hoursUntilErasure > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <Clock className="h-3 w-3" />
              {t('gdpr.admin.executesIn', { hours: hoursUntilErasure })}
            </span>
          )}
        </div>
      </div>
      {isPending && (
        <div className="flex gap-1 ml-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={onExport}
            disabled={exporting}
            data-testid="gdpr-request-export"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-7"
            onClick={onErase}
            data-testid="gdpr-request-erase"
          >
            <UserX className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: ErasureRequest['status'] }) {
  const { t } = useTranslation()
  const variants: Record<
    ErasureRequest['status'],
    { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }
  > = {
    pending: { variant: 'outline', className: 'text-amber-600 border-amber-500/30' },
    executed: { variant: 'outline', className: 'text-green-600 border-green-500/30' },
    cancelled: { variant: 'secondary' },
  }
  const config = variants[status]
  return (
    <Badge variant={config.variant} className={config.className} data-testid="gdpr-request-status">
      {t(`gdpr.admin.status.${status}`)}
    </Badge>
  )
}
