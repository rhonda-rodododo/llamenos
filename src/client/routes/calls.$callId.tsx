import { LABEL_USER_PII } from '@shared/crypto-labels'
import type { NotePayload } from '@shared/types'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  Clock,
  LinkIcon,
  Mic,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  ScrollText,
  StickyNote,
  UserPlus,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContactSelect } from '@/components/contacts/contact-select'
import { CreateContactDialog } from '@/components/contacts/create-contact-dialog'
import { RecordingPlayer } from '@/components/recording-player'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type AuditLogEntry,
  type CallRecord,
  type ContactRecord,
  type EncryptedNote,
  getCallDetail,
  linkToContact,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { decryptCallRecord, decryptTranscription } from '@/lib/crypto-worker-helpers'
import { decryptObjectFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import { getMlsConversation } from '@/lib/mls/get-mls-conversation'
import { fromBase64 } from '@/lib/mls/mls-api-client'
import { useUsers } from '@/lib/queries/users'
import { useToast } from '@/lib/toast'

export const Route = createFileRoute('/calls/$callId')({
  component: CallDetailPage,
})

interface DecryptedNote extends EncryptedNote {
  decrypted: string
  payload: NotePayload
  isTranscription: boolean
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

async function decryptNoteMls(
  note: EncryptedNote,
  hubId: string,
  currentPubkey?: string | null
): Promise<NotePayload> {
  if (!note.mlsCiphertext) {
    return { text: '[Decryption failed]' }
  }

  // Self-authored notes cannot be decrypted via MLS (sender excluded).
  if (currentPubkey && note.authorPubkey === currentPubkey) {
    return { text: '[Encrypted — reload to view]' }
  }

  const unlocked = await keyManager.isUnlocked()
  if (!unlocked) {
    return { text: '[No key]' }
  }

  try {
    const conv = await getMlsConversation(hubId)
    if (!conv) return { text: '[MLS not available]' }
    const result = await conv.decrypt(fromBase64(note.mlsCiphertext))
    if (!result.message) {
      return { text: '[Decryption failed]' }
    }
    const decoded = new TextDecoder().decode(result.message)
    try {
      const parsed = JSON.parse(decoded)
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        return parsed as NotePayload
      }
    } catch {
      return { text: decoded }
    }
    return { text: decoded }
  } catch {
    return { text: '[Decryption failed]' }
  }
}

function CallDetailPage() {
  const { t } = useTranslation()
  const { callId } = Route.useParams()
  const { isAdmin, hasNsec, publicKey, hasPermission } = useAuth()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  const { toast } = useToast()
  const navigate = useNavigate()
  const canCreateContacts = hasPermission('contacts:create')
  const canLinkContacts = hasPermission('contacts:link')

  const [call, setCall] = useState<CallRecord | null>(null)
  const [notes, setNotes] = useState<DecryptedNote[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [showCreateContact, setShowCreateContact] = useState(false)
  const [showLinkExisting, setShowLinkExisting] = useState(false)
  const [linkingContact, setLinkingContact] = useState(false)

  const { data: users = [] } = useUsers()

  useEffect(() => {
    setLoading(true)
    getCallDetail(callId)
      .then(async (detail) => {
        setCall(detail.call)
        setAuditEntries(detail.auditEntries)

        const unlocked = await keyManager.isUnlocked()
        const decrypted: DecryptedNote[] = []
        for (const note of detail.notes) {
          const isTranscription = note.authorPubkey.startsWith('system:transcription')
          let payload: NotePayload
          if (isTranscription && note.ephemeralPubkey && hasNsec && unlocked) {
            const text =
              (await decryptTranscription(note.encryptedContent ?? '', note.ephemeralPubkey)) ||
              '[Decryption failed]'
            payload = { text }
          } else if (isTranscription && !note.ephemeralPubkey) {
            payload = { text: note.encryptedContent ?? '' }
          } else {
            payload = await decryptNoteMls(note, hubId)
          }
          decrypted.push({ ...note, decrypted: payload.text, payload, isTranscription })
        }
        setNotes(decrypted)
      })
      .catch(() => toast(t('common.error'), 'error'))
      .finally(() => setLoading(false))
  }, [callId, hasNsec, hubId, toast, t])

  // Decrypt call record client-side (E2EE metadata + envelope-encrypted fields)
  const [decryptedCallWithFields, setDecryptedCall] = useState<CallRecord | null>(null)
  useEffect(() => {
    if (!call || !hasNsec || !publicKey) {
      setDecryptedCall(call)
      return
    }
    void (async () => {
      const unlocked = await keyManager.isUnlocked()
      let result = { ...call }

      // Decrypt E2EE admin envelope (answeredBy, callerNumber)
      if (
        call.answeredBy === undefined &&
        call.encryptedContent &&
        call.adminEnvelopes?.length &&
        unlocked
      ) {
        const meta = await decryptCallRecord(call.encryptedContent, call.adminEnvelopes, publicKey)
        if (meta) {
          result = { ...result, answeredBy: meta.answeredBy, callerNumber: meta.callerNumber }
        }
      }

      // Decrypt ECIES envelope fields (e.g. encryptedCallerLast4 → callerLast4)
      if (unlocked) {
        await decryptObjectFields(
          result as unknown as Record<string, unknown>,
          publicKey,
          LABEL_USER_PII
        )
      }

      setDecryptedCall(result)
    })()
  }, [call, hasNsec, publicKey])

  // useUsers already decrypts name/phone in the query fn
  const nameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const v of users) map.set(v.pubkey, v.name)
    return map
  }, [users])

  async function handleLinkExisting(contactId: string | string[]) {
    const id = Array.isArray(contactId) ? contactId[0] : contactId
    if (!id) return
    setLinkingContact(true)
    try {
      await linkToContact(id, 'call', callId)
      toast(t('calls.detail.contactLinked', 'Contact linked to call'), 'success')
      setShowLinkExisting(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast(msg, 'error')
    } finally {
      setLinkingContact(false)
    }
  }

  function handleContactCreated(_contact: ContactRecord) {
    toast(t('calls.detail.contactCreated', 'Contact created and linked to call'), 'success')
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (!decryptedCallWithFields) {
    return (
      <div className="py-8 text-center text-muted-foreground">{t('calls.detail.notFound')}</div>
    )
  }

  const answeredByName = decryptedCallWithFields.answeredBy
    ? nameMap.get(decryptedCallWithFields.answeredBy) ||
      decryptedCallWithFields.answeredBy.slice(0, 8)
    : null

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() =>
            navigate({
              to: '/calls',
              search: { page: 1, q: '', dateFrom: '', dateTo: '', voicemailOnly: false },
            })
          }
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('common.back')}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <PhoneIncoming className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold sm:text-2xl">{t('calls.detail.title')}</h1>
        </div>
      </div>

      {/* Two-column layout on larger screens */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: Call metadata */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('calls.detail.metadata')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              {decryptedCallWithFields.status === 'unanswered' ? (
                <>
                  <PhoneMissed className="h-4 w-4 text-destructive" />
                  <span className="text-sm text-destructive">{t('callHistory.unanswered')}</span>
                </>
              ) : (
                <>
                  <PhoneIncoming className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {t('callHistory.answeredBy')}: {answeredByName || '-'}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>{new Date(decryptedCallWithFields.startedAt).toLocaleString()}</span>
            </div>

            {decryptedCallWithFields.duration !== undefined && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDuration(decryptedCallWithFields.duration)}
                </Badge>
              </div>
            )}

            {(() => {
              const cl4 = decryptedCallWithFields.callerLast4 ?? ''
              return cl4 && cl4 !== '[encrypted]' ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <code className="font-mono text-xs">***{cl4}</code>
                </div>
              ) : cl4 === '[encrypted]' ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <code className="font-mono text-xs">{cl4}</code>
                </div>
              ) : null
            })()}

            {decryptedCallWithFields.hasRecording && (
              <div className="pt-2">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {t('calls.detail.recording')}
                </p>
                <RecordingPlayer callId={decryptedCallWithFields.id} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Notes */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <StickyNote className="h-4 w-4" />
              {t('calls.detail.notes')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {notes.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                <StickyNote className="mx-auto mb-2 h-6 w-6 opacity-40" />
                {t('notes.noNotes')}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {notes.map((note) => (
                  <div key={note.id} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {new Date(note.createdAt).toLocaleString()}
                          </span>
                          {note.isTranscription && (
                            <Badge variant="secondary" className="gap-1">
                              <Mic className="h-3 w-3" />
                              {t('transcription.title')}
                            </Badge>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{note.decrypted}</p>
                      </div>
                      <Link
                        to="/notes/$noteId"
                        params={{ noteId: note.id }}
                        search={{ page: 1, callId: callId, search: '' }}
                        className="shrink-0 text-xs text-primary hover:underline"
                      >
                        {t('notes.permalink')}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Contact actions */}
      {(canCreateContacts || canLinkContacts) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4" />
              {t('calls.detail.contactActions', 'Contact Actions')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {canCreateContacts && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateContact(true)}
                  data-testid="call-add-contact"
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  {t('calls.detail.addAsContact', 'Add as Contact')}
                </Button>
              )}
              {canLinkContacts && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowLinkExisting(!showLinkExisting)}
                  data-testid="call-link-contact"
                >
                  <LinkIcon className="mr-2 h-4 w-4" />
                  {t('calls.detail.linkToExisting', 'Link to Existing')}
                </Button>
              )}
            </div>
            {showLinkExisting && (
              <div className="mt-3 max-w-sm">
                <ContactSelect
                  value={undefined}
                  onChange={handleLinkExisting}
                  disabled={linkingContact}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create Contact Dialog */}
      <CreateContactDialog
        open={showCreateContact}
        onOpenChange={setShowCreateContact}
        onCreated={handleContactCreated}
      />

      {/* Audit timeline (admin only) */}
      {isAdmin && auditEntries.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4" />
              {t('calls.detail.audit')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {auditEntries.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {entry.event}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {entry.details &&
                      typeof entry.details === 'object' &&
                      Object.keys(entry.details).length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {Object.entries(entry.details)
                            .filter(([k]) => k !== 'callId')
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(', ')}
                        </p>
                      )}
                    {typeof entry.details?.noteId === 'string' && (
                      <Link
                        to="/notes/$noteId"
                        params={{ noteId: entry.details.noteId }}
                        search={{ page: 1, callId: callId, search: '' }}
                        className="mt-1 block text-xs text-primary hover:underline"
                      >
                        {t('notes.viewPermalink')}
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
