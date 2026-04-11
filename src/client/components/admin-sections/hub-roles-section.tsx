import { SectionBody, SectionDescription } from '@/components/admin-shell/section-layout'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { RoleDefinition } from '@/lib/api'
import { useConfig } from '@/lib/config'
import { encryptHubField } from '@/lib/hub-field-crypto'
import {
  useCreateRole,
  useDeleteRole,
  usePermissionsCatalog,
  useRoles,
  useUpdateRole,
} from '@/lib/queries/roles'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import type { PermissionMeta } from '@shared/permissions'
import { PERMISSION_GROUP_LABELS } from '@shared/permissions'
import { ChevronDown, ChevronRight, Lock, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface RoleFormData {
  name: string
  description: string
  permissions: string[]
}

// ---------------------------------------------------------------------------
// Subgroup renderers
// ---------------------------------------------------------------------------

const SCOPE_LEVEL_ORDER: Record<string, number> = { own: 0, assigned: 1, all: 2 }

function ScopeGroup({
  scopePerms,
  permissions,
  onChange,
}: {
  scopePerms: { key: string; meta: PermissionMeta }[]
  permissions: string[]
  onChange: (newPermissions: string[]) => void
}) {
  const groups = new Map<string, { key: string; meta: PermissionMeta }[]>()
  for (const perm of scopePerms) {
    const prefix = perm.key.replace(/-(own|assigned|all)$/, '')
    if (!groups.has(prefix)) groups.set(prefix, [])
    groups.get(prefix)!.push(perm)
  }

  return (
    <div className="space-y-3">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Scope
      </span>
      {[...groups.entries()].map(([prefix, perms]) => {
        const sorted = [...perms].sort((a, b) => {
          const aScope = a.key.match(/-(own|assigned|all)$/)?.[1] ?? ''
          const bScope = b.key.match(/-(own|assigned|all)$/)?.[1] ?? ''
          return (SCOPE_LEVEL_ORDER[aScope] ?? 0) - (SCOPE_LEVEL_ORDER[bScope] ?? 0)
        })
        const selectedKey = sorted.find((p) => permissions.includes(p.key))?.key ?? null
        const actionLabel = prefix.split(':')[1]

        return (
          <div key={prefix} className="space-y-1">
            <span className="text-xs text-muted-foreground capitalize">{actionLabel}</span>
            <div className="space-y-0.5">
              <label className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/30 cursor-pointer transition-colors">
                <input
                  type="radio"
                  name={`scope-${prefix}`}
                  checked={selectedKey === null}
                  onChange={() => {
                    onChange(permissions.filter((p) => !sorted.some((s) => s.key === p)))
                  }}
                  className="h-4 w-4 accent-primary"
                  data-testid={`admin-hub-roles-scope-${prefix}-none`}
                />
                <span className="text-sm text-muted-foreground">None</span>
              </label>
              {sorted.map((perm) => (
                <label
                  key={perm.key}
                  className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/30 cursor-pointer transition-colors"
                >
                  <input
                    type="radio"
                    name={`scope-${prefix}`}
                    checked={selectedKey === perm.key}
                    onChange={() => {
                      const without = permissions.filter((p) => !sorted.some((s) => s.key === p))
                      onChange([...without, perm.key])
                    }}
                    className="h-4 w-4 accent-primary"
                    data-testid={`admin-hub-roles-scope-${perm.key}`}
                  />
                  <span className="text-sm">{perm.meta.label}</span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ExpandedDomainSection({
  perms,
  permissions,
  onPermissionsChange,
  onTogglePermission,
}: {
  perms: { key: string; meta: PermissionMeta }[]
  permissions: string[]
  onPermissionsChange: (newPermissions: string[]) => void
  onTogglePermission: (key: string) => void
}) {
  const scopePerms = perms.filter((p) => p.meta.subgroup === 'scope')
  const tierPerms = perms.filter((p) => p.meta.subgroup === 'tiers')
  const actionPerms = perms.filter((p) => p.meta.subgroup === 'actions')

  return (
    <div className="border-t border-border px-3 py-2 space-y-3">
      {scopePerms.length > 0 && (
        <ScopeGroup
          scopePerms={scopePerms}
          permissions={permissions}
          onChange={onPermissionsChange}
        />
      )}
      {tierPerms.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Data Access
          </span>
          {tierPerms.map((perm) => (
            <label
              key={perm.key}
              className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/30 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={permissions.includes(perm.key)}
                onChange={() => onTogglePermission(perm.key)}
                className="h-4 w-4 rounded border-input accent-primary shrink-0"
                data-testid={`admin-hub-roles-tier-${perm.key}`}
              />
              <span className="text-sm">{perm.meta.label}</span>
            </label>
          ))}
        </div>
      )}
      {actionPerms.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Actions
          </span>
          {actionPerms.map((perm) => (
            <label
              key={perm.key}
              className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/30 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={permissions.includes(perm.key)}
                onChange={() => onTogglePermission(perm.key)}
                className="h-4 w-4 rounded border-input accent-primary shrink-0"
                data-testid={`admin-hub-roles-action-${perm.key}`}
              />
              <span className="text-sm">{perm.meta.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export function HubRolesSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'

  const { data: roles = [], isLoading: rolesLoading } = useRoles(hubId)
  const { data: catalog } = usePermissionsCatalog()
  const createRole = useCreateRole()
  const updateRole = useUpdateRole()
  const deleteRole = useDeleteRole()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<RoleFormData>({
    name: '',
    description: '',
    permissions: [],
  })
  const [deleteTarget, setDeleteTarget] = useState<RoleDefinition | null>(null)
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set())
  const [showSaved, setShowSaved] = useState(false)

  function startCreate() {
    setEditingId('new')
    setForm({ name: '', description: '', permissions: [] })
    setExpandedDomains(new Set())
  }

  function startEdit(role: RoleDefinition) {
    setEditingId(role.id)
    setForm({
      name: role.name || '',
      description: role.description || '',
      permissions: [...role.permissions],
    })
    if (catalog) {
      const domainsWithSelections = new Set<string>()
      for (const [domain, perms] of Object.entries(catalog.byDomain)) {
        if (perms.some((p) => role.permissions.includes(p.key))) {
          domainsWithSelections.add(domain)
        }
      }
      setExpandedDomains(domainsWithSelections)
    }
  }

  function cancelEdit() {
    setEditingId(null)
    setForm({ name: '', description: '', permissions: [] })
    setExpandedDomains(new Set())
  }

  function togglePermission(key: string) {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key],
    }))
  }

  function toggleDomainAll(domain: string) {
    if (!catalog) return
    const domainPerms = catalog.byDomain[domain]
    if (!domainPerms) return
    const domainKeys: string[] = domainPerms.map((p) => p.key)
    const allCurrentlySelected = isDomainFullySelected(domain)

    setForm((prev) => {
      if (allCurrentlySelected) {
        return { ...prev, permissions: prev.permissions.filter((p) => !domainKeys.includes(p)) }
      }
      const scopePerms = domainPerms.filter((p) => p.meta.subgroup === 'scope')
      const nonScopePerms = domainPerms.filter((p) => p.meta.subgroup !== 'scope')

      const scopeGroups = new Map<string, string>()
      const scopeOrder: Record<string, number> = { own: 0, assigned: 1, all: 2 }
      for (const perm of scopePerms) {
        const prefix = perm.key.replace(/-(own|assigned|all)$/, '')
        const suffix = perm.key.match(/-(own|assigned|all)$/)?.[1] ?? ''
        const current = scopeGroups.get(prefix)
        const currentSuffix = current?.match(/-(own|assigned|all)$/)?.[1] ?? ''
        if (!current || (scopeOrder[suffix] ?? 0) > (scopeOrder[currentSuffix] ?? 0)) {
          scopeGroups.set(prefix, perm.key)
        }
      }

      const keysToAdd = [...nonScopePerms.map((p) => p.key), ...scopeGroups.values()]
      const existing = new Set(prev.permissions)
      for (const k of domainKeys) existing.delete(k)
      for (const k of keysToAdd) existing.add(k)
      return { ...prev, permissions: Array.from(existing) }
    })
  }

  function toggleDomainExpanded(domain: string) {
    setExpandedDomains((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }

  function flashSaved() {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    if (editingId === 'new') {
      const trimmedName = form.name.trim()
      const trimmedDesc = form.description.trim()
      // Pre-generate a client role id so the AAD can be bound to a stable ID.
      // Matches the server's legacy `role-${uuid}` convention.
      const newId = `role-${crypto.randomUUID()}`
      const encryptedName = await encryptHubField(trimmedName, hubId, newId, 'encrypted_name')
      const encryptedDescription = trimmedDesc
        ? await encryptHubField(trimmedDesc, hubId, newId, 'encrypted_description')
        : undefined
      createRole.mutate(
        {
          id: newId,
          name: trimmedName,
          description: trimmedDesc,
          permissions: form.permissions,
          encryptedName,
          encryptedDescription,
        },
        {
          onSuccess: () => {
            cancelEdit()
            flashSaved()
            toast(t('roles.created', { defaultValue: 'Role created' }), 'success')
          },
          onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
        }
      )
    } else if (editingId) {
      const trimmedName = form.name.trim()
      const trimmedDesc = form.description.trim()
      const encryptedName = await encryptHubField(trimmedName, hubId, editingId, 'encrypted_name')
      const encryptedDescription = trimmedDesc
        ? await encryptHubField(trimmedDesc, hubId, editingId, 'encrypted_description')
        : undefined
      updateRole.mutate(
        {
          id: editingId,
          data: {
            name: trimmedName,
            description: trimmedDesc,
            permissions: form.permissions,
            encryptedName,
            encryptedDescription,
          },
        },
        {
          onSuccess: () => {
            cancelEdit()
            flashSaved()
            toast(t('roles.updated', { defaultValue: 'Role updated' }), 'success')
          },
          onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
        }
      )
    }
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteRole.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast(t('roles.deleted', { defaultValue: 'Role deleted' }), 'success')
        if (editingId === deleteTarget.id) cancelEdit()
        setDeleteTarget(null)
      },
      onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
    })
  }

  function isDomainFullySelected(domain: string): boolean {
    if (!catalog) return false
    const domainPerms = catalog.byDomain[domain]
    if (!domainPerms?.length) return false

    const scopeOrder: Record<string, number> = { own: 0, assigned: 1, all: 2 }
    for (const perm of domainPerms) {
      if (perm.meta.subgroup !== 'scope') {
        if (!form.permissions.includes(perm.key)) return false
      } else {
        const prefix = perm.key.replace(/-(own|assigned|all)$/, '')
        const suffix = perm.key.match(/-(own|assigned|all)$/)?.[1] ?? ''
        const isHighest = !domainPerms.some((other) => {
          if (other.meta.subgroup !== 'scope') return false
          const otherPrefix = other.key.replace(/-(own|assigned|all)$/, '')
          if (otherPrefix !== prefix) return false
          const otherSuffix = other.key.match(/-(own|assigned|all)$/)?.[1] ?? ''
          return (scopeOrder[otherSuffix] ?? 0) > (scopeOrder[suffix] ?? 0)
        })
        if (isHighest && !form.permissions.includes(perm.key)) return false
      }
    }
    return true
  }

  function getDomainSelectionState(domain: string): 'all' | 'some' | 'none' {
    if (!catalog) return 'none'
    const domainPerms = catalog.byDomain[domain]
    if (!domainPerms?.length) return 'none'
    const domainKeys: string[] = domainPerms.map((p) => p.key)
    const selectedCount = domainKeys.filter((k) => form.permissions.includes(k)).length
    if (selectedCount === 0) return 'none'
    if (isDomainFullySelected(domain)) return 'all'
    return 'some'
  }

  const canEdit = (role: RoleDefinition) => !role.isSystem
  const canDelete = (role: RoleDefinition) => !role.isSystem && !role.isDefault

  const isSaving = createRole.isPending || updateRole.isPending

  if (rolesLoading) return null

  return (
    <SectionBody>
      <SectionDescription>
        {t('roles.description', {
          defaultValue:
            'Define roles and assign permissions to control access across your hotline.',
        })}
      </SectionDescription>

      <div className="space-y-2" data-testid="admin-hub-roles-list">
        {roles.map((role) => (
          <div
            key={role.id}
            data-testid={`admin-hub-roles-row-${role.id}`}
            className={cn(
              'flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors',
              editingId === role.id && 'border-primary/30 bg-primary/5'
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{role.name}</span>
                {role.isSystem && (
                  <Badge variant="secondary" className="text-[10px] gap-1">
                    <Lock className="h-2.5 w-2.5" />
                    {t('roles.system', { defaultValue: 'System' })}
                  </Badge>
                )}
                {role.isDefault && !role.isSystem && (
                  <Badge variant="outline" className="text-[10px]">
                    {t('roles.default', { defaultValue: 'Default' })}
                  </Badge>
                )}
              </div>
              {role.encryptedDescription && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{role.description}</p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                {role.permissions.length}{' '}
                {t('roles.permissionCount', { defaultValue: 'permissions' })}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {canEdit(role) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit(role)}
                  disabled={editingId !== null}
                  data-testid={`admin-hub-roles-edit-${role.id}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="sr-only">{t('common.edit', { defaultValue: 'Edit' })}</span>
                </Button>
              )}
              {canDelete(role) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteTarget(role)}
                  disabled={editingId !== null}
                  data-testid={`admin-hub-roles-delete-${role.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  <span className="sr-only">{t('common.delete', { defaultValue: 'Delete' })}</span>
                </Button>
              )}
              {role.isSystem && (
                <span className="text-xs text-muted-foreground px-2">
                  {t('roles.locked', { defaultValue: 'Locked' })}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {editingId !== null && catalog && (
        <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <h4 className="text-sm font-medium">
            {editingId === 'new'
              ? t('roles.createRole', { defaultValue: 'Create Role' })
              : t('roles.editRole', { defaultValue: 'Edit Role' })}
          </h4>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('roles.name', { defaultValue: 'Name' })}</Label>
              <Input
                value={form.name}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }}
                placeholder={t('roles.namePlaceholder', { defaultValue: 'e.g. Team Lead' })}
                maxLength={50}
                data-testid="admin-hub-roles-name-input"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t('roles.descriptionLabel', { defaultValue: 'Description' })}</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder={t('roles.descriptionPlaceholder', {
                defaultValue: 'Brief description of this role...',
              })}
              rows={2}
              maxLength={200}
              data-testid="admin-hub-roles-description-input"
            />
          </div>

          <div className="space-y-1">
            <Label>{t('roles.permissions', { defaultValue: 'Permissions' })}</Label>
            <p className="text-xs text-muted-foreground">
              {form.permissions.length} {t('roles.selected', { defaultValue: 'selected' })}
            </p>
          </div>

          <div className="space-y-1">
            {Object.entries(catalog.byDomain).map(([domain, perms]) => {
              const domainState = getDomainSelectionState(domain)
              const isExpanded = expandedDomains.has(domain)

              return (
                <div
                  key={domain}
                  className="rounded-md border border-border"
                  data-testid={`admin-hub-roles-domain-${domain}`}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                    onClick={() => toggleDomainExpanded(domain)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <input
                      type="checkbox"
                      checked={domainState === 'all'}
                      ref={(el) => {
                        if (el) el.indeterminate = domainState === 'some'
                      }}
                      onChange={(e) => {
                        e.stopPropagation()
                        toggleDomainAll(domain)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-input accent-primary shrink-0"
                    />
                    <span className="text-sm font-medium flex-1">
                      {PERMISSION_GROUP_LABELS[domain] ?? domain}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {perms.filter((p) => form.permissions.includes(p.key)).length}/{perms.length}
                    </Badge>
                  </button>

                  {isExpanded && (
                    <ExpandedDomainSection
                      perms={perms}
                      permissions={form.permissions}
                      onPermissionsChange={(newPerms) =>
                        setForm((prev) => ({ ...prev, permissions: newPerms }))
                      }
                      onTogglePermission={togglePermission}
                    />
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex gap-2">
            <Button
              disabled={isSaving || !form.name.trim()}
              onClick={handleSave}
              data-testid="admin-hub-roles-save"
            >
              <Save className="h-4 w-4" />
              {isSaving
                ? t('common.loading', { defaultValue: 'Loading...' })
                : t('common.save', { defaultValue: 'Save' })}
            </Button>
            <Button variant="outline" onClick={cancelEdit} data-testid="admin-hub-roles-cancel">
              <X className="h-4 w-4" />
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        </div>
      )}

      {editingId === null && (
        <Button variant="outline" onClick={startCreate} data-testid="admin-hub-roles-create">
          <Plus className="h-4 w-4" />
          {t('roles.createRole', { defaultValue: 'Create Role' })}
        </Button>
      )}

      {showSaved && (
        <span data-testid="admin-hub-roles-save-success" className="text-sm text-green-600">
          {t('common.success', { defaultValue: 'Saved' })}
        </span>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('roles.deleteTitle', { defaultValue: 'Delete Role' })}
        description={
          deleteTarget
            ? t('roles.deleteConfirm', {
                defaultValue: `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone. Users assigned this role will lose its permissions.`,
                name: deleteTarget.name,
              })
            : ''
        }
        variant="destructive"
        onConfirm={handleDelete}
      />
    </SectionBody>
  )
}
