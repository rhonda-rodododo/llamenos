import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth'
import { useIntake, useUpdateIntakeStatus } from '@/lib/queries/intakes'
import { useToast } from '@/lib/toast'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle2, ClipboardList, Eye, Lock, Merge, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/intakes_/$intakeId')({
  component: IntakeDetailPage,
})

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  reviewed: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  merged: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  dismissed: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={STATUS_COLORS[status] ?? ''}
      data-testid="intake-status-badge"
    >
      {status}
    </Badge>
  )
}

function IntakeDetailPage() {
  const { t } = useTranslation()
  const { intakeId } = Route.useParams()
  const { hasPermission } = useAuth()
  const { toast } = useToast()
  const canTriage = hasPermission('contacts:triage')

  const { data: intake, isLoading, error } = useIntake(intakeId)
  const updateStatus = useUpdateIntakeStatus()

  function handleStatusUpdate(status: 'reviewed' | 'merged' | 'dismissed') {
    if (!intake) return
    updateStatus.mutate(
      { id: intake.id, status },
      {
        onSuccess: () => {
          toast(t('intakes.statusUpdated', { defaultValue: 'Intake status updated' }))
        },
        onError: () => {
          toast(t('intakes.updateError', { defaultValue: 'Failed to update intake' }), 'error')
        },
      }
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="intake-detail-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || !intake) {
    return (
      <div className="space-y-6">
        <BackLink />
        <div
          className="py-16 text-center text-muted-foreground"
          data-testid="intake-detail-not-found"
        >
          <ClipboardList className="mx-auto mb-3 h-8 w-8 opacity-40" />
          <p className="text-sm">{t('intakes.notFound', { defaultValue: 'Intake not found' })}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6" data-testid="intake-detail-page">
      <div className="flex items-center gap-3">
        <BackLink />
        <div className="flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold sm:text-2xl">
            {t('intakes.detailTitle', { defaultValue: 'Intake Detail' })}
          </h1>
        </div>
        <StatusBadge status={intake.status} />
      </div>

      <Card data-testid="intake-detail-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            {t('intakes.detailTitle', { defaultValue: 'Intake Detail' })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <span className="text-muted-foreground">
                {t('intakes.submittedBy', { defaultValue: 'Submitted by' })}:
              </span>{' '}
              <code className="text-xs">{intake.submittedBy.slice(0, 12)}...</code>
            </div>
            <div>
              <span className="text-muted-foreground">
                {t('intakes.createdAt', { defaultValue: 'Created' })}:
              </span>{' '}
              {new Date(intake.createdAt).toLocaleString()}
            </div>
            {intake.contactId && (
              <div>
                <span className="text-muted-foreground">
                  {t('intakes.linkedContact', { defaultValue: 'Linked contact' })}:
                </span>{' '}
                <Link
                  to="/contacts/$contactId"
                  params={{ contactId: intake.contactId }}
                  className="text-primary hover:underline"
                  data-testid="intake-detail-contact-link"
                >
                  <code className="text-xs">{intake.contactId.slice(0, 12)}...</code>
                </Link>
              </div>
            )}
            {intake.callId && (
              <div>
                <span className="text-muted-foreground">
                  {t('intakes.linkedCall', { defaultValue: 'Linked call' })}:
                </span>{' '}
                <Link
                  to="/calls/$callId"
                  params={{ callId: intake.callId }}
                  search={{ page: 1, q: '', dateFrom: '', dateTo: '', voicemailOnly: false }}
                  className="text-primary hover:underline"
                  data-testid="intake-detail-call-link"
                >
                  <code className="text-xs">{intake.callId.slice(0, 12)}...</code>
                </Link>
              </div>
            )}
            {intake.reviewedBy && (
              <div>
                <span className="text-muted-foreground">
                  {t('intakes.reviewedByLabel', { defaultValue: 'Reviewed by' })}:
                </span>{' '}
                <code className="text-xs">{intake.reviewedBy.slice(0, 12)}...</code>
              </div>
            )}
          </div>

          <div className="border-t pt-4" data-testid="intake-detail-payload">
            <div className="flex items-center gap-2 mb-2">
              <Lock className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {t('intakes.encryptedNote', { defaultValue: 'Payload is end-to-end encrypted' })}
              </span>
            </div>
            {intake.decryptedPayload ? (
              <div className="bg-muted/50 rounded-md p-3 text-sm whitespace-pre-wrap">
                {typeof intake.payload === 'string'
                  ? intake.payload
                  : JSON.stringify(intake.payload, null, 2)}
              </div>
            ) : (
              <div className="bg-muted/50 rounded-md p-3 text-sm text-muted-foreground italic">
                {t('intakes.payloadLocked', { defaultValue: 'Unlock to view payload' })}
              </div>
            )}
          </div>

          {canTriage && intake.status === 'pending' && (
            <div className="flex gap-2 pt-3 border-t">
              <Button
                size="sm"
                variant="outline"
                data-testid="intake-review-btn"
                onClick={() => handleStatusUpdate('reviewed')}
                disabled={updateStatus.isPending}
              >
                <Eye className="h-3 w-3 mr-1" />
                {t('intakes.review', { defaultValue: 'Review' })}
              </Button>
              <Button
                size="sm"
                data-testid="intake-merge-btn"
                onClick={() => handleStatusUpdate('merged')}
                disabled={updateStatus.isPending}
              >
                <Merge className="h-3 w-3 mr-1" />
                {t('intakes.merge', { defaultValue: 'Merge' })}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid="intake-dismiss-btn"
                onClick={() => handleStatusUpdate('dismissed')}
                disabled={updateStatus.isPending}
              >
                <X className="h-3 w-3 mr-1" />
                {t('intakes.dismiss', { defaultValue: 'Dismiss' })}
              </Button>
            </div>
          )}

          {canTriage && intake.status === 'reviewed' && (
            <div className="flex gap-2 pt-3 border-t">
              <Button
                size="sm"
                data-testid="intake-merge-btn"
                onClick={() => handleStatusUpdate('merged')}
                disabled={updateStatus.isPending}
              >
                <Merge className="h-3 w-3 mr-1" />
                {t('intakes.merge', { defaultValue: 'Merge' })}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid="intake-dismiss-btn"
                onClick={() => handleStatusUpdate('dismissed')}
                disabled={updateStatus.isPending}
              >
                <X className="h-3 w-3 mr-1" />
                {t('intakes.dismiss', { defaultValue: 'Dismiss' })}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/intakes"
      className="text-muted-foreground hover:text-foreground"
      data-testid="intake-detail-back"
    >
      <ArrowLeft className="h-5 w-5" />
    </Link>
  )
}
