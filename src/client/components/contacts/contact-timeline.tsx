import { FileText, MessageSquare, Phone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type TimelineEntry =
  | { kind: 'call'; id: string; timestamp: string; data: Record<string, unknown> }
  | { kind: 'conversation'; id: string; timestamp: string; data: Record<string, unknown> }
  | { kind: 'note'; id: string; timestamp: string; data: Record<string, unknown> }

function toTimestamp(item: Record<string, unknown>): string {
  return (
    (item.createdAt as string) ||
    (item.startedAt as string) ||
    (item.updatedAt as string) ||
    new Date(0).toISOString()
  )
}

function coerceEntries(items: unknown[], kind: 'call' | 'conversation' | 'note'): TimelineEntry[] {
  return (items as Record<string, unknown>[]).map((item) => ({
    kind,
    id: (item.id as string) ?? '',
    timestamp: toTimestamp(item),
    data: item,
  }))
}

interface ContactTimelineProps {
  calls: unknown[]
  conversations: unknown[]
  notes: unknown[]
}

const KIND_COLORS = {
  call: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  conversation: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  note: 'bg-green-500/10 text-green-500 border-green-500/20',
} as const

const KIND_ICONS = {
  call: Phone,
  conversation: MessageSquare,
  note: FileText,
} as const

function summarise(entry: TimelineEntry): string {
  const d = entry.data
  if (entry.kind === 'call') {
    const duration = d.duration as number | undefined
    const status = d.status as string | undefined
    const parts: string[] = []
    if (status) parts.push(status)
    if (duration != null) parts.push(`${duration}s`)
    return parts.join(' · ') || '—'
  }
  if (entry.kind === 'conversation') {
    const channel = d.channel as string | undefined
    const status = d.status as string | undefined
    const parts: string[] = []
    if (channel) parts.push(channel)
    if (status) parts.push(status)
    return parts.join(' · ') || '—'
  }
  // note
  const authorPubkey = d.authorPubkey as string | undefined
  if (authorPubkey) return `${authorPubkey.slice(0, 8)}…`
  return '—'
}

export function ContactTimeline({ calls, conversations, notes }: ContactTimelineProps) {
  const { t } = useTranslation()

  const entries: TimelineEntry[] = [
    ...coerceEntries(calls, 'call'),
    ...coerceEntries(conversations, 'conversation'),
    ...coerceEntries(notes, 'note'),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return (
    <Card data-testid="contact-timeline-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('contacts.timeline')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {entries.length === 0 ? (
          <div className="px-6 pb-6 text-sm text-muted-foreground">
            {t('common.noData', { defaultValue: 'No activity yet' })}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {entries.map((entry) => {
              const Icon = KIND_ICONS[entry.kind]
              return (
                <div
                  key={`${entry.kind}-${entry.id}`}
                  data-testid="timeline-entry"
                  className="flex items-start gap-3 px-4 py-3 sm:px-6"
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] capitalize ${KIND_COLORS[entry.kind]}`}
                      >
                        {entry.kind}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {summarise(entry)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
