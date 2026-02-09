import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useNoteSheet } from '@/lib/note-sheet-context'
import { useDraft } from '@/lib/use-draft'
import { encryptNote } from '@/lib/crypto'
import { createNote, updateNote, getCallHistory, type CallRecord } from '@/lib/api'
import { useToast } from '@/lib/toast'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Lock, Save, Clock } from 'lucide-react'

export function NoteSheet() {
  const { t } = useTranslation()
  const { keyPair, isAdmin } = useAuth()
  const { isOpen, mode, editNoteId, initialCallId, initialText, close, onSaved } = useNoteSheet()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [recentCalls, setRecentCalls] = useState<CallRecord[]>([])

  const draftKey = mode === 'edit' && editNoteId ? `edit:${editNoteId}` : 'new'
  const draft = useDraft(draftKey)

  // Seed draft from initial values when sheet opens
  useEffect(() => {
    if (!isOpen) return
    if (mode === 'edit' && initialText && !draft.text) {
      draft.setText(initialText)
    }
    if (initialCallId && !draft.callId) {
      draft.setCallId(initialCallId)
    }
  }, [isOpen, mode, initialText, initialCallId])

  // Load recent calls for admin dropdown
  useEffect(() => {
    if (isAdmin && isOpen) {
      getCallHistory({ limit: 20 }).then(r => setRecentCalls(r.calls)).catch(() => {})
    }
  }, [isAdmin, isOpen])

  async function handleSave() {
    if (!keyPair || !draft.text.trim()) return
    if (mode === 'new' && !draft.callId.trim()) return
    setSaving(true)
    try {
      const encrypted = encryptNote(draft.text, keyPair.secretKey)
      if (mode === 'edit' && editNoteId) {
        await updateNote(editNoteId, { encryptedContent: encrypted })
      } else {
        await createNote({ callId: draft.callId, encryptedContent: encrypted })
      }
      draft.clearDraft()
      close()
      onSaved?.()
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }

  const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac')
  const modKey = isMac ? '⌘' : 'Ctrl'

  return (
    <Sheet open={isOpen} onOpenChange={open => { if (!open) close() }}>
      <SheetContent side="right" className="sm:max-w-[480px] flex flex-col" onKeyDown={handleKeyDown}>
        <SheetHeader>
          <SheetTitle>
            {mode === 'edit' ? t('notes.editNote') : t('notes.newNote')}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-1">
            <Lock className="h-3 w-3" />
            {t('notes.encryptionNote')}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 px-4 overflow-y-auto">
          {/* Call ID field */}
          <div className="space-y-2">
            <Label htmlFor="sheet-call-id">{t('notes.callId')}</Label>
            {initialCallId && mode === 'new' ? (
              <Badge variant="secondary" className="text-sm">{initialCallId.slice(0, 24)}</Badge>
            ) : recentCalls.length > 0 ? (
              <Select
                value={draft.callId || undefined}
                onValueChange={(v) => {
                  if (v === '__manual') {
                    draft.setCallId('')
                  } else {
                    draft.setCallId(v)
                  }
                }}
              >
                <SelectTrigger id="sheet-call-id">
                  <SelectValue placeholder={t('notes.selectCall')} />
                </SelectTrigger>
                <SelectContent>
                  {recentCalls.map(call => (
                    <SelectItem key={call.id} value={call.id}>
                      {call.callerNumber} — {new Date(call.startedAt).toLocaleString()}
                    </SelectItem>
                  ))}
                  <SelectItem value="__manual">{t('notes.enterManually')}</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="sheet-call-id"
                value={draft.callId}
                onChange={e => draft.setCallId(e.target.value)}
                placeholder={t('notes.callIdPlaceholder')}
                disabled={mode === 'edit'}
              />
            )}
          </div>

          {/* Note textarea */}
          <div className="space-y-2">
            <Label htmlFor="sheet-note-text">{mode === 'edit' ? t('notes.editNote') : t('notes.newNote')}</Label>
            <textarea
              id="sheet-note-text"
              value={draft.text}
              onChange={e => draft.setText(e.target.value)}
              placeholder={t('notes.notePlaceholder')}
              rows={8}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[120px]"
              autoFocus
            />
          </div>

          {/* Draft indicator */}
          {draft.savedAt && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {t('notes.draftSaved')} — {new Date(draft.savedAt).toLocaleTimeString()}
            </p>
          )}
        </div>

        <SheetFooter className="border-t border-border">
          <div className="flex items-center gap-2 w-full">
            <Button onClick={handleSave} disabled={saving || !draft.text.trim() || (!draft.callId.trim() && mode === 'new')}>
              <Save className="h-4 w-4" />
              {saving ? t('common.loading') : t('common.save')}
            </Button>
            <Button variant="outline" onClick={close}>
              {t('common.cancel')}
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {modKey}+Enter
            </span>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
