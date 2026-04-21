import { ReportForm } from '@/components/ReportForm'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  type ContactChannel,
  ContactChannelsCard,
} from '@/components/contacts/contact-channels-card'
import { ContactRelationshipSection } from '@/components/contacts/contact-relationship-section'
import { ContactTimeline } from '@/components/contacts/contact-timeline'
import { MergeDialog } from '@/components/contacts/merge-dialog'
import { TagBadge, useTagLookup } from '@/components/tag-input'
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
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'

import {
  useContact,
  useContactRelationships,
  useContactTimeline,
  useContacts,
  useDeleteContact,
} from '@/lib/queries/contacts'
import {
  useAssignTeamContacts,
  useTeamContacts,
  useTeams,
  useUnassignTeamContact,
} from '@/lib/queries/teams'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, BookUser, FileText, GitMerge, Lock, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export const Route = createFileRoute('/contacts_/$contactId')({
  component: ContactProfilePage,
})

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-500/10 text-green-500 border-green-500/20',
  medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-500 border-red-500/20',
}

function ContactProfilePage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const { contactId } = Route.useParams()

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)

  const canReadPii = hasPermission('contacts:envelope-full')
  const canDelete = hasPermission('contacts:delete')
  const canCreateReport = hasPermission('reports:create')
  const canMerge =
    hasPermission('contacts:update-all') &&
    hasPermission('contacts:envelope-full') &&
    hasPermission('contacts:delete')

  // React Query: contact detail (decrypts summary+PII tiers in query fn),
  // timeline, relationships, and all contacts list (for relationship names)
  const { data: contact, isLoading: loading } = useContact(contactId)
  const { data: timeline = { calls: [], conversations: [], notes: [] } } =
    useContactTimeline(contactId)
  const { data: relationships = [] } = useContactRelationships()
  const { data: allContacts = [] } = useContacts()
  const deleteContactMutation = useDeleteContact()
  const tagDefs = useTagLookup()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  const { data: teams = [] } = useTeams(hubId)
  const assignTeamContacts = useAssignTeamContacts()
  const unassignTeamContact = useUnassignTeamContact()

  // useContact already decrypts summary+PII tiers — access fields directly
  const contactAny = contact as (typeof contact & Record<string, unknown>) | undefined
  const displayName = (contactAny?.displayName as string) ?? '[encrypted]'
  const decryptedNotes = (contactAny?.notes as string) || null
  const decryptedFullName = canReadPii ? (contactAny?.fullName as string) || null : null
  const decryptedPhone = canReadPii ? (contactAny?.phone as string) || null : null

  // Derive channel list from decrypted PII fields
  const channels = useMemo<ContactChannel[]>(() => {
    if (!canReadPii) return []
    const result: ContactChannel[] = []

    // Phone field → phone/sms channel
    if (decryptedPhone) {
      result.push({ type: 'phone', identifier: decryptedPhone, preferred: true })
      result.push({ type: 'sms', identifier: decryptedPhone })
    }

    // If there's a decrypted PII blob with structured channels, merge those
    const piiBlobRaw = contactAny?.pii
    if (piiBlobRaw && typeof piiBlobRaw === 'string') {
      try {
        const piiBlob = JSON.parse(piiBlobRaw) as Record<string, unknown>
        const blobChannels = piiBlob.channels as ContactChannel[] | undefined
        if (Array.isArray(blobChannels)) {
          for (const ch of blobChannels) {
            // Avoid duplicate entries from the phone field
            if (!result.some((r) => r.type === ch.type && r.identifier === ch.identifier)) {
              result.push(ch)
            }
          }
        }
      } catch {
        // PII blob isn't valid JSON or doesn't have channels — ignore
      }
    }

    return result
  }, [canReadPii, decryptedPhone, contactAny?.pii])

  // Build a map of contactId → display name for relationships
  // useContacts already decrypts displayName via LABEL_CONTACT_SUMMARY
  const contactNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of allContacts) {
      const name =
        ((c as unknown as Record<string, unknown>).displayName as string) ?? '[encrypted]'
      map.set(c.id, name)
    }
    return map
  }, [allContacts])

  function getContactTypeLabel(type: string): string {
    if (type === 'partner-org') return t('contacts.partnerOrg')
    if (type === 'referral-resource') return t('contacts.referralResource')
    return t(`contacts.${type}`, { defaultValue: type })
  }

  async function handleDelete() {
    await deleteContactMutation.mutateAsync(contactId)
    toast.success(t('contacts.deleted'))
    navigate({
      to: '/contacts',
      search: { contactType: '', riskLevel: '', q: '', teamId: '', tag: '' },
    })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[350px_1fr]">
          <div className="space-y-4">
            <Skeleton className="h-48 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={() =>
            navigate({
              to: '/contacts',
              search: { contactType: '', riskLevel: '', q: '', teamId: '', tag: '' },
            })
          }
        >
          <ArrowLeft className="h-4 w-4" />
          {t('nav.contacts', { defaultValue: 'Contacts' })}
        </button>
        <div className="py-8 text-center text-muted-foreground">{t('common.noData')}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            data-testid="contact-back-btn"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() =>
              navigate({
                to: '/contacts',
                search: { contactType: '', riskLevel: '', q: '', teamId: '', tag: '' },
              })
            }
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <BookUser className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="truncate text-xl font-bold">{displayName}</h1>
          {contact.riskLevel && contact.riskLevel !== 'low' && (
            <Badge
              variant="outline"
              className={`shrink-0 text-xs capitalize ${RISK_COLORS[contact.riskLevel] ?? ''}`}
            >
              {t(`contacts.${contact.riskLevel}`, { defaultValue: contact.riskLevel })}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canCreateReport && (
            <Button
              data-testid="contact-add-report-btn"
              variant="outline"
              size="sm"
              onClick={() => setReportOpen(true)}
            >
              <FileText className="mr-1 h-4 w-4" />
              {t('contacts.addReport', { defaultValue: 'Add Report' })}
            </Button>
          )}
          {canMerge && (
            <Button
              data-testid="contact-merge-btn"
              variant="outline"
              size="sm"
              onClick={() => setMergeOpen(true)}
            >
              <GitMerge className="mr-1 h-4 w-4" />
              {t('contacts.merge', { defaultValue: 'Merge' })}
            </Button>
          )}
          {canDelete && (
            <Button
              data-testid="contact-delete-btn"
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
            >
              {t('common.delete', { defaultValue: 'Delete' })}
            </Button>
          )}
        </div>
      </div>

      {/* Layout: sidebar + timeline */}
      <div className="grid gap-4 lg:grid-cols-[350px_1fr]">
        {/* Left sidebar */}
        <div className="space-y-4">
          {/* Summary card */}
          <Card data-testid="contact-summary-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('contacts.summary')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs capitalize">
                  {getContactTypeLabel(contact.contactType)}
                </Badge>
                {contact.riskLevel && (
                  <Badge
                    variant="outline"
                    className={`text-xs capitalize ${RISK_COLORS[contact.riskLevel] ?? ''}`}
                  >
                    {t(`contacts.${contact.riskLevel}`, { defaultValue: contact.riskLevel })}
                  </Badge>
                )}
              </div>

              {contact.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {contact.tags.map((slug) => {
                    const def = tagDefs.find((t) => t.name === slug)
                    return (
                      <TagBadge key={slug} label={def?.label ?? slug} color={def?.color ?? ''} />
                    )
                  })}
                </div>
              )}

              {decryptedNotes && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {t('contacts.notes')}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{decryptedNotes}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {contact.lastInteractionAt && (
                  <span>
                    {t('contacts.lastInteraction')}:{' '}
                    {new Date(contact.lastInteractionAt).toLocaleDateString()}
                  </span>
                )}
                <span>
                  {t('common.created', { defaultValue: 'Created' })}:{' '}
                  {new Date(contact.createdAt).toLocaleDateString()}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* PII card */}
          <Card data-testid="contact-pii-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('contacts.pii')}</CardTitle>
            </CardHeader>
            <CardContent>
              {!canReadPii ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Lock className="h-4 w-4 shrink-0" />
                  {t('contacts.piiEncrypted')}
                </div>
              ) : (
                <div className="space-y-2">
                  {decryptedFullName ? (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('contacts.fullName')}
                      </p>
                      <p className="text-sm">{decryptedFullName}</p>
                    </div>
                  ) : null}
                  {decryptedPhone ? (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('contacts.phone')}
                      </p>
                      <p className="font-mono text-sm">{decryptedPhone}</p>
                    </div>
                  ) : null}
                  {!decryptedFullName && !decryptedPhone && (
                    <p className="text-sm text-muted-foreground">
                      {t('common.noData', { defaultValue: 'No data' })}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Channels (PII-gated) */}
          {canReadPii && channels.length > 0 && (
            <ContactChannelsCard
              contactId={contactId}
              channels={channels}
              contactName={displayName}
            />
          )}

          {/* Teams */}
          <ContactTeamsCard
            contactId={contactId}
            teams={teams}
            hubId={hubId}
            onAssign={(teamId) => {
              assignTeamContacts.mutate(
                { teamId, contactIds: [contactId] },
                {
                  onSuccess: () =>
                    toast.success(t('teams.contactAssigned', { defaultValue: 'Assigned to team' })),
                  onError: () => toast.error(t('common.error', { defaultValue: 'Error' })),
                }
              )
            }}
            onUnassign={(teamId) => {
              unassignTeamContact.mutate(
                { teamId, contactId },
                {
                  onSuccess: () =>
                    toast.success(
                      t('teams.contactUnassigned', { defaultValue: 'Removed from team' })
                    ),
                  onError: () => toast.error(t('common.error', { defaultValue: 'Error' })),
                }
              )
            }}
          />

          {/* Support contacts */}
          <ContactRelationshipSection
            contactId={contactId}
            relationships={relationships}
            contactNames={contactNames}
            onNavigate={(cid) =>
              navigate({
                to: '/contacts/$contactId',
                params: { contactId: cid },
              })
            }
          />
        </div>

        {/* Right panel: timeline */}
        <ContactTimeline
          calls={timeline.calls}
          conversations={timeline.conversations}
          notes={timeline.notes}
        />
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('contacts.deleteConfirm')}
        variant="destructive"
        onConfirm={handleDelete}
      />

      {canCreateReport && (
        <ReportForm
          open={reportOpen}
          onOpenChange={setReportOpen}
          onCreated={(reportId) => {
            setReportOpen(false)
            toast.success(
              t('contacts.reportCreated', { defaultValue: 'Report created successfully' })
            )
            navigate({ to: '/reports', search: {} })
          }}
        />
      )}

      {canMerge && (
        <MergeDialog
          secondaryId={contactId}
          secondaryName={displayName}
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          onMerged={(primaryId) => {
            navigate({
              to: '/contacts/$contactId',
              params: { contactId: primaryId },
            })
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContactTeamsCard — shows team badges and assign/unassign for admins
// ---------------------------------------------------------------------------

function ContactTeamsCard({
  contactId,
  teams,
  hubId,
  onAssign,
  onUnassign,
}: {
  contactId: string
  teams: import('@/lib/api').Team[]
  hubId: string
  onAssign: (teamId: string) => void
  onUnassign: (teamId: string) => void
}) {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('contacts:update-assigned')

  if (teams.length === 0) return null

  return (
    <Card data-testid="contact-teams-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          {t('teams.title', { defaultValue: 'Teams' })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Render each team as a separate component to satisfy rules of hooks */}
        <ContactTeamBadges
          contactId={contactId}
          teams={teams}
          hubId={hubId}
          canManage={canManage}
          onAssign={onAssign}
          onUnassign={onUnassign}
        />
      </CardContent>
    </Card>
  )
}

/**
 * Renders team badges and assign dropdown for a contact.
 * Queries all teams' contacts once per team using individual badge components.
 */
function ContactTeamBadges({
  contactId,
  teams,
  hubId,
  canManage,
  onAssign,
  onUnassign,
}: {
  contactId: string
  teams: import('@/lib/api').Team[]
  hubId: string
  canManage: boolean
  onAssign: (teamId: string) => void
  onUnassign: (teamId: string) => void
}) {
  const { t } = useTranslation()

  return (
    <>
      {/* Each team gets its own component so hooks are called unconditionally */}
      <div className="flex flex-wrap gap-1.5" data-testid="contact-team-badges">
        {teams.map((team) => (
          <ContactTeamBadge
            key={team.id}
            team={team}
            contactId={contactId}
            hubId={hubId}
            canManage={canManage}
            onUnassign={onUnassign}
          />
        ))}
      </div>

      {/* Assign dropdown */}
      {canManage && (
        <Select
          value=""
          onValueChange={(teamId) => {
            if (teamId) onAssign(teamId)
          }}
        >
          <SelectTrigger data-testid="team-assign-select" className="w-full">
            <SelectValue
              placeholder={t('teams.assignToTeam', { defaultValue: 'Assign to team...' })}
            />
          </SelectTrigger>
          <SelectContent>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name || '[encrypted]'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  )
}

/**
 * Single team badge — uses useTeamContacts hook safely (one per component instance).
 */
function ContactTeamBadge({
  team,
  contactId,
  hubId,
  canManage,
  onUnassign,
}: {
  team: import('@/lib/api').Team
  contactId: string
  hubId: string
  canManage: boolean
  onUnassign: (teamId: string) => void
}) {
  const { data: assignments = [] } = useTeamContacts(team.id)
  const isAssigned = assignments.some((a) => a.contactId === contactId)

  if (!isAssigned) return null

  return (
    <Badge
      variant="secondary"
      className="text-xs flex items-center gap-1"
      data-testid={`team-badge-${team.id}`}
    >
      {team.name || '[encrypted]'}
      {canManage && (
        <button
          type="button"
          className="ml-0.5 hover:text-destructive transition-colors"
          onClick={() => onUnassign(team.id)}
          data-testid={`team-unassign-${team.id}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  )
}
