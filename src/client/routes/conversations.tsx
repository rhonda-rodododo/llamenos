import { ChannelBadge } from '@/components/ChannelBadge'
import { ConversationList } from '@/components/ConversationList'
import { ConversationThread } from '@/components/ConversationThread'
import { MessageComposer } from '@/components/MessageComposer'
import { ReassignDialog } from '@/components/ReassignDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { useConversations } from '@/lib/hooks'
import {
  useClaimConversation,
  useConversationMessages,
  useSendConversationMessage,
  useUpdateConversation,
} from '@/lib/queries/conversations'
import { useToast } from '@/lib/toast'
import { useDecryptedArray } from '@/lib/use-decrypted'
import { encryptMessage } from '@shared/crypto-envelopes'
import { createFileRoute } from '@tanstack/react-router'
import { Lock, MessageSquare, UserCheck, UserCog, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/conversations')({
  component: ConversationsPage,
})

function ConversationsPage() {
  const { t } = useTranslation()
  const { isAdmin, hasNsec, publicKey, adminDecryptionPubkey } = useAuth()
  const { channels } = useConfig()
  const { toast } = useToast()
  const { conversations: rawConversations, waitingConversations } = useConversations()
  const conversations = useDecryptedArray(rawConversations)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reassignOpen, setReassignOpen] = useState(false)

  const selectedConv = conversations.find((c) => c.id === selectedId)

  const messagesQuery = useConversationMessages(selectedId)
  const { messages = [], decryptedContent = new Map<string, string>() } = messagesQuery.data ?? {}
  const messagesLoading = messagesQuery.isLoading

  const claimMutation = useClaimConversation()
  const closeMutation = useUpdateConversation()
  const sendMutation = useSendConversationMessage(selectedId ?? '')

  const handleClaim = useCallback(
    async (convId: string) => {
      try {
        await claimMutation.mutateAsync(convId)
        toast(t('conversations.claimed', { defaultValue: 'Conversation claimed' }))
      } catch {
        toast(
          t('conversations.claimError', { defaultValue: 'Failed to claim conversation' }),
          'error'
        )
      }
    },
    [claimMutation, t, toast]
  )

  const handleClose = useCallback(
    async (convId: string) => {
      try {
        await closeMutation.mutateAsync({ conversationId: convId, data: { status: 'closed' } })
        if (selectedId === convId) setSelectedId(null)
        toast(t('conversations.closed', { defaultValue: 'Conversation closed' }))
      } catch {
        toast(
          t('conversations.closeError', { defaultValue: 'Failed to close conversation' }),
          'error'
        )
      }
    },
    [closeMutation, selectedId, t, toast]
  )

  // Encrypt and send a message using envelope pattern
  const handleComposerSend = useCallback(
    async (plaintext: string) => {
      if (!selectedId || !hasNsec || !publicKey) return

      const readerPubkeys = [publicKey]
      if (adminDecryptionPubkey && adminDecryptionPubkey !== publicKey) {
        readerPubkeys.push(adminDecryptionPubkey)
      }

      const encrypted = encryptMessage(plaintext, readerPubkeys)

      try {
        await sendMutation.mutateAsync({
          encryptedContent: encrypted.encryptedContent,
          readerEnvelopes: encrypted.readerEnvelopes,
          plaintextForSending: plaintext,
        })
      } catch {
        toast(t('conversations.sendError', { defaultValue: 'Failed to send message' }), 'error')
      }
    },
    [selectedId, hasNsec, publicKey, adminDecryptionPubkey, sendMutation, t, toast]
  )

  const hasAnyMessaging = channels.sms || channels.whatsapp || channels.signal || channels.reports

  if (!hasAnyMessaging) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold sm:text-2xl">
            {t('conversations.title', { defaultValue: 'Conversations' })}
          </h1>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">
            {t('conversations.noChannels', { defaultValue: 'No messaging channels enabled' })}
          </h2>
          <p className="text-muted-foreground max-w-md">
            {t('conversations.noChannelsDescription', {
              defaultValue:
                'Enable SMS, WhatsApp, Signal, or Reports in Hub Settings to start receiving messages.',
            })}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <MessageSquare className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-bold sm:text-2xl">
          {t('conversations.title', { defaultValue: 'Conversations' })}
        </h1>
      </div>
      <div className="flex h-[calc(100vh-12rem)] gap-4">
        {/* Conversation list sidebar */}
        <div className="w-80 shrink-0 overflow-y-auto rounded-lg border border-border bg-card">
          <div className="sticky top-0 z-10 border-b border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                {t('conversations.title', { defaultValue: 'Conversations' })}
              </h2>
              <div className="flex gap-1">
                {waitingConversations.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {waitingConversations.length}{' '}
                    {t('conversations.waiting', { defaultValue: 'waiting' })}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <ConversationList
            conversations={conversations}
            onSelect={setSelectedId}
            selectedId={selectedId ?? undefined}
          />
        </div>

        {/* Conversation detail */}
        <div className="flex flex-1 flex-col rounded-lg border border-border bg-card overflow-hidden">
          {selectedConv ? (
            <>
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-3">
                  <ChannelBadge channelType={selectedConv.channelType} />
                  <div>
                    <p className="font-medium">
                      {(() => {
                        const cl4 = selectedConv.contactLast4 ?? ''
                        return cl4 && cl4 !== '[encrypted]'
                          ? `...${cl4}`
                          : cl4 === '[encrypted]'
                            ? cl4
                            : t('conversations.unknownContact', { defaultValue: 'Unknown' })
                      })()}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      {t('conversations.e2ee', { defaultValue: 'End-to-end encrypted' })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedConv.status === 'waiting' && (
                    <Button size="sm" onClick={() => void handleClaim(selectedConv.id)}>
                      <UserCheck className="h-3.5 w-3.5 mr-1" />
                      {t('conversations.claim', { defaultValue: 'Claim' })}
                    </Button>
                  )}
                  {isAdmin &&
                    (selectedConv.status === 'active' || selectedConv.status === 'waiting') && (
                      <Button size="sm" variant="outline" onClick={() => setReassignOpen(true)}>
                        <UserCog className="h-3.5 w-3.5 mr-1" />
                        {t('conversations.reassign', { defaultValue: 'Reassign' })}
                      </Button>
                    )}
                  {selectedConv.status === 'active' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleClose(selectedConv.id)}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      {t('conversations.close', { defaultValue: 'Close' })}
                    </Button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-hidden">
                <ConversationThread
                  conversationId={selectedConv.id}
                  messages={messages}
                  isLoading={messagesLoading}
                  decryptedContent={decryptedContent}
                />
              </div>

              {/* Composer */}
              {selectedConv.status === 'active' && (
                <div className="border-t border-border p-3">
                  <MessageComposer
                    onSend={handleComposerSend}
                    disabled={!selectedConv.assignedTo}
                    channelType={selectedConv.channelType}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
              <MessageSquare className="h-10 w-10 mb-3" />
              <p>
                {t('conversations.selectConversation', {
                  defaultValue: 'Select a conversation to view messages',
                })}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Reassign Dialog */}
      {selectedConv && (
        <ReassignDialog
          conversation={selectedConv}
          open={reassignOpen}
          onOpenChange={setReassignOpen}
        />
      )}
    </div>
  )
}
