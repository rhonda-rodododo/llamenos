import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import { listNotes, createNote, updateNote, type EncryptedNote } from '@/lib/api'
import { encryptNote, decryptNote } from '@/lib/crypto'

export const Route = createFileRoute('/notes')({
  component: NotesPage,
})

interface DecryptedNote extends EncryptedNote {
  decrypted: string
  isTranscription: boolean
}

function NotesPage() {
  const { t } = useTranslation()
  const { keyPair, isAdmin } = useAuth()
  const [notes, setNotes] = useState<DecryptedNote[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [newNoteCallId, setNewNoteCallId] = useState('')
  const [newNoteText, setNewNoteText] = useState('')
  const [showNewNote, setShowNewNote] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadNotes()
  }, [])

  async function loadNotes() {
    try {
      const res = await listNotes()
      const decryptedNotes: DecryptedNote[] = res.notes.map(note => {
        const isTranscription = note.authorPubkey === 'system:transcription'
        let decrypted: string
        if (isTranscription) {
          // Transcriptions are stored as plaintext (server-side, for now)
          decrypted = note.encryptedContent
        } else if (keyPair) {
          decrypted = decryptNote(note.encryptedContent, keyPair.secretKey) || '[Decryption failed]'
        } else {
          decrypted = '[No key]'
        }
        return { ...note, decrypted, isTranscription }
      })
      setNotes(decryptedNotes.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ))
    } catch {
      // handle error
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveEdit(noteId: string) {
    if (!keyPair || !editText.trim()) return
    setSaving(true)
    try {
      const note = notes.find(n => n.id === noteId)
      const encrypted = note?.isTranscription
        ? editText // Transcriptions stay as plaintext for now
        : encryptNote(editText, keyPair.secretKey)
      const res = await updateNote(noteId, { encryptedContent: encrypted })
      setNotes(prev => prev.map(n =>
        n.id === noteId ? { ...res.note, decrypted: editText, isTranscription: n.isTranscription } : n
      ))
      setEditingId(null)
      setEditText('')
    } catch {
      // handle error
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateNote() {
    if (!keyPair || !newNoteText.trim() || !newNoteCallId.trim()) return
    setSaving(true)
    try {
      const encrypted = encryptNote(newNoteText, keyPair.secretKey)
      const res = await createNote({ callId: newNoteCallId, encryptedContent: encrypted })
      setNotes(prev => [
        { ...res.note, decrypted: newNoteText, isTranscription: false },
        ...prev,
      ])
      setNewNoteText('')
      setNewNoteCallId('')
      setShowNewNote(false)
    } catch {
      // handle error
    } finally {
      setSaving(false)
    }
  }

  // Group notes by callId
  const notesByCall = notes.reduce<Record<string, DecryptedNote[]>>((acc, note) => {
    const key = note.callId
    if (!acc[key]) acc[key] = []
    acc[key].push(note)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t('notes.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('notes.encryptionNote')}</p>
        </div>
        <button
          onClick={() => setShowNewNote(!showNewNote)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('notes.newNote')}
        </button>
      </div>

      {/* New note form */}
      {showNewNote && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Call ID</label>
            <input
              value={newNoteCallId}
              onChange={e => setNewNoteCallId(e.target.value)}
              placeholder="Call ID or reference"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('notes.newNote')}</label>
            <textarea
              value={newNoteText}
              onChange={e => setNewNoteText(e.target.value)}
              placeholder={t('notes.notePlaceholder')}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreateNote}
              disabled={saving || !newNoteText.trim() || !newNoteCallId.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? t('common.loading') : t('common.save')}
            </button>
            <button
              onClick={() => setShowNewNote(false)}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-border p-8 text-center text-muted-foreground">{t('common.loading')}</div>
      ) : Object.keys(notesByCall).length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center text-muted-foreground">{t('notes.noNotes')}</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(notesByCall).map(([callId, callNotes]) => (
            <div key={callId} className="rounded-lg border border-border">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-sm font-medium">{t('notes.callWith', { number: callId.slice(0, 20) })}</h3>
              </div>
              <div className="divide-y divide-border">
                {callNotes.map(note => (
                  <div key={note.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground">
                            {new Date(note.createdAt).toLocaleString()}
                          </p>
                          {note.isTranscription && (
                            <span className="rounded-full bg-purple-900/50 px-2 py-0.5 text-xs text-purple-300">
                              {t('transcription.title')}
                            </span>
                          )}
                        </div>
                        {editingId === note.id ? (
                          <div className="mt-2">
                            <textarea
                              value={editText}
                              onChange={e => setEditText(e.target.value)}
                              rows={6}
                              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                            <div className="mt-2 flex gap-2">
                              <button
                                onClick={() => handleSaveEdit(note.id)}
                                disabled={saving}
                                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                              >
                                {saving ? t('common.loading') : t('common.save')}
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
                          onClick={() => { setEditingId(note.id); setEditText(note.decrypted) }}
                          className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                          {note.isTranscription ? t('transcription.edit') : t('common.edit')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
