import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

type FieldValues = Record<string, string | number | boolean>

interface NoteSheetState {
  isOpen: boolean
  mode: 'new' | 'edit'
  editNoteId: string | null
  initialCallId: string
  initialText: string
  initialFields?: FieldValues
}

interface NoteSheetContextValue extends NoteSheetState {
  openNewNote: (callId?: string) => void
  openEditNote: (noteId: string, callId: string, text: string, fields?: FieldValues) => void
  close: () => void
  onSaved: (() => void) | null
  setOnSaved: (cb: (() => void) | null) => void
}

const NoteSheetContext = createContext<NoteSheetContextValue | null>(null)

export function NoteSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NoteSheetState>({
    isOpen: false,
    mode: 'new',
    editNoteId: null,
    initialCallId: '',
    initialText: '',
  })
  const [onSaved, setOnSaved] = useState<(() => void) | null>(null)

  const openNewNote = useCallback((callId?: string) => {
    setState({
      isOpen: true,
      mode: 'new',
      editNoteId: null,
      initialCallId: callId || '',
      initialText: '',
      initialFields: undefined,
    })
  }, [])

  const openEditNote = useCallback((noteId: string, callId: string, text: string, fields?: FieldValues) => {
    setState({
      isOpen: true,
      mode: 'edit',
      editNoteId: noteId,
      initialCallId: callId,
      initialText: text,
      initialFields: fields,
    })
  }, [])

  const close = useCallback(() => {
    setState(s => ({ ...s, isOpen: false }))
  }, [])

  return (
    <NoteSheetContext.Provider value={{ ...state, openNewNote, openEditNote, close, onSaved, setOnSaved }}>
      {children}
    </NoteSheetContext.Provider>
  )
}

export function useNoteSheet(): NoteSheetContextValue {
  const ctx = useContext(NoteSheetContext)
  if (!ctx) throw new Error('useNoteSheet must be used within NoteSheetProvider')
  return ctx
}
