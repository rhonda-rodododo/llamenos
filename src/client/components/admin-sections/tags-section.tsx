import { SectionBody, SectionDescription } from '@/components/admin-shell/section-layout'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TagBadge } from '@/components/tag-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Tag } from '@/lib/api'
import { useConfig } from '@/lib/config'
import { encryptHubField } from '@/lib/hub-field-crypto'
import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from '@/lib/queries/tags'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface TagFormData {
  name: string
  label: string
  color: string
  category: string
}

const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
]

const INITIAL_FORM: TagFormData = {
  name: '',
  label: '',
  color: '#3b82f6',
  category: '',
}

export function TagsSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'

  const { data: tags = [], isLoading: tagsLoading } = useTags(hubId)
  const createTag = useCreateTag()
  const updateTag = useUpdateTag()
  const deleteTagMutation = useDeleteTag()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<TagFormData>(INITIAL_FORM)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)
  const [showSaved, setShowSaved] = useState(false)

  function startCreate() {
    setEditingId('new')
    setForm(INITIAL_FORM)
  }

  function startEdit(tag: Tag) {
    setEditingId(tag.id)
    setForm({
      name: tag.name,
      label: tag.label || tag.name,
      color: tag.color || '#3b82f6',
      category: tag.category || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(INITIAL_FORM)
  }

  function slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }

  function flashSaved() {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  async function handleSave() {
    if (!form.label.trim()) return

    if (editingId === 'new') {
      const name = form.name.trim() || slugify(form.label.trim())
      if (!name) return

      // Pre-generate a client UUID for the new tag so the AAD can be bound to a stable ID.
      const newId = crypto.randomUUID()
      const encryptedLabel = await encryptHubField(
        form.label.trim(),
        hubId,
        newId,
        'encrypted_label'
      )
      if (!encryptedLabel) {
        toast(t('common.error', { defaultValue: 'Error' }), 'error')
        return
      }
      const encryptedCategory = form.category.trim()
        ? await encryptHubField(form.category.trim(), hubId, newId, 'encrypted_category')
        : undefined

      createTag.mutate(
        {
          name,
          encryptedLabel,
          color: form.color,
          encryptedCategory,
        },
        {
          onSuccess: () => {
            cancelEdit()
            flashSaved()
            toast(t('tags.created', { defaultValue: 'Tag created' }), 'success')
          },
          onError: (err) => {
            const msg = err instanceof Error ? err.message : String(err)
            if (msg.includes('409')) {
              toast(t('tags.alreadyExists', { defaultValue: 'Tag already exists' }), 'error')
            } else {
              toast(t('common.error', { defaultValue: 'Error' }), 'error')
            }
          },
        }
      )
    } else if (editingId) {
      const encryptedLabel = await encryptHubField(
        form.label.trim(),
        hubId,
        editingId,
        'encrypted_label'
      )
      if (!encryptedLabel) {
        toast(t('common.error', { defaultValue: 'Error' }), 'error')
        return
      }
      const encryptedCategory = form.category.trim()
        ? await encryptHubField(form.category.trim(), hubId, editingId, 'encrypted_category')
        : undefined

      updateTag.mutate(
        {
          id: editingId,
          data: {
            encryptedLabel,
            color: form.color,
            encryptedCategory: form.category.trim() ? encryptedCategory : null,
          },
        },
        {
          onSuccess: () => {
            cancelEdit()
            flashSaved()
            toast(t('tags.updated', { defaultValue: 'Tag updated' }), 'success')
          },
          onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
        }
      )
    }
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteTagMutation.mutate(deleteTarget.id, {
      onSuccess: (result) => {
        toast(
          t('tags.deleted', {
            defaultValue: 'Tag deleted (removed from {{count}} contacts)',
            count: result.removedFromContacts,
          }),
          'success'
        )
        if (editingId === deleteTarget.id) cancelEdit()
        setDeleteTarget(null)
      },
      onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
    })
  }

  const isSaving = createTag.isPending || updateTag.isPending

  if (tagsLoading) return null

  return (
    <SectionBody>
      <SectionDescription>
        {t('tags.description', {
          defaultValue:
            'Define tags for organizing contacts. Tag labels are encrypted with the hub key.',
        })}
      </SectionDescription>

      <div className="space-y-2" data-testid="admin-tags-list">
        {tags.length === 0 && editingId === null && (
          <p className="text-sm text-muted-foreground">
            {t('tags.noTags', { defaultValue: 'No tags defined yet.' })}
          </p>
        )}
        {tags.map((tag) => {
          const label = tag.label || tag.name
          const category = tag.category || ''

          return (
            <div
              key={tag.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors',
                editingId === tag.id && 'border-primary/30 bg-primary/5'
              )}
              data-testid={`admin-tags-row-${tag.name}`}
            >
              <span
                className="h-3.5 w-3.5 rounded-full shrink-0"
                style={
                  {
                    '--tag-color': tag.color || '#888',
                    backgroundColor: 'var(--tag-color)',
                  } as React.CSSProperties
                }
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <TagBadge label={label} color={tag.color || ''} />
                  <span className="text-xs text-muted-foreground font-mono">{tag.name}</span>
                </div>
                {category && <p className="text-xs text-muted-foreground mt-0.5">{category}</p>}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit(tag)}
                  disabled={editingId !== null}
                  data-testid={`admin-tags-edit-${tag.name}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="sr-only">{t('common.edit', { defaultValue: 'Edit' })}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteTarget(tag)}
                  disabled={editingId !== null}
                  data-testid={`admin-tags-delete-${tag.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  <span className="sr-only">{t('common.delete', { defaultValue: 'Delete' })}</span>
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {editingId !== null && (
        <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <h4 className="text-sm font-medium">
            {editingId === 'new'
              ? t('tags.createTag', { defaultValue: 'Create Tag' })
              : t('tags.editTag', { defaultValue: 'Edit Tag' })}
          </h4>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('tags.label', { defaultValue: 'Label' })}</Label>
              <Input
                value={form.label}
                onChange={(e) => {
                  const label = e.target.value
                  setForm((prev) => ({
                    ...prev,
                    label,
                    ...(editingId === 'new' ? { name: slugify(label) } : {}),
                  }))
                }}
                placeholder={t('tags.labelPlaceholder', { defaultValue: 'e.g. Urgent' })}
                maxLength={100}
                data-testid="admin-tags-label-input"
              />
            </div>

            {editingId === 'new' && (
              <div className="space-y-1">
                <Label>{t('tags.name', { defaultValue: 'Slug' })}</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: slugify(e.target.value) }))}
                  placeholder={t('tags.namePlaceholder', { defaultValue: 'auto-generated' })}
                  maxLength={50}
                  data-testid="admin-tags-name-input"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {t('tags.nameHint', {
                    defaultValue: 'Unique identifier (cannot be changed after creation)',
                  })}
                </p>
              </div>
            )}

            <div className="space-y-1">
              <Label>{t('tags.category', { defaultValue: 'Category' })}</Label>
              <Input
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                placeholder={t('tags.categoryPlaceholder', {
                  defaultValue: 'e.g. Priority, Status',
                })}
                maxLength={100}
                data-testid="admin-tags-category-input"
              />
            </div>

            <div className="space-y-1">
              <Label>{t('tags.color', { defaultValue: 'Color' })}</Label>
              <div className="flex items-center gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      'h-7 w-7 rounded-full border-2 transition-all',
                      form.color === color
                        ? 'border-foreground scale-110'
                        : 'border-transparent hover:border-muted-foreground/50'
                    )}
                    style={
                      {
                        '--swatch-color': color,
                        backgroundColor: 'var(--swatch-color)',
                      } as React.CSSProperties
                    }
                    onClick={() => setForm((prev) => ({ ...prev, color }))}
                    data-testid={`admin-tags-color-${color}`}
                  >
                    <span className="sr-only">{color}</span>
                  </button>
                ))}
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm((prev) => ({ ...prev, color: e.target.value }))}
                  className="h-7 w-7 cursor-pointer rounded border-0 p-0"
                  data-testid="admin-tags-color-custom"
                />
              </div>
            </div>

            {form.label.trim() && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {t('tags.preview', { defaultValue: 'Preview' })}
                </Label>
                <div>
                  <TagBadge label={form.label.trim()} color={form.color} />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              disabled={isSaving || !form.label.trim()}
              onClick={handleSave}
              data-testid="admin-tags-save"
            >
              <Save className="h-4 w-4" />
              {isSaving
                ? t('common.loading', { defaultValue: 'Loading...' })
                : t('common.save', { defaultValue: 'Save' })}
            </Button>
            <Button variant="outline" onClick={cancelEdit} data-testid="admin-tags-cancel">
              <X className="h-4 w-4" />
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        </div>
      )}

      {editingId === null && (
        <Button variant="outline" onClick={startCreate} data-testid="admin-tags-create">
          <Plus className="h-4 w-4" />
          {t('tags.createTag', { defaultValue: 'Create Tag' })}
        </Button>
      )}

      {showSaved && (
        <span data-testid="admin-tags-save-success" className="text-sm text-green-600">
          {t('common.success', { defaultValue: 'Saved' })}
        </span>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('tags.deleteTitle', { defaultValue: 'Delete Tag' })}
        description={
          deleteTarget
            ? t('tags.deleteConfirm', {
                defaultValue:
                  'Are you sure you want to delete this tag? It will be removed from all contacts that use it.',
              })
            : ''
        }
        variant="destructive"
        onConfirm={handleDelete}
      />
    </SectionBody>
  )
}
