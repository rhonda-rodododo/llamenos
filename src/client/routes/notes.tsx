import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import { listNotes, createNote, updateNote, type EncryptedNote } from '@/lib/api'
import { encryptNote, decryptNote, decryptTranscription } from '@/lib/crypto'
import { useToast } from '@/lib/toast'
import { StickyNote, Plus, Pencil, Lock, Mic, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
  const { toast } = useToast()
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
      const decryptedNotes: DecryptedNote[] = res.notes
        .filter(note => {
          // Admin copies of transcriptions (system:transcription:admin) are only shown to admin
          if (note.authorPubkey === 'system:transcription:admin') {
            return isAdmin
          }
          // Regular transcriptions are shown to the volunteer (not admin, who uses the :admin copy)
          if (note.authorPubkey === 'system:transcription') {
            return !isAdmin
          }
          return true
        })
        .map(note => {
          const isTranscription = note.authorPubkey.startsWith('system:transcription')
          let decrypted: string
          if (isTranscription && note.ephemeralPubkey && keyPair) {
            decrypted = decryptTranscription(note.encryptedContent, note.ephemeralPubkey, keyPair.secretKey) || '[Decryption failed]'
          } else if (isTranscription && !note.ephemeralPubkey) {
            // Legacy plaintext transcription (pre-E2EE)
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
      toast(t('common.error'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveEdit(noteId: string) {
    if (!keyPair || !editText.trim()) return
    setSaving(true)
    try {
      const encrypted = encryptNote(editText, keyPair.secretKey)
      const res = await updateNote(noteId, { encryptedContent: encrypted })
      setNotes(prev => prev.map(n =>
        n.id === noteId ? { ...res.note, decrypted: editText, isTranscription: n.isTranscription } : n
      ))
      setEditingId(null)
      setEditText('')
    } catch {
      toast(t('common.error'), 'error')
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
      toast(t('common.error'), 'error')
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
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Lock className="h-3 w-3" />
            {t('notes.encryptionNote')}
          </p>
        </div>
        <Button onClick={() => setShowNewNote(!showNewNote)}>
          <Plus className="h-4 w-4" />
          {t('notes.newNote')}
        </Button>
      </div>

      {/* New note form */}
      {showNewNote && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <StickyNote className="h-4 w-4 text-muted-foreground" />
              {t('notes.newNote')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="call-id">Call ID</Label>
              <Input
                id="call-id"
                value={newNoteCallId}
                onChange={e => setNewNoteCallId(e.target.value)}
                placeholder="Call ID or reference"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('notes.newNote')}</Label>
              <textarea
                value={newNoteText}
                onChange={e => setNewNoteText(e.target.value)}
                placeholder={t('notes.notePlaceholder')}
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreateNote} disabled={saving || !newNoteText.trim() || !newNoteCallId.trim()}>
                <Save className="h-4 w-4" />
                {saving ? t('common.loading') : t('common.save')}
              </Button>
              <Button variant="outline" onClick={() => setShowNewNote(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardContent className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : Object.keys(notesByCall).length === 0 ? (
        <Card>
          <CardContent>
            <div className="py-8 text-center text-muted-foreground">
              <StickyNote className="mx-auto mb-2 h-8 w-8 opacity-40" />
              {t('notes.noNotes')}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(notesByCall).map(([callId, callNotes]) => (
            <Card key={callId}>
              <CardHeader className="border-b py-3">
                <CardTitle className="text-sm">{t('notes.callWith', { number: callId.slice(0, 20) })}</CardTitle>
              </CardHeader>
              <CardContent className="p-0 divide-y divide-border">
                {callNotes.map(note => (
                  <div key={note.id} className="px-6 py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground">
                            {new Date(note.createdAt).toLocaleString()}
                          </p>
                          {note.isTranscription && (
                            <Badge variant="secondary">
                              <Mic className="h-3 w-3" />
                              {t('transcription.title')}
                            </Badge>
                          )}
                        </div>
                        {editingId === note.id ? (
                          <div className="mt-2 space-y-2">
                            <textarea
                              value={editText}
                              onChange={e => setEditText(e.target.value)}
                              rows={6}
                              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => handleSaveEdit(note.id)} disabled={saving}>
                                <Save className="h-3.5 w-3.5" />
                                {saving ? t('common.loading') : t('common.save')}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setEditText('') }}>
                                <X className="h-3.5 w-3.5" />
                                {t('common.cancel')}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-2 text-sm whitespace-pre-wrap">{note.decrypted}</p>
                        )}
                      </div>
                      {editingId !== note.id && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => { setEditingId(note.id); setEditText(note.decrypted) }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
