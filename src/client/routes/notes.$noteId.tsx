import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { cryptoWorker } from '@/lib/crypto-worker-client'
import { MlsConversation } from '@/lib/mls/conversation'
import { useCreateNoteReply, useNoteDetail, useNoteReplies } from '@/lib/queries/notes'
import { useToast } from '@/lib/toast'
import type { NotePayload } from '@shared/types'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Lock, MessageSquare, Mic, Pencil, Send, StickyNote } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/notes/$noteId')({
  component: NoteDetailPage,
})

function NoteDetailPage() {
  const { t } = useTranslation()
  const { noteId } = Route.useParams()
  const { isAdmin } = useAuth()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  const { toast } = useToast()
  const navigate = useNavigate()

  const { data, isLoading, error } = useNoteDetail(noteId)
  const note = data?.note
  const customFields = data?.customFields ?? []
  const forbidden = error instanceof Error && error.message.includes('403')

  useEffect(() => {
    if (error && !forbidden) {
      toast(t('common.error'), 'error')
    }
  }, [error, forbidden, toast, t])

  const visibleFields = customFields.filter(
    (f) => isAdmin || f.visibleTo === 'contacts:envelope-summary'
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (forbidden) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <Lock className="mx-auto mb-3 h-8 w-8 opacity-40" />
        <p className="text-sm">{t('notes.detail.forbidden')}</p>
      </div>
    )
  }

  if (!note) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <StickyNote className="mx-auto mb-3 h-8 w-8 opacity-40" />
        <p className="text-sm">{t('notes.detail.notFound')}</p>
      </div>
    )
  }

  function handleBack() {
    if (note?.callId) {
      navigate({
        to: '/calls/$callId',
        params: { callId: note.callId },
        search: { page: 1, q: '', dateFrom: '', dateTo: '', voicemailOnly: false },
      })
    } else {
      navigate({ to: '/notes', search: { page: 1, callId: '', search: '' } })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('common.back')}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <StickyNote className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold sm:text-2xl">{t('notes.detail.title')}</h1>
        </div>
      </div>

      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle className="flex items-center justify-between text-sm font-normal">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {new Date(note.createdAt).toLocaleString()}
              </span>
              {note.isTranscription && (
                <Badge variant="secondary" className="gap-1">
                  <Mic className="h-3 w-3" />
                  {t('transcription.title')}
                </Badge>
              )}
              <Badge variant="outline" className="flex items-center gap-1 text-xs">
                <Lock className="h-3 w-3" />
                {t('notes.encryptionNote')}
              </Badge>
            </div>

            {/* Disabled edit button — editing happens from the call detail page */}
            <Button
              variant="ghost"
              size="icon-xs"
              disabled
              aria-label={t('common.edit')}
              title={t('notes.detail.editFromCallPage')}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </CardTitle>
        </CardHeader>

        <CardContent className="pt-4">
          <p className="whitespace-pre-wrap text-sm" data-testid="note-detail-content">
            {note.decrypted}
          </p>

          {/* Custom fields */}
          {note.payload.fields && visibleFields.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {visibleFields.map((field) => {
                const val = note.payload.fields?.[field.id]
                if (val === undefined || val === '') return null
                const displayVal =
                  field.type === 'checkbox' ? (val ? '\u2713' : '\u2717') : String(val)
                return (
                  <Badge key={field.id} variant="outline" className="text-xs">
                    {field.label}: {displayVal}
                  </Badge>
                )
              })}
            </div>
          )}

          {/* Call context link */}
          {note.callId && (
            <div className="mt-4 border-t pt-4">
              <p className="mb-1 text-xs text-muted-foreground">{t('notes.detail.callContext')}</p>
              <Link
                to="/calls/$callId"
                params={{ callId: note.callId }}
                search={{ page: 1, q: '', dateFrom: '', dateTo: '', voicemailOnly: false }}
                className="text-sm text-primary hover:underline"
              >
                {t('notes.detail.viewCall')}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reply thread */}
      <NoteRepliesSection noteId={noteId} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// NoteRepliesSection — reply thread below the main note
// ---------------------------------------------------------------------------

function NoteRepliesSection({ noteId }: { noteId: string }) {
  const { t } = useTranslation()
  const { hasNsec, publicKey } = useAuth()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  const { toast } = useToast()
  const [replyText, setReplyText] = useState('')

  const { data: replies = [], isLoading } = useNoteReplies(noteId)
  const createReply = useCreateNoteReply(noteId)

  async function handleSendReply() {
    if (!replyText.trim() || !hasNsec || !publicKey) return
    try {
      const payload: NotePayload = { text: replyText.trim() }
      const conv = MlsConversation.open(hubId, cryptoWorker, '')
      const plaintext = new TextEncoder().encode(JSON.stringify(payload))
      const mlsCiphertextBytes = await conv.encrypt(plaintext)
      const mlsCiphertext = Buffer.from(mlsCiphertextBytes).toString('base64')
      const mlsEpoch = await conv.currentEpoch()
      await createReply.mutateAsync({ mlsCiphertext, mlsEpoch })
      setReplyText('')
    } catch {
      toast(t('common.error', { defaultValue: 'Error' }), 'error')
    }
  }

  return (
    <div className="space-y-3" data-testid="note-replies-section">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">
          {t('notes.replies.title', { defaultValue: 'Replies' })}
        </h2>
        {replies.length > 0 && (
          <span className="text-xs text-muted-foreground">({replies.length})</span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : replies.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="note-replies-empty">
          {t('notes.replies.empty', { defaultValue: 'No replies yet.' })}
        </p>
      ) : (
        <div className="space-y-2" data-testid="note-replies-list">
          {replies.map((reply) => (
            <Card key={reply.id} className="border-l-2 border-l-primary/20">
              <CardContent className="py-2 px-3">
                <p className="text-xs text-muted-foreground mb-1">
                  <code>{reply.authorPubkey.slice(0, 12)}…</code>
                  {' · '}
                  {new Date(reply.createdAt).toLocaleString()}
                </p>
                <p className="text-sm whitespace-pre-wrap" data-testid="note-reply-content">
                  {reply.decrypted}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {hasNsec && (
        <div className="flex gap-2" data-testid="note-reply-composer">
          <Textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder={t('notes.replies.placeholder', {
              defaultValue: 'Write a reply…',
            })}
            rows={2}
            className="resize-none"
            data-testid="note-reply-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                void handleSendReply()
              }
            }}
          />
          <Button
            size="sm"
            disabled={!replyText.trim() || createReply.isPending}
            onClick={handleSendReply}
            data-testid="note-reply-send-btn"
          >
            <Send className="h-4 w-4" />
            <span className="sr-only">
              {t('notes.replies.send', { defaultValue: 'Send reply' })}
            </span>
          </Button>
        </div>
      )}
    </div>
  )
}
