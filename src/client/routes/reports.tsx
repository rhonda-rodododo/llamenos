import { FilePreview } from '@/components/FilePreview'
import { FileUpload } from '@/components/FileUpload'
import { ReportForm } from '@/components/ReportForm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Report } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import {
  useAssignReport,
  useReportMessages,
  useReports,
  useSendReportMessage,
  useUpdateReport,
} from '@/lib/queries/reports'
import { useToast } from '@/lib/toast'
import { encryptMessage } from '@shared/crypto-envelopes'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Lock,
  Paperclip,
  Plus,
  Send,
  UserCheck,
  X,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/reports')({
  component: ReportsPage,
})

function ReportsPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const reportsQuery = useReports({ status: statusFilter, category: categoryFilter })
  const reports = reportsQuery.data ?? []
  const loading = reportsQuery.isLoading

  const selectedReport = reports.find((r) => r.id === selectedId)

  const handleReportCreated = useCallback(
    (reportId: string) => {
      void reportsQuery.refetch().then(() => setSelectedId(reportId))
    },
    [reportsQuery]
  )

  const showEmptyState = !loading && reports.length === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold sm:text-2xl">
            {t('reports.title', { defaultValue: 'Reports' })}
          </h1>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5" />
          {t('reports.new', { defaultValue: 'New' })}
        </Button>
      </div>

      {showEmptyState ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              {t('reports.noReports', { defaultValue: 'No reports' })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('reports.noReportsHint', {
                defaultValue: 'Reports submitted by users will appear here.',
              })}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex h-[calc(100vh-12rem)] gap-4">
          {/* Report list sidebar */}
          <div className="w-80 shrink-0 overflow-y-auto rounded-lg border border-border bg-card">
            <div className="sticky top-0 z-10 border-b border-border bg-card p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {t('reports.title', { defaultValue: 'Reports' })}
                </h2>
              </div>

              {isAdmin && (
                <div className="flex gap-2">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger size="sm" className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t('reports.allStatuses', { defaultValue: 'All statuses' })}
                      </SelectItem>
                      <SelectItem value="waiting">
                        {t('reports.statusWaiting', { defaultValue: 'Waiting' })}
                      </SelectItem>
                      <SelectItem value="active">
                        {t('reports.statusActive', { defaultValue: 'Active' })}
                      </SelectItem>
                      <SelectItem value="closed">
                        {t('reports.statusClosed', { defaultValue: 'Closed' })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger size="sm" className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t('reports.allCategories', { defaultValue: 'All categories' })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="p-2 space-y-1.5">
                {reports.map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    isSelected={selectedId === report.id}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Report detail */}
          <div className="flex flex-1 flex-col rounded-lg border border-border bg-card overflow-hidden">
            {selectedReport ? (
              <ReportDetail report={selectedReport} isAdmin={isAdmin} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
                <FileText className="h-10 w-10 mb-3" />
                <p>
                  {t('reports.selectReport', { defaultValue: 'Select a report to view details' })}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <ReportForm open={showForm} onOpenChange={setShowForm} onCreated={handleReportCreated} />
    </div>
  )
}

function ReportCard({
  report,
  isSelected,
  onSelect,
}: {
  report: Report
  isSelected: boolean
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()

  const statusIcon =
    report.status === 'active' ? (
      <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
    ) : report.status === 'waiting' ? (
      <span className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-500" />
    ) : (
      <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-400" />
    )

  const relativeTime = formatRelativeTime(report.lastMessageAt, t)

  return (
    <button
      type="button"
      onClick={() => onSelect(report.id)}
      className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
          : 'border-border bg-card hover:bg-accent/50'
      }`}
    >
      <div className="flex items-center gap-2">
        {statusIcon}
        <span className="truncate text-sm font-medium text-foreground flex-1">
          {report.metadata?.reportTitle ||
            t('reports.untitled', { defaultValue: 'Untitled Report' })}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Clock className="h-3 w-3" />
          {relativeTime}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {report.metadata?.reportCategory && (
          <Badge variant="secondary" className="text-[10px]">
            {report.metadata.reportCategory}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {report.messageCount} {t('reports.messagesLabel', { defaultValue: 'messages' })}
        </span>
      </div>
    </button>
  )
}

function ReportDetail({
  report,
  isAdmin,
}: {
  report: Report
  isAdmin: boolean
}) {
  const { t } = useTranslation()
  const { hasNsec, publicKey, hasPermission, adminDecryptionPubkey } = useAuth()
  const { toast } = useToast()

  const [replyText, setReplyText] = useState('')
  const [showFileUpload, setShowFileUpload] = useState(false)

  const messagesQuery = useReportMessages(report.id)
  const { messages = [], decryptedContent = new Map() } = messagesQuery.data ?? {}
  const messagesLoading = messagesQuery.isLoading

  const sendMutation = useSendReportMessage(report.id)
  const assignMutation = useAssignReport()
  const closeMutation = useUpdateReport()

  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollTop = node.scrollHeight
  }, [])

  const handleAssign = useCallback(async () => {
    if (!publicKey) return
    try {
      await assignMutation.mutateAsync({ reportId: report.id, pubkey: publicKey })
      toast(t('reports.assigned', { defaultValue: 'Report assigned to you' }))
    } catch {
      toast(t('reports.assignError', { defaultValue: 'Failed to assign report' }), 'error')
    }
  }, [publicKey, report.id, assignMutation, toast, t])

  const handleClose = useCallback(async () => {
    try {
      await closeMutation.mutateAsync({ reportId: report.id, data: { status: 'closed' } })
      toast(t('reports.closed', { defaultValue: 'Report closed' }))
    } catch {
      toast(t('reports.closeError', { defaultValue: 'Failed to close report' }), 'error')
    }
  }, [report.id, closeMutation, toast, t])

  const handleSendReply = useCallback(async () => {
    if (!replyText.trim() || !hasNsec || !publicKey) return

    const readerPubkeys = [publicKey]
    if (adminDecryptionPubkey && adminDecryptionPubkey !== publicKey) {
      readerPubkeys.push(adminDecryptionPubkey)
    }

    const encrypted = encryptMessage(replyText.trim(), readerPubkeys)

    try {
      await sendMutation.mutateAsync({
        encryptedContent: encrypted.encryptedContent,
        readerEnvelopes: encrypted.readerEnvelopes,
      })
      setReplyText('')
    } catch {
      toast(t('reports.sendError', { defaultValue: 'Failed to send message' }), 'error')
    }
  }, [replyText, hasNsec, publicKey, adminDecryptionPubkey, sendMutation, toast, t])

  const handleFileUploadComplete = useCallback(
    async (fileIds: string[]) => {
      if (!hasNsec || !publicKey) return

      const readerPubkeys = [publicKey]
      if (adminDecryptionPubkey && adminDecryptionPubkey !== publicKey) {
        readerPubkeys.push(adminDecryptionPubkey)
      }

      const placeholder = t('reports.filesAttached', {
        defaultValue: '[Files attached]',
        count: fileIds.length,
      })
      const encrypted = encryptMessage(placeholder, readerPubkeys)

      try {
        await sendMutation.mutateAsync({
          encryptedContent: encrypted.encryptedContent,
          readerEnvelopes: encrypted.readerEnvelopes,
          attachmentIds: fileIds,
        })
        setShowFileUpload(false)
      } catch {
        toast(t('reports.sendError', { defaultValue: 'Failed to send message' }), 'error')
      }
    },
    [hasNsec, publicKey, adminDecryptionPubkey, sendMutation, toast, t]
  )

  const isReporter = hasPermission('reports:create') && !hasPermission('calls:answer')
  const canReply = report.status === 'active' || isReporter
  const sending = sendMutation.isPending

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {report.metadata?.reportTitle ||
              t('reports.untitled', { defaultValue: 'Untitled Report' })}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            {t('reports.e2ee', { defaultValue: 'End-to-end encrypted' })}
            {report.metadata?.reportCategory && (
              <>
                <span className="mx-1">·</span>
                <Badge variant="secondary" className="text-[10px]">
                  {report.metadata.reportCategory}
                </Badge>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {report.status === 'waiting' && (isAdmin || hasPermission('calls:answer')) && (
            <Button size="sm" onClick={handleAssign}>
              <UserCheck className="h-3.5 w-3.5" />
              {t('reports.claim', { defaultValue: 'Claim' })}
            </Button>
          )}
          {report.status === 'active' && isAdmin && (
            <Button size="sm" variant="outline" data-testid="close-report" onClick={handleClose}>
              <X className="h-3.5 w-3.5" />
              {t('reports.closeReport', { defaultValue: 'Close' })}
            </Button>
          )}
          <ReportStatusBadge status={report.status} />
        </div>
      </div>

      {/* Messages thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messagesLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {t('reports.noMessages', { defaultValue: 'No messages yet' })}
          </div>
        ) : (
          messages.map((msg) => {
            const isInbound = msg.direction === 'inbound'
            const text = decryptedContent.get(msg.id)

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
                    {text === undefined ? (
                      <span className="italic text-muted-foreground">
                        {t('reports.encrypted', { defaultValue: '[Encrypted]' })}
                      </span>
                    ) : (
                      text
                    )}
                  </p>

                  {/* Inline file attachments */}
                  {msg.hasAttachments && msg.attachmentIds && msg.attachmentIds.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {msg.attachmentIds.map((fileId) => (
                        <FilePreview key={fileId} fileId={fileId} />
                      ))}
                    </div>
                  )}

                  <div
                    className={`mt-1 flex items-center gap-1.5 text-xs ${
                      isInbound ? 'text-muted-foreground' : 'text-primary-foreground/70'
                    }`}
                  >
                    <Lock className="h-3 w-3" />
                    <span>{formatTimestamp(msg.createdAt)}</span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* File upload area */}
      {showFileUpload && hasNsec && publicKey && (
        <div className="border-t border-border px-4 py-3">
          <FileUpload
            conversationId={report.id}
            recipientPubkeys={[
              publicKey,
              ...(adminDecryptionPubkey && adminDecryptionPubkey !== publicKey
                ? [adminDecryptionPubkey]
                : []),
            ]}
            onUploadComplete={handleFileUploadComplete}
          />
        </div>
      )}

      {/* Composer */}
      {canReply && (
        <div className="border-t border-border bg-background px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span>
              {t('notes.encryptionNote', { defaultValue: 'Notes are encrypted end-to-end' })}
            </span>
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowFileUpload((prev) => !prev)}
              aria-label={t('reports.attachFile', { defaultValue: 'Attach file' })}
              className="shrink-0 text-muted-foreground"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void handleSendReply()
                }
              }}
              placeholder={t('reports.replyPlaceholder', { defaultValue: 'Type your reply...' })}
              rows={1}
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button
              size="icon-sm"
              disabled={!replyText.trim() || sending}
              onClick={() => void handleSendReply()}
              aria-label={t('common.submit')}
              className="shrink-0"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

function ReportStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()

  if (status === 'active') {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3 text-green-500" />
        {t('reports.statusActive', { defaultValue: 'Active' })}
      </Badge>
    )
  }
  if (status === 'waiting') {
    return (
      <Badge variant="secondary" className="gap-1">
        <AlertCircle className="h-3 w-3 text-yellow-500" />
        {t('reports.statusWaiting', { defaultValue: 'Waiting' })}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="gap-1 text-muted-foreground">
      {t('reports.statusClosed', { defaultValue: 'Closed' })}
    </Badge>
  )
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

function formatRelativeTime(
  iso: string,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffMs = now - then

  if (diffMs < 0) return t('conversations.justNow', { defaultValue: 'just now' })

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return t('conversations.justNow', { defaultValue: 'just now' })

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return t('conversations.minutesAgo', { count: minutes, defaultValue: '{{count}}m ago' })

  const hours = Math.floor(minutes / 60)
  if (hours < 24)
    return t('conversations.hoursAgo', { count: hours, defaultValue: '{{count}}h ago' })

  const days = Math.floor(hours / 24)
  return t('conversations.daysAgo', { count: days, defaultValue: '{{count}}d ago' })
}
