import { useTranslation } from 'react-i18next'
import type { CustomFieldDefinition } from '@/lib/api'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

interface Props {
  fields: CustomFieldDefinition[]
  values: Record<string, string | number | boolean>
  onChange: (values: Record<string, string | number | boolean>) => void
  idPrefix: string
}

export function CustomFieldInputs({ fields, values, onChange, idPrefix }: Props) {
  const { t } = useTranslation()

  if (fields.length === 0) return null

  function update(fieldId: string, value: string | number | boolean) {
    onChange({ ...values, [fieldId]: value })
  }

  return (
    <div className="space-y-3 border-t pt-3">
      {fields.map(field => (
        <div key={field.id} className="space-y-1">
          <Label htmlFor={`${idPrefix}-${field.name}`} className="text-xs">
            {field.label}{field.required ? ' *' : ''}
          </Label>
          {field.type === 'text' && (
            <Input
              id={`${idPrefix}-${field.name}`}
              value={String(values[field.id] ?? '')}
              onChange={e => update(field.id, e.target.value)}
            />
          )}
          {field.type === 'number' && (
            <Input
              id={`${idPrefix}-${field.name}`}
              type="number"
              value={values[field.id] !== undefined ? String(values[field.id]) : ''}
              onChange={e => update(field.id, e.target.value ? Number(e.target.value) : '')}
            />
          )}
          {field.type === 'textarea' && (
            <textarea
              id={`${idPrefix}-${field.name}`}
              value={String(values[field.id] ?? '')}
              onChange={e => update(field.id, e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          {field.type === 'select' && (
            <Select
              value={String(values[field.id] ?? '')}
              onValueChange={v => update(field.id, v)}
            >
              <SelectTrigger id={`${idPrefix}-${field.name}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {field.options?.map(opt => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {field.type === 'checkbox' && (
            <div className="flex items-center gap-2">
              <input
                id={`${idPrefix}-${field.name}`}
                type="checkbox"
                checked={Boolean(values[field.id])}
                onChange={e => update(field.id, e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
