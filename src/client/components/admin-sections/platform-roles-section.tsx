import { SectionBody, SectionDescription } from '@/components/section-layout'
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
import { Textarea } from '@/components/ui/textarea'
import type { RoleDefinition } from '@/lib/api'
import { useConfig } from '@/lib/config'
import {
  useCreateRole,
  useDeleteRole,
  usePermissionsCatalog,
  useRoles,
  useUpdateRole,
} from '@/lib/queries/roles'
import { useToast } from '@/lib/toast'
import { PERMISSION_GROUP_LABELS } from '@shared/permissions'
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface RoleFormData {
  name: string
  description: string
  permissions: string[]
}

const EMPTY_FORM: RoleFormData = { name: '', description: '', permissions: [] }

/**
 * Super-admin-only section for managing platform-scoped roles.
 *
 * The /api/settings/roles endpoints are NOT wrapped by the hubContext middleware
 * (settings routes mount on `authenticated`, not `/hubs/:hubId`), so `c.get('hubId')`
 * is always undefined on the server — which selects the `hubId IS NULL` rows, i.e.
 * platform-scoped roles. This section and HubRolesSection share the same endpoint
 * and the same React Query cache (queryKeys.roles.list()) by design.
 *
 * `role-super-admin` is treated as a read-only system role.
 */
export function PlatformRolesSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { currentHubId } = useConfig()
  // Hub-key used only for encrypting/decrypting the role name/description fields.
  // Falls back to 'global' when no hub is active.
  const hubId = currentHubId ?? 'global'

  const { data: roles = [], isLoading } = useRoles(hubId)
  const { data: catalog } = usePermissionsCatalog()
  const createRole = useCreateRole()
  const updateRole = useUpdateRole()
  const deleteRole = useDeleteRole()

  const [dialogMode, setDialogMode] = useState<'closed' | 'create' | 'edit'>('closed')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<RoleFormData>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<RoleDefinition | null>(null)

  // Sort roles: system first, then default, then custom (alphabetical within each group).
  const sortedRoles = [...roles].sort((a, b) => {
    const weight = (r: RoleDefinition) => (r.isSystem ? 0 : r.isDefault ? 1 : 2)
    const diff = weight(a) - weight(b)
    if (diff !== 0) return diff
    return a.name.localeCompare(b.name)
  })

  function openCreateDialog() {
    setDialogMode('create')
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  function openEditDialog(role: RoleDefinition) {
    setDialogMode('edit')
    setEditingId(role.id)
    setForm({
      name: role.name || '',
      description: role.description || '',
      permissions: [...role.permissions],
    })
  }

  function closeDialog() {
    setDialogMode('closed')
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  function togglePermission(key: string) {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key],
    }))
  }

  function handleSave() {
    const trimmedName = form.name.trim()
    const trimmedDesc = form.description.trim()
    if (!trimmedName) return

    const mutationOpts = {
      onSuccess: () => {
        closeDialog()
        toast(
          dialogMode === 'create'
            ? t('platformRoles.created', { defaultValue: 'Role created' })
            : t('platformRoles.updated', { defaultValue: 'Role updated' }),
          'success'
        )
      },
      onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
    }

    // Platform roles are hubId=null — they must be readable by every
    // super-admin regardless of which hub is active, so they are NOT
    // encrypted with any hub key. Send plaintext only; the server's
    // fallback path stores it in the encryptedName column as plaintext.
    if (dialogMode === 'create') {
      createRole.mutate(
        {
          name: trimmedName,
          description: trimmedDesc,
          permissions: form.permissions,
        },
        mutationOpts
      )
    } else if (dialogMode === 'edit' && editingId) {
      updateRole.mutate(
        {
          id: editingId,
          data: {
            name: trimmedName,
            description: trimmedDesc,
            permissions: form.permissions,
          },
        },
        mutationOpts
      )
    }
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteRole.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast(t('platformRoles.deleted', { defaultValue: 'Role deleted' }), 'success')
        setDeleteTarget(null)
      },
      onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
    })
  }

  const isSaving = createRole.isPending || updateRole.isPending

  return (
    <SectionBody>
      <div className="flex items-start justify-between gap-4">
        <SectionDescription>
          {t('platformRoles.description', {
            defaultValue:
              'Platform-wide roles available across all hubs. Only super admins can manage these.',
          })}
        </SectionDescription>
        <Button
          onClick={openCreateDialog}
          data-testid="admin-platform-roles-create-button"
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
          {t('platformRoles.create', { defaultValue: 'Create Role' })}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          {t('common.loading', { defaultValue: 'Loading...' })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm" data-testid="admin-platform-roles-table">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">
                  {t('platformRoles.columns.name', { defaultValue: 'Name' })}
                </th>
                <th className="px-4 py-2">
                  {t('platformRoles.columns.description', { defaultValue: 'Description' })}
                </th>
                <th className="px-4 py-2">
                  {t('platformRoles.columns.permissions', { defaultValue: 'Permissions' })}
                </th>
                <th className="px-4 py-2 text-right">
                  {t('platformRoles.columns.actions', { defaultValue: 'Actions' })}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRoles.map((role) => {
                const readOnly = role.isSystem
                const canDelete = !role.isSystem && !role.isDefault
                return (
                  <tr
                    key={role.id}
                    data-testid={`admin-platform-roles-row-${role.id}`}
                    className="border-t border-border"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{role.name}</span>
                        {role.isSystem && (
                          <Badge variant="secondary" className="text-[10px] gap-1">
                            <Lock className="h-2.5 w-2.5" />
                            {t('platformRoles.system', { defaultValue: 'System' })}
                          </Badge>
                        )}
                        {role.isDefault && !role.isSystem && (
                          <Badge variant="outline" className="text-[10px]">
                            {t('platformRoles.default', { defaultValue: 'Default' })}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{role.description || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{role.permissions.length}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(role)}
                          disabled={readOnly}
                          title={
                            readOnly
                              ? t('platformRoles.systemReadOnly', {
                                  defaultValue: 'System role cannot be edited',
                                })
                              : undefined
                          }
                          data-testid={`admin-platform-roles-edit-${role.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="sr-only">
                            {t('common.edit', { defaultValue: 'Edit' })}
                          </span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(role)}
                          disabled={!canDelete}
                          title={
                            readOnly
                              ? t('platformRoles.systemReadOnly', {
                                  defaultValue: 'System role cannot be edited',
                                })
                              : undefined
                          }
                          data-testid={`admin-platform-roles-delete-${role.id}`}
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

      <Dialog
        open={dialogMode !== 'closed'}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'create'
                ? t('platformRoles.createTitle', { defaultValue: 'Create Platform Role' })
                : t('platformRoles.editTitle', { defaultValue: 'Edit Platform Role' })}
            </DialogTitle>
            <DialogDescription>
              {t('platformRoles.dialogDescription', {
                defaultValue:
                  'Platform roles are visible to all hubs. Use them for cross-hub responsibilities.',
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="platform-role-name">
                {t('platformRoles.name', { defaultValue: 'Name' })}
              </Label>
              <Input
                id="platform-role-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('platformRoles.namePlaceholder', {
                  defaultValue: 'e.g. Platform Auditor',
                })}
                maxLength={50}
                data-testid="admin-platform-roles-name-input"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="platform-role-description">
                {t('platformRoles.descriptionLabel', { defaultValue: 'Description' })}
              </Label>
              <Textarea
                id="platform-role-description"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={t('platformRoles.descriptionPlaceholder', {
                  defaultValue: 'Brief description of this role...',
                })}
                rows={2}
                maxLength={200}
                data-testid="admin-platform-roles-description-input"
              />
            </div>

            {catalog && (
              <div className="space-y-2">
                <Label>
                  {t('platformRoles.permissions', { defaultValue: 'Permissions' })}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({form.permissions.length}{' '}
                    {t('platformRoles.selected', { defaultValue: 'selected' })})
                  </span>
                </Label>
                <div className="space-y-3 rounded-md border border-border p-3 max-h-[280px] overflow-y-auto">
                  {Object.entries(catalog.byDomain).map(([domain, perms]) => (
                    <div key={domain} className="space-y-1">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {PERMISSION_GROUP_LABELS[domain] ?? domain}
                      </div>
                      <div className="space-y-0.5 pl-2">
                        {perms.map((perm) => (
                          <label
                            key={perm.key}
                            className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/30 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={form.permissions.includes(perm.key)}
                              onChange={() => togglePermission(perm.key)}
                              className="h-4 w-4 rounded border-input accent-primary shrink-0"
                              data-testid={`admin-platform-roles-perm-${perm.key}`}
                            />
                            <span className="text-sm">{perm.meta.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDialog}
              data-testid="admin-platform-roles-cancel"
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !form.name.trim()}
              data-testid="admin-platform-roles-save"
            >
              {isSaving
                ? t('common.loading', { defaultValue: 'Loading...' })
                : t('common.save', { defaultValue: 'Save' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {t('platformRoles.deleteTitle', { defaultValue: 'Delete Role' })}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? t('platformRoles.deleteConfirm', {
                    defaultValue: `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.`,
                    name: deleteTarget.name,
                  })
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteRole.isPending}
              data-testid="admin-platform-roles-cancel-delete"
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteRole.isPending}
              data-testid="admin-platform-roles-confirm-delete"
            >
              {deleteRole.isPending
                ? t('common.loading', { defaultValue: 'Loading...' })
                : t('common.delete', { defaultValue: 'Delete' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionBody>
  )
}
