/** Custom field definition — stored as config in SessionManager DO */
export interface CustomFieldDefinition {
  id: string               // unique UUID
  name: string             // internal key (machine-readable, e.g. "severity")
  label: string            // display label (e.g. "Severity Rating")
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea'
  required: boolean
  options?: string[]        // for 'select' type only
  validation?: {
    minLength?: number      // text/textarea
    maxLength?: number      // text/textarea
    min?: number            // number
    max?: number            // number
  }
  visibleToVolunteers: boolean
  editableByVolunteers: boolean
  order: number
  createdAt: string
}

/** What gets encrypted before storage — replaces plain text */
export interface NotePayload {
  text: string
  fields?: Record<string, string | number | boolean>
}

export const MAX_CUSTOM_FIELDS = 20
export const MAX_SELECT_OPTIONS = 50
export const MAX_FIELD_NAME_LENGTH = 50
export const FIELD_NAME_REGEX = /^[a-zA-Z0-9_]+$/
