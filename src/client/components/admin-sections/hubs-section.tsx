import { SectionBody, SectionDescription } from '@/components/admin-shell/section-layout'
import { PhoneInput } from '@/components/phone-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import type { Hub } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import {
  useArchiveHub,
  useCreateHub,
  useDeleteHub,
  useHubs,
  useUpdateHub,
} from '@/lib/queries/hubs'
import { useToast } from '@/lib/toast'
import { Building2, Pencil, Phone, Plus, Shield, ShieldOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HubsEditDialog } from './hubs-edit-dialog'

export function HubsSection() {
  const { t } = useTranslation()
  const auth = useAuth()
  const { hasPermission } = auth
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  const { toast } = useToast()
  const isSuperAdmin = auth.roles.includes('role-super-admin')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingHub, setEditingHub] = useState<Hub | null>(null)

  const { data: hubs = [], isLoading: loading } = useHubs(hubId)
  const createHub = useCreateHub()
  const updateHub = useUpdateHub()
  const deleteHub = useDeleteHub()
  const archiveHub = useArchiveHub()

  if (!hasPermission('system:manage-hubs')) {
    return (
      <SectionBody>
        <div className="text-muted-foreground">
          {t('hubs.accessDenied', { defaultValue: 'Access denied' })}
        </div>
      </SectionBody>
    )
  }

  return (
    <SectionBody>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionDescription>{t('hubs.title')}</SectionDescription>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="admin-hubs-create-button">
          <Plus className="h-4 w-4" />
          {t('hubs.createHub')}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-4">
                  <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                  <div className="ml-auto h-4 w-20 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : hubs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">{t('hubs.noHubs')}</div>
          ) : (
            <div className="divide-y divide-border">
              {hubs.map((hub) => (
                <HubRow
                  key={hub.id}
                  hub={hub}
                  isSuperAdmin={isSuperAdmin}
                  onEdit={() => setEditingHub(hub)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateHubDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        createHub={createHub}
        onCreated={() => setShowCreateDialog(false)}
        toast={toast}
      />

      {editingHub && (
        <HubsEditDialog
          open={!!editingHub}
          onOpenChange={(open) => {
            if (!open) setEditingHub(null)
          }}
          hub={editingHub}
          isSuperAdmin={isSuperAdmin}
          updateHub={updateHub}
          archiveHub={archiveHub}
          deleteHub={deleteHub}
          onUpdated={() => setEditingHub(null)}
          toast={toast}
        />
      )}
    </SectionBody>
  )
}

function HubRow({
  hub,
  isSuperAdmin,
  onEdit,
}: {
  hub: Hub
  isSuperAdmin: boolean
  onEdit: () => void
}) {
  const { t } = useTranslation()

  const statusColors: Record<Hub['status'], string> = {
    active: 'border-green-500/50 text-green-700 dark:text-green-400',
    suspended: 'border-yellow-500/50 text-yellow-700 dark:text-yellow-400',
    archived: 'border-red-500/50 text-red-700 dark:text-red-400',
  }

  return (
    <div
      data-testid="hub-row"
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
          <Building2 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {hub.name}
            <span className="ml-2 font-mono text-xs text-muted-foreground">{hub.id}</span>
          </p>
          {hub.encryptedDescription && (
            <p className="text-xs text-muted-foreground line-clamp-1">{hub.description}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {hub.phoneNumber && (
          <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
            <Phone className="h-3 w-3" />
            {hub.phoneNumber}
          </span>
        )}
        <Badge variant="outline" className={statusColors[hub.status]}>
          {t(`hubs.status.${hub.status}`)}
        </Badge>
        {isSuperAdmin && (
          <Badge
            variant="outline"
            className={
              hub.allowSuperAdminAccess
                ? 'border-blue-500/50 text-blue-700 dark:text-blue-400'
                : 'border-orange-500/50 text-orange-700 dark:text-orange-400'
            }
            data-testid="hub-access-badge"
          >
            {hub.allowSuperAdminAccess ? (
              <Shield className="mr-1 h-3 w-3" />
            ) : (
              <ShieldOff className="mr-1 h-3 w-3" />
            )}
            {hub.allowSuperAdminAccess
              ? t('hubs.accessControl.enabled')
              : t('hubs.accessControl.restricted')}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {new Date(hub.createdAt).toLocaleDateString()}
        </span>
        <Button
          variant="ghost"
          size="xs"
          onClick={onEdit}
          data-testid={`admin-hubs-edit-button-${hub.id}`}
        >
          <Pencil className="h-3 w-3" />
          {t('common.edit')}
        </Button>
        {hub.status === 'archived' && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onEdit}
            className="text-destructive hover:text-destructive"
            data-testid="hub-delete-btn"
          >
            {t('hubs.delete')}
          </Button>
        )}
      </div>
    </div>
  )
}

function CreateHubDialog({
  open,
  onOpenChange,
  createHub,
  onCreated,
  toast,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  createHub: ReturnType<typeof useCreateHub>
  onCreated: () => void
  toast: ReturnType<typeof useToast>['toast']
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')

  function resetForm() {
    setName('')
    setDescription('')
    setPhoneNumber('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    createHub.mutate(
      {
        name: name.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(phoneNumber.trim() && { phoneNumber: phoneNumber.trim() }),
      },
      {
        onSuccess: () => {
          onCreated()
          resetForm()
          toast(t('hubs.hubCreated'), 'success')
        },
        onError: () => toast(t('common.error'), 'error'),
      }
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) resetForm()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('hubs.createHub')}</DialogTitle>
          <DialogDescription>{t('hubs.createHubDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hub-name">{t('hubs.hubName')}</Label>
            <Input
              id="hub-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('hubs.hubNamePlaceholder')}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hub-description">{t('hubs.hubDescription')}</Label>
            <Textarea
              id="hub-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('hubs.hubDescriptionPlaceholder')}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hub-phone">{t('hubs.hubPhoneNumber')}</Label>
            <PhoneInput id="hub-phone" value={phoneNumber} onChange={setPhoneNumber} />
            <p className="text-xs text-muted-foreground">{t('hubs.hubPhoneNumberHelp')}</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false)
                resetForm()
              }}
              disabled={createHub.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={createHub.isPending || !name.trim()}>
              {createHub.isPending ? t('common.loading') : t('hubs.createHub')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
