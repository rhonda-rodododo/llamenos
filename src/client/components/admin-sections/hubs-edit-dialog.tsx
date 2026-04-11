import { PhoneInput } from '@/components/phone-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { type Hub, type HubExportCategory, exportHubData } from '@/lib/api'
import { encryptHubField } from '@/lib/hub-field-crypto'
import type { useArchiveHub, useDeleteHub, useUpdateHub } from '@/lib/queries/hubs'
import type { useToast } from '@/lib/toast'
import { Archive, Download, Shield, ShieldOff, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const EXPORT_CATEGORIES: { key: HubExportCategory; labelKey: string }[] = [
  { key: 'notes', labelKey: 'hub.export.categories.notes' },
  { key: 'calls', labelKey: 'hub.export.categories.calls' },
  { key: 'conversations', labelKey: 'hub.export.categories.conversations' },
  { key: 'audit', labelKey: 'hub.export.categories.audit' },
  { key: 'voicemails', labelKey: 'hub.export.categories.voicemails' },
  { key: 'attachments', labelKey: 'hub.export.categories.attachments' },
]

interface HubsEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hub: Hub
  isSuperAdmin: boolean
  updateHub: ReturnType<typeof useUpdateHub>
  archiveHub: ReturnType<typeof useArchiveHub>
  deleteHub: ReturnType<typeof useDeleteHub>
  onUpdated: () => void
  toast: ReturnType<typeof useToast>['toast']
}

export function HubsEditDialog({
  open,
  onOpenChange,
  hub,
  isSuperAdmin,
  updateHub,
  archiveHub,
  deleteHub,
  onUpdated,
  toast,
}: HubsEditDialogProps) {
  const { t } = useTranslation()

  const [name, setName] = useState(hub.name || '')
  const [description, setDescription] = useState(hub.description || '')
  const [phoneNumber, setPhoneNumber] = useState(hub.phoneNumber || '')
  const [showAccessConfirm, setShowAccessConfirm] = useState<'enable' | 'disable' | null>(null)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Reset form state when hub changes
  useEffect(() => {
    setName(hub.name || '')
    setDescription(hub.description || '')
    setPhoneNumber(hub.phoneNumber || '')
  }, [hub])

  function handleSaveGeneral(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const trimmedName = name.trim()
    const trimmedDesc = description.trim()
    updateHub.mutate(
      {
        id: hub.id,
        data: {
          name: trimmedName,
          description: trimmedDesc || undefined,
          phoneNumber: phoneNumber.trim() || undefined,
          encryptedName: encryptHubField(trimmedName, hub.id, hub.id, 'encrypted_name'),
          encryptedDescription: trimmedDesc
            ? encryptHubField(trimmedDesc, hub.id, hub.id, 'encrypted_description')
            : undefined,
        },
      },
      {
        onSuccess: () => {
          onUpdated()
          toast(t('hubs.hubUpdated'), 'success')
        },
        onError: () => toast(t('common.error'), 'error'),
      }
    )
  }

  function handleAccessToggleRequest() {
    setShowAccessConfirm(hub.allowSuperAdminAccess ? 'disable' : 'enable')
  }

  function handleAccessToggleConfirm() {
    const newValue = showAccessConfirm === 'enable'
    updateHub.mutate(
      { id: hub.id, data: { allowSuperAdminAccess: newValue } },
      {
        onSuccess: () => {
          toast(t('hubs.hubUpdated'), 'success')
          setShowAccessConfirm(null)
        },
        onError: () => {
          toast(t('common.error'), 'error')
          setShowAccessConfirm(null)
        },
      }
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('hubs.editHub')}</DialogTitle>
            <DialogDescription>{t('hubs.editHubDescription')}</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="general" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="general" data-testid="admin-hubs-edit-dialog-tab-general">
                {t('hubs.tabs.general')}
              </TabsTrigger>
              <TabsTrigger value="access" data-testid="admin-hubs-edit-dialog-tab-access">
                {t('hubs.tabs.access')}
              </TabsTrigger>
              <TabsTrigger value="export" data-testid="admin-hubs-edit-dialog-tab-export">
                {t('hubs.tabs.export')}
              </TabsTrigger>
              <TabsTrigger value="danger" data-testid="admin-hubs-edit-dialog-tab-danger">
                {t('hubs.tabs.danger')}
              </TabsTrigger>
            </TabsList>

            {/* General tab */}
            <TabsContent value="general" className="mt-4">
              <form onSubmit={handleSaveGeneral} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-hub-name">{t('hubs.hubName')}</Label>
                  <Input
                    id="edit-hub-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-hub-description">{t('hubs.hubDescription')}</Label>
                  <Textarea
                    id="edit-hub-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-hub-phone">{t('hubs.hubPhoneNumber')}</Label>
                  <PhoneInput id="edit-hub-phone" value={phoneNumber} onChange={setPhoneNumber} />
                  <p className="text-xs text-muted-foreground">{t('hubs.hubPhoneNumberHelp')}</p>
                </div>
                <div className="space-y-2">
                  <Label>{t('common.status')}</Label>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        hub.status === 'active'
                          ? 'border-green-500/50 text-green-700 dark:text-green-400'
                          : hub.status === 'suspended'
                            ? 'border-yellow-500/50 text-yellow-700 dark:text-yellow-400'
                            : 'border-red-500/50 text-red-700 dark:text-red-400'
                      }
                    >
                      {t(`hubs.status.${hub.status}`)}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">{hub.id}</span>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={updateHub.isPending}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button type="submit" disabled={updateHub.isPending || !name.trim()}>
                    {updateHub.isPending ? t('common.loading') : t('common.save')}
                  </Button>
                </DialogFooter>
              </form>
            </TabsContent>

            {/* Access tab */}
            <TabsContent value="access" className="mt-4">
              <div className="space-y-3 rounded-lg border p-4" data-testid="hub-access-control">
                <div className="flex items-center gap-2">
                  {hub.allowSuperAdminAccess ? (
                    <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <ShieldOff className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                  )}
                  <Label className="text-sm font-semibold">{t('hubs.accessControl.title')}</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('hubs.accessControl.description')}
                </p>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="access-toggle" className="text-sm">
                    {t('hubs.accessControl.allowSuperAdmin')}
                  </Label>
                  {isSuperAdmin ? (
                    <Badge
                      variant="outline"
                      className={
                        hub.allowSuperAdminAccess
                          ? 'border-blue-500/50 text-blue-700 dark:text-blue-400'
                          : 'border-orange-500/50 text-orange-700 dark:text-orange-400'
                      }
                    >
                      {hub.allowSuperAdminAccess
                        ? t('hubs.accessControl.enabled')
                        : t('hubs.accessControl.restricted')}
                    </Badge>
                  ) : (
                    <Switch
                      id="access-toggle"
                      checked={hub.allowSuperAdminAccess ?? false}
                      onCheckedChange={handleAccessToggleRequest}
                      data-testid="hub-access-toggle"
                    />
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Export tab */}
            <TabsContent value="export" className="mt-4">
              <ExportPanel hub={hub} toast={toast} />
            </TabsContent>

            {/* Danger tab */}
            <TabsContent value="danger" className="mt-4">
              <div className="space-y-4">
                {hub.status !== 'archived' && (
                  <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <div className="flex items-center gap-2">
                      <Archive className="h-4 w-4 text-destructive" />
                      <Label className="text-sm font-semibold">{t('hubs.archiveHub')}</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('hubs.archiveHubConfirm', { name: hub.name })}
                    </p>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowArchiveConfirm(true)}
                      data-testid="admin-hubs-danger-archive-button"
                    >
                      <Archive className="mr-2 h-3 w-3" />
                      {t('hubs.archive')}
                    </Button>
                  </div>
                )}
                {hub.status === 'archived' && (
                  <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <div className="flex items-center gap-2">
                      <Trash2 className="h-4 w-4 text-destructive" />
                      <Label className="text-sm font-semibold">{t('hubs.deleteHub')}</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('hubs.deleteHubConfirm', { name: hub.name })}
                    </p>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(true)}
                      data-testid="admin-hubs-danger-delete-button"
                    >
                      <Trash2 className="mr-2 h-3 w-3" />
                      {t('hubs.delete')}
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Access control confirmation dialog */}
      <Dialog
        open={showAccessConfirm !== null}
        onOpenChange={(v) => {
          if (!v) setShowAccessConfirm(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('hubs.accessControl.title')}</DialogTitle>
            <DialogDescription>
              {showAccessConfirm === 'enable'
                ? t('hubs.accessControl.enableConfirm')
                : t('hubs.accessControl.disableConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAccessConfirm(null)}
              disabled={updateHub.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant={showAccessConfirm === 'disable' ? 'destructive' : 'default'}
              onClick={handleAccessToggleConfirm}
              disabled={updateHub.isPending}
              data-testid="hub-access-confirm-btn"
            >
              {updateHub.isPending ? t('common.loading') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation dialog */}
      <Dialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('hubs.archiveHub')}</DialogTitle>
            <DialogDescription>{t('hubs.archiveHubConfirm', { name: hub.name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowArchiveConfirm(false)}
              disabled={archiveHub.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                archiveHub.mutate(hub.id, {
                  onSuccess: () => {
                    setShowArchiveConfirm(false)
                    onOpenChange(false)
                    toast(t('hubs.hubArchived'), 'success')
                  },
                  onError: () => toast(t('common.error'), 'error'),
                })
              }}
              disabled={archiveHub.isPending}
            >
              {archiveHub.isPending ? t('common.loading') : t('hubs.archiveHub')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        hub={hub}
        deleteHub={deleteHub}
        onDeleted={() => {
          setShowDeleteConfirm(false)
          onOpenChange(false)
        }}
        toast={toast}
      />
    </>
  )
}

function ExportPanel({
  hub,
  toast,
}: {
  hub: Hub
  toast: ReturnType<typeof useToast>['toast']
}) {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
  const [selectedCategories, setSelectedCategories] = useState<Set<HubExportCategory>>(
    new Set(EXPORT_CATEGORIES.map((c) => c.key))
  )

  function toggleCategory(category: HubExportCategory) {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  async function handleExport() {
    if (selectedCategories.size === 0) return
    setExporting(true)
    try {
      const blob = await exportHubData(hub.id, [...selectedCategories])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `hub-${hub.id}-export.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4" data-testid="hub-export-section">
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4 text-primary" />
        <Label className="text-sm font-semibold">{t('hub.export.title')}</Label>
      </div>
      <p className="text-xs text-muted-foreground">{t('hub.export.description')}</p>
      <div className="space-y-2">
        <p className="text-xs font-medium">{t('hub.export.selectCategories')}</p>
        {EXPORT_CATEGORIES.map(({ key, labelKey }) => (
          <div key={key} className="flex items-center gap-2">
            <Checkbox
              id={`export-${key}`}
              checked={selectedCategories.has(key)}
              onCheckedChange={() => toggleCategory(key)}
              disabled={exporting}
              data-testid={`export-category-${key}`}
            />
            <Label htmlFor={`export-${key}`} className="text-sm">
              {t(labelKey)}
            </Label>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={exporting || selectedCategories.size === 0}
        data-testid="hub-export-download-btn"
      >
        <Download className="mr-1 h-3 w-3" />
        {exporting ? t('hub.export.downloading') : t('hub.export.download')}
      </Button>
    </div>
  )
}

function DeleteConfirmDialog({
  open,
  onOpenChange,
  hub,
  deleteHub,
  onDeleted,
  toast,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hub: Hub
  deleteHub: ReturnType<typeof useDeleteHub>
  onDeleted: () => void
  toast: ReturnType<typeof useToast>['toast']
}) {
  const { t } = useTranslation()
  const [confirmName, setConfirmName] = useState('')

  const canDelete = confirmName === hub.name

  function handleClose() {
    onOpenChange(false)
    setConfirmName('')
  }

  function handleConfirm() {
    if (!canDelete) return
    deleteHub.mutate(hub.id, {
      onSuccess: () => {
        onDeleted()
        setConfirmName('')
        toast(t('hubs.hubDeleted'), 'success')
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('active calls')) {
          toast(t('hubs.deleteHubActiveCallsError'), 'error')
        } else {
          toast(t('common.error'), 'error')
        }
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose()
        else onOpenChange(v)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('hubs.deleteHub')}</DialogTitle>
          <DialogDescription>{t('hubs.deleteHubConfirm', { name: hub.name })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="delete-hub-confirm">{t('hubs.deleteHubNameLabel')}</Label>
          <Input
            id="delete-hub-confirm"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={hub.name}
            data-testid="delete-hub-confirm-input"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={deleteHub.isPending}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleteHub.isPending || !canDelete}
            data-testid="delete-hub-confirm-btn"
          >
            {deleteHub.isPending ? t('common.loading') : t('hubs.deleteHub')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
