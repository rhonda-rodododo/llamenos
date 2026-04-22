import { Loader2, Mail, MessageSquare, Phone, Send, Star } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import type { ContactNotification, NotifyResult } from '@/lib/api'
import { notifyContacts } from '@/lib/api'

/** A channel entry from the decrypted PII blob */
export interface ContactChannel {
  type: string // 'phone' | 'email' | 'sms' | 'whatsapp' | 'signal'
  identifier: string
  preferred?: boolean
  label?: string
}

interface ContactChannelsCardProps {
  contactId: string
  channels: ContactChannel[]
  contactName: string
}

function channelIcon(type: string) {
  if (type === 'phone' || type === 'sms') return <Phone className="h-4 w-4" />
  if (type === 'email') return <Mail className="h-4 w-4" />
  return <MessageSquare className="h-4 w-4" />
}

function channelLabel(type: string): string {
  switch (type) {
    case 'phone':
      return 'Phone'
    case 'sms':
      return 'SMS'
    case 'email':
      return 'Email'
    case 'whatsapp':
      return 'WhatsApp'
    case 'signal':
      return 'Signal'
    default:
      return type.charAt(0).toUpperCase() + type.slice(1)
  }
}

export function ContactChannelsCard({
  contactId,
  channels,
  contactName,
}: ContactChannelsCardProps) {
  const { t } = useTranslation()
  const [notifyChannel, setNotifyChannel] = useState<ContactChannel | null>(null)

  if (channels.length === 0) return null

  return (
    <>
      <Card data-testid="contact-channels-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Phone className="h-4 w-4" />
            {t('contacts.channels', { defaultValue: 'Channels' })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {channels.map((ch, i) => (
            <div
              key={`${ch.type}-${ch.identifier}`}
              className="flex items-center justify-between gap-2 rounded-md border p-2"
              data-testid={`channel-${i}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                {channelIcon(ch.type)}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {ch.label || channelLabel(ch.type)}
                    </span>
                    {ch.preferred && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        <Star className="mr-0.5 h-2.5 w-2.5" />
                        {t('contacts.preferred', { defaultValue: 'Preferred' })}
                      </Badge>
                    )}
                  </div>
                  <p className="truncate font-mono text-sm">{ch.identifier}</p>
                </div>
              </div>
              {/* Only show notify for messaging-capable channels */}
              {(ch.type === 'sms' || ch.type === 'whatsapp' || ch.type === 'signal') && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  data-testid={`notify-${i}`}
                  onClick={() => setNotifyChannel(ch)}
                >
                  <Send className="mr-1 h-3.5 w-3.5" />
                  {t('contacts.notify', { defaultValue: 'Notify' })}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {notifyChannel && (
        <NotifyDialog
          open={!!notifyChannel}
          onOpenChange={(open) => {
            if (!open) setNotifyChannel(null)
          }}
          contactId={contactId}
          contactName={contactName}
          channel={notifyChannel}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// NotifyDialog — compose and send a notification to a contact via a channel
// ---------------------------------------------------------------------------

function NotifyDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  channel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactId: string
  contactName: string
  channel: ContactChannel
}) {
  const { t } = useTranslation()
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend() {
    if (!message.trim()) return
    setSending(true)
    try {
      const notification: ContactNotification = {
        contactId,
        channel: { type: channel.type, identifier: channel.identifier },
        message: message.trim(),
      }
      const response = await notifyContacts(contactId, [notification])
      const result: NotifyResult | undefined = response.results[0]
      if (result?.status === 'sent') {
        toast.success(
          t('contacts.notifySent', {
            defaultValue: 'Notification sent to {{name}}',
            name: contactName,
          })
        )
        onOpenChange(false)
        setMessage('')
      } else {
        toast.error(
          t('contacts.notifyFailed', {
            defaultValue: 'Failed to send: {{error}}',
            error: result?.error ?? 'Unknown error',
          })
        )
      }
    } catch (err) {
      toast.error(
        t('contacts.notifyFailed', {
          defaultValue: 'Failed to send: {{error}}',
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="notify-dialog">
        <DialogHeader>
          <DialogTitle>
            {t('contacts.notifyTitle', { defaultValue: 'Send Notification' })}
          </DialogTitle>
          <DialogDescription>
            {t('contacts.notifyDescription', {
              defaultValue: 'Send a message to {{name}} via {{channel}}',
              name: contactName,
              channel: channelLabel(channel.type),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md bg-muted/50 p-2 text-sm">
            {channelIcon(channel.type)}
            <span className="font-mono">{channel.identifier}</span>
          </div>
          <Textarea
            data-testid="notify-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('contacts.notifyPlaceholder', {
              defaultValue: 'Type your message...',
            })}
            rows={4}
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('common.cancel')}</Button>
          </DialogClose>
          <Button
            data-testid="notify-send-btn"
            onClick={handleSend}
            disabled={sending || !message.trim()}
          >
            {sending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1 h-4 w-4" />
            )}
            {t('common.submit', { defaultValue: 'Send' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
