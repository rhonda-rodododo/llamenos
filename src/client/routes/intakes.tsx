import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { IntakeRecord } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useIntake, useIntakes, useUpdateIntakeStatus } from '@/lib/queries/intakes'
import { useToast } from '@/lib/toast'
import { Link, createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, ClipboardList, Eye, Merge, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/intakes')({
  component: IntakesPage,
})

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  reviewed: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  merged: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  dismissed: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

function IntakesPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const { toast } = useToast()
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const canTriage = hasPermission('contacts:triage')

  const { data: intakes, isLoading } = useIntakes(statusFilter !== 'all' ? statusFilter : undefined)
  const updateStatus = useUpdateIntakeStatus()
  // Fetch full detail for the selected intake via GET /intakes/:id
  const { data: intakeDetail } = useIntake(selectedId ?? '')

  // Prefer the server detail (freshest); fall back to list item while loading
  const selectedIntake = intakeDetail ?? intakes?.find((i) => i.id === selectedId) ?? null

  function handleStatusUpdate(id: string, status: 'reviewed' | 'merged' | 'dismissed') {
    updateStatus.mutate(
      { id, status },
      {
        onSuccess: () => {
          toast(t('intakes.statusUpdated', { defaultValue: 'Intake status updated' }))
          if (status === 'merged' || status === 'dismissed') {
            setSelectedId(null)
          }
        },
        onError: () => {
          toast(t('intakes.updateError', { defaultValue: 'Failed to update intake' }), 'error')
        },
      }
    )
  }

  return (
    <div className="container mx-auto max-w-6xl py-6 px-4" data-testid="intakes-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6" />
          <h1 className="text-2xl font-bold">
            {t('intakes.title', { defaultValue: 'Intake Queue' })}
          </h1>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="intakes-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('intakes.statusAll', { defaultValue: 'All' })}</SelectItem>
            <SelectItem value="pending">
              {t('intakes.statusPending', { defaultValue: 'Pending' })}
            </SelectItem>
            <SelectItem value="reviewed">
              {t('intakes.statusReviewed', { defaultValue: 'Reviewed' })}
            </SelectItem>
            <SelectItem value="merged">
              {t('intakes.statusMerged', { defaultValue: 'Merged' })}
            </SelectItem>
            <SelectItem value="dismissed">
              {t('intakes.statusDismissed', { defaultValue: 'Dismissed' })}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Intake list */}
        <div className="lg:col-span-2 space-y-2">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : !intakes?.length ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {t('intakes.empty', { defaultValue: 'No intakes found' })}
              </CardContent>
            </Card>
          ) : (
            intakes.map((intake) => (
              <IntakeRow
                key={intake.id}
                intake={intake}
                selected={intake.id === selectedId}
                onSelect={() => setSelectedId(intake.id)}
              />
            ))
          )}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-1">
          {selectedIntake ? (
            <Card data-testid="intake-detail-panel">
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  {t('intakes.detail', { defaultValue: 'Intake Detail' })}
                  <StatusBadge status={selectedIntake.status} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground">
                    {t('intakes.submittedBy', { defaultValue: 'Submitted by' })}:
                  </span>{' '}
                  <code className="text-xs">{selectedIntake.submittedBy.slice(0, 12)}...</code>
                </div>
                {selectedIntake.contactId && (
                  <div>
                    <span className="text-muted-foreground">
                      {t('intakes.linkedContact', { defaultValue: 'Linked contact' })}:
                    </span>{' '}
                    <code className="text-xs">{selectedIntake.contactId.slice(0, 12)}...</code>
                  </div>
                )}
                {selectedIntake.callId && (
                  <div>
                    <span className="text-muted-foreground">
                      {t('intakes.linkedCall', { defaultValue: 'Linked call' })}:
                    </span>{' '}
                    <code className="text-xs">{selectedIntake.callId.slice(0, 12)}...</code>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">
                    {t('intakes.createdAt', { defaultValue: 'Created' })}:
                  </span>{' '}
                  {new Date(selectedIntake.createdAt).toLocaleString()}
                </div>
                {selectedIntake.reviewedBy && (
                  <div>
                    <span className="text-muted-foreground">
                      {t('intakes.reviewedByLabel', { defaultValue: 'Reviewed by' })}:
                    </span>{' '}
                    <code className="text-xs">{selectedIntake.reviewedBy.slice(0, 12)}...</code>
                  </div>
                )}

                <div className="text-xs text-muted-foreground italic mt-2">
                  {t('intakes.encryptedNote', {
                    defaultValue: 'Payload is end-to-end encrypted',
                  })}
                </div>

                <div className="pt-2">
                  <Link
                    to="/intakes/$intakeId"
                    params={{ intakeId: selectedIntake.id }}
                    className="text-sm text-primary hover:underline"
                    data-testid="intake-view-detail-link"
                  >
                    {t('intakes.viewDetail', { defaultValue: 'View full detail' })}
                  </Link>
                </div>

                {/* Action buttons — gated by contacts:triage */}
                {canTriage && selectedIntake.status === 'pending' && (
                  <div className="flex gap-2 pt-3 border-t">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="intake-review-btn"
                      onClick={() => handleStatusUpdate(selectedIntake.id, 'reviewed')}
                      disabled={updateStatus.isPending}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      {t('intakes.review', { defaultValue: 'Review' })}
                    </Button>
                    <Button
                      size="sm"
                      data-testid="intake-merge-btn"
                      onClick={() => handleStatusUpdate(selectedIntake.id, 'merged')}
                      disabled={updateStatus.isPending}
                    >
                      <Merge className="h-3 w-3 mr-1" />
                      {t('intakes.merge', { defaultValue: 'Merge' })}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="intake-dismiss-btn"
                      onClick={() => handleStatusUpdate(selectedIntake.id, 'dismissed')}
                      disabled={updateStatus.isPending}
                    >
                      <X className="h-3 w-3 mr-1" />
                      {t('intakes.dismiss', { defaultValue: 'Dismiss' })}
                    </Button>
                  </div>
                )}

                {canTriage && selectedIntake.status === 'reviewed' && (
                  <div className="flex gap-2 pt-3 border-t">
                    <Button
                      size="sm"
                      data-testid="intake-merge-btn"
                      onClick={() => handleStatusUpdate(selectedIntake.id, 'merged')}
                      disabled={updateStatus.isPending}
                    >
                      <Merge className="h-3 w-3 mr-1" />
                      {t('intakes.merge', { defaultValue: 'Merge' })}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="intake-dismiss-btn"
                      onClick={() => handleStatusUpdate(selectedIntake.id, 'dismissed')}
                      disabled={updateStatus.isPending}
                    >
                      <X className="h-3 w-3 mr-1" />
                      {t('intakes.dismiss', { defaultValue: 'Dismiss' })}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {t('intakes.selectOne', { defaultValue: 'Select an intake to view details' })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function IntakeRow({
  intake,
  selected,
  onSelect,
}: { intake: IntakeRecord; selected: boolean; onSelect: () => void }) {
  return (
    <Card
      className={`cursor-pointer transition-colors hover:bg-accent/50 ${selected ? 'ring-2 ring-primary' : ''}`}
      onClick={onSelect}
      data-testid="intake-row"
    >
      <CardContent className="py-3 px-4 flex items-center justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge status={intake.status} />
            {intake.contactId && (
              <span className="text-xs text-muted-foreground">
                Contact: {intake.contactId.slice(0, 8)}...
              </span>
            )}
            {intake.callId && (
              <span className="text-xs text-muted-foreground">
                Call: {intake.callId.slice(0, 8)}...
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            <code>{intake.submittedBy.slice(0, 12)}...</code>
            {' \u00b7 '}
            {new Date(intake.createdAt).toLocaleDateString()}
          </div>
        </div>
        <CheckCircle2
          className={`h-4 w-4 ${intake.status === 'merged' ? 'text-green-500' : 'text-transparent'}`}
        />
      </CardContent>
    </Card>
  )
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
