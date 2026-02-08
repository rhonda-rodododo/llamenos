import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import { listNotes, createNote, updateNote, type EncryptedNote } from '@/lib/api'
import { encryptNote, decryptNote } from '@/lib/crypto'

export const Route = createFileRoute('/notes')({
  component: NotesPage,
})

function NotesPage() {
  const { t } = useTranslation()
  const { keyPair } = useAuth()
  const [notes, setNotes] = useState<(EncryptedNote & { decrypted?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  useEffect(() => {
    loadNotes()
  }, [])

  async function loadNotes() {
    try {
      const res = await listNotes()
      // Decrypt notes client-side
      const decryptedNotes = res.notes.map(note => ({
        ...note,
        decrypted: keyPair ? decryptNote(note.encryptedContent, keyPair.secretKey) || '[Decryption failed]' : '[No key]',
      }))
      setNotes(decryptedNotes)
    } catch {
      // handle error
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveEdit(noteId: string) {
    if (!keyPair || !editText.trim()) return
    const encrypted = encryptNote(editText, keyPair.secretKey)
    try {
      const res = await updateNote(noteId, { encryptedContent: encrypted })
      setNotes(prev => prev.map(n =>
        n.id === noteId
          ? { ...res.note, decrypted: editText }
          : n
      ))
      setEditingId(null)
      setEditText('')
    } catch {
      // handle error
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{t('notes.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('notes.encryptionNote')}</p>

      {loading ? (
        <div className="rounded-lg border border-border p-8 text-center text-muted-foreground">{t('common.loading')}</div>
      ) : notes.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center text-muted-foreground">{t('notes.noNotes')}</div>
      ) : (
        <div className="space-y-3">
          {notes.map(note => (
            <div key={note.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">
                    {t('notes.callWith', { number: note.callId })} &middot;{' '}
                    {new Date(note.createdAt).toLocaleString()}
                  </p>
                  {editingId === note.id ? (
                    <div className="mt-2">
                      <textarea
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        rows={4}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => handleSaveEdit(note.id)}
                          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          {t('common.save')}
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setEditText('') }}
                          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm whitespace-pre-wrap">{note.decrypted}</p>
                  )}
                </div>
                {editingId !== note.id && (
                  <button
                    onClick={() => { setEditingId(note.id); setEditText(note.decrypted || '') }}
                    className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('common.edit')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
