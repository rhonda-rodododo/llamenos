import type { FileFieldValue } from '@shared/types'
import { Save, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { CustomFieldDefinition } from '@/lib/api'
import { CustomFieldInputs } from './custom-field-inputs'

type FieldValue = string | string[] | number | boolean | FileFieldValue

interface Props {
  text: string
  fields: Record<string, FieldValue>
  customFieldDefs: CustomFieldDefinition[]
  saving: boolean
  onSave: (text: string, fields: Record<string, FieldValue>) => void
  onCancel: () => void
}

export function NoteEditForm({
  text: initialText,
  fields: initialFields,
  customFieldDefs,
  saving,
  onSave,
  onCancel,
}: Props) {
  const { t } = useTranslation()
  const [text, setText] = useState(initialText)
  const [fields, setFields] = useState(initialFields)

  return (
    <div className="mt-2 space-y-3">
      <textarea
        data-testid="note-edit-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <CustomFieldInputs
        fields={customFieldDefs}
        values={fields}
        onChange={setFields}
        idPrefix="edit-field"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          data-testid="form-save-btn"
          onClick={() => onSave(text, fields)}
          disabled={saving}
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? t('common.loading') : t('common.save')}
        </Button>
        <Button size="sm" variant="outline" data-testid="form-cancel-btn" onClick={onCancel}>
          <X className="h-3.5 w-3.5" />
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
