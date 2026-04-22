import { type LocationPrecision, MAX_CUSTOM_FIELDS } from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Plus, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionBody, SectionDescription } from '@/components/section-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { type CustomFieldDefinition, updateCustomFields } from '@/lib/api'
import { useConfig } from '@/lib/config'
import { encryptHubField } from '@/lib/hub-field-crypto'
import { queryKeys } from '@/lib/queries/keys'
import { useCustomFields } from '@/lib/queries/settings'
import { useToast } from '@/lib/toast'

export function CustomFieldsSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'

  const { data: fields = [], isLoading } = useCustomFields(hubId)
  const [editing, setEditing] = useState<Partial<CustomFieldDefinition> | null>(null)
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)

  function flashSaved() {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  async function encryptFields(list: CustomFieldDefinition[]): Promise<CustomFieldDefinition[]> {
    return Promise.all(
      list.map(async (f) => {
        const encryptedFieldName = await encryptHubField(
          f.name,
          hubId,
          f.id,
          'encrypted_field_name'
        )
        const encryptedLabel = await encryptHubField(f.label, hubId, f.id, 'encrypted_label')
        const encryptedOptions =
          f.options && f.options.length > 0
            ? await encryptHubField(JSON.stringify(f.options), hubId, f.id, 'encrypted_options')
            : undefined
        return { ...f, encryptedFieldName, encryptedLabel, encryptedOptions }
      })
    )
  }

  async function handleReorder(index: number, direction: -1 | 1) {
    const next = [...fields]
    const swapIdx = index + direction
    ;[next[index], next[swapIdx]] = [next[swapIdx], next[index]]
    for (let i = 0; i < next.length; i++) next[i].order = i
    try {
      await updateCustomFields(await encryptFields(next))
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.customFields() })
      flashSaved()
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  async function handleDelete(fieldId: string) {
    if (!confirm(t('customFields.deleteConfirm'))) return
    const next = fields.filter((f) => f.id !== fieldId)
    for (let i = 0; i < next.length; i++) next[i].order = i
    try {
      await updateCustomFields(await encryptFields(next))
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.customFields() })
      flashSaved()
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  async function handleSave() {
    if (!editing?.label?.trim() || !editing?.name?.trim()) return
    setSaving(true)
    try {
      let next: CustomFieldDefinition[]
      if (editing.id) {
        next = fields.map((f) =>
          f.id === editing.id ? ({ ...f, ...editing } as CustomFieldDefinition) : f
        )
      } else {
        const newField: CustomFieldDefinition = {
          id: crypto.randomUUID(),
          name: editing.name ?? '',
          label: editing.label ?? '',
          type: editing.type || 'text',
          required: editing.required ?? false,
          options: editing.options,
          validation: editing.validation,
          visibleTo: editing.visibleTo ?? 'contacts:envelope-summary',
          context: editing.context ?? 'all',
          order: fields.length,
          createdAt: new Date().toISOString(),
        }
        next = [...fields, newField]
      }
      await updateCustomFields(await encryptFields(next))
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.customFields() })
      setEditing(null)
      flashSaved()
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return null

  return (
    <SectionBody className="space-y-4">
      <SectionDescription>{t('customFields.description')}</SectionDescription>

      {fields.length === 0 && !editing ? (
        <p className="text-sm text-muted-foreground">{t('customFields.noFields')}</p>
      ) : (
        <div className="space-y-2" data-testid="admin-custom-fields-list">
          {fields.map((field, index) => (
            <div
              key={field.id}
              data-testid={`admin-custom-fields-row-${field.id}`}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-3"
            >
              <div className="flex flex-col gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={index === 0}
                  onClick={() => handleReorder(index, -1)}
                  data-testid={`admin-custom-fields-move-up-${field.id}`}
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={index === fields.length - 1}
                  onClick={() => handleReorder(index, 1)}
                  data-testid={`admin-custom-fields-move-down-${field.id}`}
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex-1 space-y-0.5">
                <p className="text-sm font-medium">{field.label}</p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {t(`customFields.types.${field.type}`)}
                  </Badge>
                  {field.required && (
                    <Badge variant="secondary" className="text-[10px]">
                      {t('customFields.required')}
                    </Badge>
                  )}
                  {field.visibleTo === 'contacts:envelope-full' && (
                    <Badge variant="secondary" className="text-[10px]">
                      {t('customFields.adminOnly')}
                    </Badge>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing({ ...field })}
                data-testid={`admin-custom-fields-edit-${field.id}`}
              >
                {t('common.edit')}
              </Button>
              <Button
                data-testid={`admin-custom-fields-delete-${field.id}`}
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(field.id)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit field form */}
      {editing ? (
        <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <h4 className="text-sm font-medium">
            {editing.id ? t('common.edit') : t('customFields.addField')}
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="custom-field-label">{t('customFields.fieldLabel')}</Label>
              <Input
                id="custom-field-label"
                data-testid="admin-custom-fields-label-input"
                value={editing.label || ''}
                onChange={(e) => {
                  const label = e.target.value
                  const autoName = !editing.id
                  setEditing((prev) => ({
                    ...(prev ?? {}),
                    label,
                    ...(autoName
                      ? {
                          name: label
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, '_')
                            .replace(/^_|_$/g, '')
                            .slice(0, 50),
                        }
                      : {}),
                  }))
                }}
                placeholder="e.g. Severity Rating"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="custom-field-name">{t('customFields.fieldName')}</Label>
              <Input
                id="custom-field-name"
                data-testid="admin-custom-fields-name-input"
                value={editing.name || ''}
                onChange={(e) => setEditing((prev) => ({ ...(prev ?? {}), name: e.target.value }))}
                placeholder="e.g. severity"
                maxLength={50}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('customFields.fieldType')}</Label>
              <select
                data-testid="admin-custom-fields-type-select"
                value={editing.type || 'text'}
                onChange={(e) =>
                  setEditing((prev) => ({
                    ...(prev ?? {}),
                    type: e.target.value as CustomFieldDefinition['type'],
                  }))
                }
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="text">{t('customFields.types.text')}</option>
                <option value="number">{t('customFields.types.number')}</option>
                <option value="select">{t('customFields.types.select')}</option>
                <option value="checkbox">{t('customFields.types.checkbox')}</option>
                <option value="textarea">{t('customFields.types.textarea')}</option>
                <option value="location">{t('customFields.types.location')}</option>
                <option value="file">{t('customFields.types.file')}</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              data-testid="admin-custom-fields-required-switch"
              checked={editing.required ?? false}
              onCheckedChange={(checked) =>
                setEditing((prev) => ({ ...(prev ?? {}), required: checked }))
              }
            />
            <Label className="text-sm">{t('customFields.required')}</Label>
          </div>

          {/* Select options */}
          {editing.type === 'select' && (
            <div className="space-y-2">
              <Label>{t('customFields.options')}</Label>
              {(editing.options || []).map((opt, i) => (
                <div key={`opt-${i}-${opt}`} className="flex gap-2">
                  <Input
                    value={opt}
                    onChange={(e) => {
                      const next = [...(editing.options || [])]
                      next[i] = e.target.value
                      setEditing((prev) => ({ ...(prev ?? {}), options: next }))
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing((prev) => ({
                        ...(prev ?? {}),
                        options: prev?.options?.filter((_, j) => j !== i),
                      }))
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button
                data-testid="admin-custom-fields-add-option"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing((prev) => ({
                    ...(prev ?? {}),
                    options: [...(prev?.options || []), ''],
                  }))
                }}
              >
                <Plus className="h-3 w-3" />
                {t('customFields.addOption')}
              </Button>
            </div>
          )}

          {/* Location settings */}
          {editing.type === 'location' && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                {t('customFields.locationSettings')}
              </p>
              <div className="space-y-1">
                <Label>{t('customFields.maxPrecision')}</Label>
                <select
                  value={editing.locationSettings?.maxPrecision ?? 'exact'}
                  onChange={(e) =>
                    setEditing((prev) => ({
                      ...(prev ?? {}),
                      locationSettings: {
                        maxPrecision: e.target.value as LocationPrecision,
                        allowGps: prev?.locationSettings?.allowGps ?? false,
                      },
                    }))
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="exact">{t('customFields.precision.exact')}</option>
                  <option value="block">{t('customFields.precision.block')}</option>
                  <option value="neighborhood">{t('customFields.precision.neighborhood')}</option>
                  <option value="city">{t('customFields.precision.city')}</option>
                  <option value="none">{t('customFields.precision.none')}</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={editing.locationSettings?.allowGps ?? false}
                  onCheckedChange={(checked) =>
                    setEditing((prev) => ({
                      ...(prev ?? {}),
                      locationSettings: {
                        maxPrecision: prev?.locationSettings?.maxPrecision ?? 'exact',
                        allowGps: checked,
                      },
                    }))
                  }
                />
                <Label className="text-sm">{t('customFields.allowGps')}</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('customFields.locationEncryptionNote')}
              </p>
            </div>
          )}

          {/* Validation */}
          {(editing.type === 'text' || editing.type === 'textarea') && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('customFields.validation.minLength')}</Label>
                <Input
                  type="number"
                  value={editing.validation?.minLength ?? ''}
                  onChange={(e) =>
                    setEditing((prev) => ({
                      ...(prev ?? {}),
                      validation: {
                        ...prev?.validation,
                        minLength: e.target.value ? Number(e.target.value) : undefined,
                      },
                    }))
                  }
                  min={0}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('customFields.validation.maxLength')}</Label>
                <Input
                  type="number"
                  value={editing.validation?.maxLength ?? ''}
                  onChange={(e) =>
                    setEditing((prev) => ({
                      ...(prev ?? {}),
                      validation: {
                        ...prev?.validation,
                        maxLength: e.target.value ? Number(e.target.value) : undefined,
                      },
                    }))
                  }
                  min={0}
                />
              </div>
            </div>
          )}
          {editing.type === 'number' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('customFields.validation.min')}</Label>
                <Input
                  type="number"
                  value={editing.validation?.min ?? ''}
                  onChange={(e) =>
                    setEditing((prev) => ({
                      ...(prev ?? {}),
                      validation: {
                        ...prev?.validation,
                        min: e.target.value ? Number(e.target.value) : undefined,
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>{t('customFields.validation.max')}</Label>
                <Input
                  type="number"
                  value={editing.validation?.max ?? ''}
                  onChange={(e) =>
                    setEditing((prev) => ({
                      ...(prev ?? {}),
                      validation: {
                        ...prev?.validation,
                        max: e.target.value ? Number(e.target.value) : undefined,
                      },
                    }))
                  }
                />
              </div>
            </div>
          )}

          {/* Visibility */}
          <div className="space-y-1">
            <Label className="text-sm">{t('customFields.visibleTo')}</Label>
            <Select
              value={editing.visibleTo ?? 'contacts:envelope-summary'}
              onValueChange={(value) =>
                setEditing((prev) => ({ ...(prev ?? {}), visibleTo: value }))
              }
            >
              <SelectTrigger className="w-full" data-testid="admin-custom-fields-visibility-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contacts:envelope-summary">
                  {t('customFields.visibleToOptions.summary')}
                </SelectItem>
                <SelectItem value="contacts:envelope-full">
                  {t('customFields.visibleToOptions.full')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <Button
              data-testid="admin-custom-fields-save"
              disabled={saving || !editing.label?.trim() || !editing.name?.trim()}
              onClick={handleSave}
            >
              <Save className="h-4 w-4" />
              {saving ? t('common.loading') : t('common.save')}
            </Button>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              data-testid="admin-custom-fields-cancel"
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        fields.length < MAX_CUSTOM_FIELDS && (
          <Button
            data-testid="admin-custom-fields-add"
            variant="outline"
            onClick={() =>
              setEditing({
                type: 'text',
                required: false,
                visibleTo: 'contacts:envelope-summary',
              })
            }
          >
            <Plus className="h-4 w-4" />
            {t('customFields.addField')}
          </Button>
        )
      )}

      {fields.length >= MAX_CUSTOM_FIELDS && (
        <p className="text-xs text-muted-foreground">{t('customFields.maxFields')}</p>
      )}

      {showSaved && (
        <span data-testid="admin-custom-fields-save-success" className="text-sm text-green-600">
          {t('common.success', { defaultValue: 'Saved' })}
        </span>
      )}
    </SectionBody>
  )
}
