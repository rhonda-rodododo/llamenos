import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState, useCallback } from 'react'
import { listNotes, createNote, updateNote, getCallHistory, type EncryptedNote, type CallRecord } from '@/lib/api'
import { useCalls } from '@/lib/hooks'
import { encryptNote, decryptNote, decryptTranscription } from '@/lib/crypto'
import { useToast } from '@/lib/toast'
import { StickyNote, Plus, Pencil, Lock, Mic, Save, X, Search, ChevronLeft, ChevronRight, Download, PhoneCall } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type NotesSearch = {
  page: number
  callId: string
  search: string
}

export const Route = createFileRoute('/notes')({
  validateSearch: (search: Record<string, unknown>): NotesSearch => ({
    page: Number(search?.page ?? 1),
    callId: (search?.callId as string) || '',
    search: (search?.search as string) || '',
  }),
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
  const navigate = useNavigate({ from: '/notes' })
  const { page, callId, search } = Route.useSearch()
  const { currentCall } = useCalls()
  const [notes, setNotes] = useState<DecryptedNote[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [newNoteCallId, setNewNoteCallId] = useState('')
  const [newNoteText, setNewNoteText] = useState('')
  const [showNewNote, setShowNewNote] = useState(false)
  const [saving, setSaving] = useState(false)
  const [recentCalls, setRecentCalls] = useState<CallRecord[]>([])
  const [searchInput, setSearchInput] = useState(search)
  const limit = 50

  // Auto-fill call ID from active call
  useEffect(() => {
    if (currentCall && !newNoteCallId) {
      setNewNoteCallId(currentCall.id)
    }
  }, [currentCall])

  // Load recent calls for the dropdown
  useEffect(() => {
    if (isAdmin) {
      getCallHistory({ limit: 20 }).then(r => setRecentCalls(r.calls)).catch(() => {})
    }
  }, [isAdmin])

  const loadNotes = useCallback(() => {
    setLoading(true)
    listNotes({ callId: callId || undefined, page, limit })
      .then(res => {
        const decryptedNotes: DecryptedNote[] = res.notes
          .filter(note => {
            if (note.authorPubkey === 'system:transcription:admin') return isAdmin
            if (note.authorPubkey === 'system:transcription') return !isAdmin
            return true
          })
          .map(note => {
            const isTranscription = note.authorPubkey.startsWith('system:transcription')
            let decrypted: string
            if (isTranscription && note.ephemeralPubkey && keyPair) {
              decrypted = decryptTranscription(note.encryptedContent, note.ephemeralPubkey, keyPair.secretKey) || '[Decryption failed]'
            } else if (isTranscription && !note.ephemeralPubkey) {
              decrypted = note.encryptedContent
            } else if (keyPair) {
              decrypted = decryptNote(note.encryptedContent, keyPair.secretKey) || '[Decryption failed]'
            } else {
              decrypted = '[No key]'
            }
            return { ...note, decrypted, isTranscription }
          })
        setNotes(decryptedNotes)
        setTotal(res.total)
      })
      .catch(() => toast(t('common.error'), 'error'))
      .finally(() => setLoading(false))
  }, [page, callId, keyPair, isAdmin])

  useEffect(() => {
    loadNotes()
  }, [loadNotes])

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
      setTotal(prev => prev + 1)
      setNewNoteText('')
      setNewNoteCallId('')
      setShowNewNote(false)
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    navigate({ search: { page: 1, callId, search: searchInput } })
  }

  function setPage(newPage: number) {
    navigate({ search: (prev) => ({ ...prev, page: newPage }) })
  }

  // Client-side search filtering (notes are decrypted client-side)
  const filteredNotes = search
    ? notes.filter(n => n.decrypted.toLowerCase().includes(search.toLowerCase()))
    : notes

  // Group notes by callId
  const notesByCall = filteredNotes.reduce<Record<string, DecryptedNote[]>>((acc, note) => {
    const key = note.callId
    if (!acc[key]) acc[key] = []
    acc[key].push(note)
    return acc
  }, {})

  const totalPages = Math.ceil(total / limit)

  async function handleExport() {
    const rows = filteredNotes.map(n => ({
      id: n.id,
      callId: n.callId,
      content: n.decrypted,
      isTranscription: n.isTranscription,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }))
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `notes-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">{t('notes.title')}</h1>
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Lock className="h-3 w-3" />
            {t('notes.encryptionNote')}
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4" />
              {t('notes.export')}
            </Button>
          )}
          <Button onClick={() => setShowNewNote(!showNewNote)}>
            <Plus className="h-4 w-4" />
            {t('notes.newNote')}
          </Button>
        </div>
      </div>

      {/* Search bar */}
      <Card>
        <CardContent className="py-3">
          <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">{t('notes.searchNotes')}</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder={t('notes.searchPlaceholder')}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" aria-label={t('a11y.searchButton')}>
                <Search className="h-4 w-4" />
              </Button>
              {(search || callId) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchInput('')
                    navigate({ search: { page: 1, callId: '', search: '' } })
                  }}
                  aria-label={t('a11y.clearFilters')}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

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
              <Label htmlFor="call-id">{t('notes.callId')}</Label>
              {recentCalls.length > 0 ? (
                <select
                  id="call-id"
                  value={newNoteCallId}
                  onChange={e => setNewNoteCallId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  <option value="">{t('notes.selectCall')}</option>
                  {recentCalls.map(call => (
                    <option key={call.id} value={call.id}>
                      {call.callerNumber} — {new Date(call.startedAt).toLocaleString()}
                    </option>
                  ))}
                  <option value="__manual">{t('notes.enterManually')}</option>
                </select>
              ) : (
                <Input
                  id="call-id"
                  value={newNoteCallId}
                  onChange={e => setNewNoteCallId(e.target.value)}
                  placeholder={t('notes.callIdPlaceholder')}
                />
              )}
              {newNoteCallId === '__manual' && (
                <Input
                  value=""
                  onChange={e => setNewNoteCallId(e.target.value)}
                  placeholder={t('notes.callIdPlaceholder')}
                />
              )}
              {currentCall && newNoteCallId === currentCall.id && (
                <p className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                  <PhoneCall className="h-3 w-3" />
                  {t('notes.activeCallNote')}
                </p>
              )}
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
              <Button onClick={handleCreateNote} disabled={saving || !newNoteText.trim() || !newNoteCallId.trim() || newNoteCallId === '__manual'}>
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
              {search ? t('notes.noSearchResults') : t('notes.noNotes')}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(notesByCall).map(([cId, callNotes]) => (
            <Card key={cId}>
              <CardHeader className="border-b py-3">
                <CardTitle className="text-sm">{t('notes.callWith', { number: cId.slice(0, 20) })}</CardTitle>
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
                          aria-label={t('a11y.editItem')}
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            {t('common.back')}
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
          >
            {t('common.next')}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
