import { ArrowDown, Loader2, Lock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageStatusIcon } from '@/components/MessageStatusIcon'
import type { ConversationMessage } from '@/lib/api'

interface ConversationThreadProps {
  conversationId: string
  messages: ConversationMessage[]
  isLoading: boolean
  /** Pre-decrypted message content from React Query queryFn. Keyed by message ID. */
  decryptedContent?: Map<string, string>
}

export function ConversationThread({
  conversationId: _conversationId,
  messages,
  isLoading,
  decryptedContent = new Map(),
}: ConversationThreadProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)

  // Auto-scroll to bottom when new messages arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages is used as a trigger to run this effect when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Track scroll position to show/hide scroll-down button
  function handleScroll() {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    setShowScrollDown(scrollHeight - scrollTop - clientHeight > 100)
  }

  function scrollToBottom() {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }

  function formatTimestamp(iso: string): string {
    const date = new Date(iso)
    const now = new Date()
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()

    if (isToday) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (isLoading) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-8"
        data-testid="conversation-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground"
        data-testid="conversation-empty"
      >
        {t('conversations.noMessages', 'No messages yet')}
      </div>
    )
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      >
        {messages.map((msg) => {
          const isInbound = msg.direction === 'inbound'
          const text = decryptedContent.get(msg.id)
          const isEncrypted = text === undefined

          return (
            <div key={msg.id} className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                  isInbound
                    ? 'bg-muted text-foreground rounded-bl-md'
                    : 'bg-primary text-primary-foreground rounded-br-md'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap break-words">
                  {isEncrypted ? (
                    <span className="italic text-muted-foreground">
                      {t('conversations.encrypted', '[Encrypted]')}
                    </span>
                  ) : (
                    text
                  )}
                </p>
                <div
                  className={`mt-1 flex items-center gap-1.5 text-xs ${
                    isInbound ? 'text-muted-foreground' : 'text-primary-foreground/70'
                  }`}
                >
                  <Lock className="h-3 w-3" />
                  <span>{formatTimestamp(msg.createdAt)}</span>
                  {isInbound ? (
                    <ArrowDown className="h-3 w-3" />
                  ) : (
                    <>
                      <MessageStatusIcon
                        status={msg.deliveryStatus ?? msg.status}
                        error={msg.deliveryError ?? msg.failureReason}
                      />
                      {(msg.deliveryStatus === 'failed' || msg.status === 'failed') &&
                        (msg.deliveryError ?? msg.failureReason) && (
                          <span
                            className="text-red-400 truncate max-w-[100px]"
                            title={msg.deliveryError ?? msg.failureReason ?? undefined}
                          >
                            {t('conversations.failed', 'Failed')}
                          </span>
                        )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Scroll to bottom button */}
      {showScrollDown && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-background border border-border shadow-md p-2 hover:bg-muted transition-colors"
          aria-label={t('conversations.scrollToBottom', 'Scroll to bottom')}
        >
          <ArrowDown className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}
