import { CreateContactDialog } from '@/components/contacts/create-contact-dialog'
import { ImportContactsDialog } from '@/components/contacts/import-contacts-dialog'
import { TagBadge, TagInput, useTagLookup } from '@/components/tag-input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfig } from '@/lib/config'

import { useBulkDeleteContacts, useBulkUpdateContacts, useContacts } from '@/lib/queries/contacts'
import { useAssignTeamContacts, useTeamContacts, useTeams } from '@/lib/queries/teams'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { BookUser, Plus, Search, Tag, Trash2, Upload, Users, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** ContactRecord augmented with fields populated by decryptObjectFields */
type DecryptedContact = {
  id: string
  contactType: string
  riskLevel?: string
  tags: string[]
  lastInteractionAt?: string
  createdAt: string
  displayName?: string
  notes?: string
  [key: string]: unknown
}

type ContactsSearch = {
  contactType: string
  riskLevel: string
  q: string
  teamId: string
  tag: string
}

export const Route = createFileRoute('/contacts')({
  validateSearch: (search: Record<string, unknown>): ContactsSearch => ({
    contactType: (search?.contactType as string) || '',
    riskLevel: (search?.riskLevel as string) || '',
    q: (search?.q as string) || '',
    teamId: (search?.teamId as string) || '',
    tag: (search?.tag as string) || '',
  }),
  component: ContactDirectoryPage,
})

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-500/10 text-green-500 border-green-500/20',
  medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-500 border-red-500/20',
}

function ContactDirectoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate({ from: '/contacts' })
  const { contactType, riskLevel, q, teamId, tag } = Route.useSearch()
  const [searchInput, setSearchInput] = useState(q)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'

  const { data: contacts = [], isLoading: loading } = useContacts({
    contactType: contactType || undefined,
    riskLevel: riskLevel || undefined,
  })
  const { data: teams = [] } = useTeams(hubId)
  const { data: teamContacts = [] } = useTeamContacts(teamId || '')
  const tagDefs = useTagLookup()

  const bulkUpdate = useBulkUpdateContacts()
  const bulkDelete = useBulkDeleteContacts()
  const assignTeam = useAssignTeamContacts()

  const decryptedContacts = contacts as unknown as DecryptedContact[]

  // Team contact IDs for filtering
  const teamContactIds = useMemo(
    () => (teamId ? new Set(teamContacts.map((tc) => tc.contactId)) : null),
    [teamId, teamContacts]
  )

  const filtered = useMemo(() => {
    let result = decryptedContacts

    // Filter by team
    if (teamContactIds) {
      result = result.filter((c) => teamContactIds.has(c.id))
    }

    // Filter by tag
    if (tag) {
      result = result.filter((c) => c.tags.includes(tag))
    }

    // Filter by search query
    if (q) {
      const lower = q.toLowerCase()
      result = result.filter((c) => (c.displayName ?? '[encrypted]').toLowerCase().includes(lower))
    }

    return result
  }, [decryptedContacts, q, teamContactIds, tag])

  // Selection helpers
  const allFilteredIds = useMemo(() => new Set(filtered.map((c) => c.id)), [filtered])
  const allSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))
  const someSelected = selectedIds.size > 0

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allFilteredIds))
    }
  }, [allSelected, allFilteredIds])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    navigate({ search: (prev) => ({ ...prev, q: searchInput }) })
  }

  function handleContactTypeChange(value: string) {
    navigate({ search: (prev) => ({ ...prev, contactType: value === 'all' ? '' : value }) })
  }

  function handleRiskLevelChange(value: string) {
    navigate({ search: (prev) => ({ ...prev, riskLevel: value === 'all' ? '' : value }) })
  }

  function handleTeamChange(value: string) {
    navigate({ search: (prev) => ({ ...prev, teamId: value === 'all' ? '' : value }) })
  }

  function handleTagChange(value: string) {
    navigate({ search: (prev) => ({ ...prev, tag: value === 'all' ? '' : value }) })
  }

  function getContactTypeLabel(type: string): string {
    if (type === 'partner-org') return t('contacts.partnerOrg')
    if (type === 'referral-resource') return t('contacts.referralResource')
    return t(`contacts.${type}`, { defaultValue: type })
  }

  async function handleBulkTag(tags: string[]) {
    if (tags.length === 0) return
    await bulkUpdate.mutateAsync({
      contactIds: [...selectedIds],
      addTags: tags,
    })
    clearSelection()
  }

  async function handleBulkRiskLevel(level: string) {
    await bulkUpdate.mutateAsync({
      contactIds: [...selectedIds],
      riskLevel: level,
    })
    clearSelection()
  }

  async function handleBulkAssignTeam(assignTeamId: string) {
    await assignTeam.mutateAsync({
      teamId: assignTeamId,
      contactIds: [...selectedIds],
    })
    clearSelection()
  }

  async function handleBulkDelete() {
    await bulkDelete.mutateAsync([...selectedIds])
    clearSelection()
  }

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookUser className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold sm:text-2xl">{t('contacts.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-testid="import-contacts-btn"
            size="sm"
            variant="outline"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            {t('contacts.import', { defaultValue: 'Import' })}
          </Button>
          <Button data-testid="new-contact-btn" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('contacts.newContact')}
          </Button>
        </div>
      </div>

      {/* Search and filter bar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <form onSubmit={handleSearch} className="flex flex-1 gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  data-testid="contact-search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t('contacts.search')}
                  className="pl-9"
                />
              </div>
              <Button
                data-testid="contact-search-btn"
                type="submit"
                size="sm"
                aria-label={t('a11y.searchButton', { defaultValue: 'Search' })}
              >
                <Search className="h-4 w-4" />
              </Button>
            </form>
            <div className="flex gap-2">
              <Select value={contactType || 'all'} onValueChange={handleContactTypeChange}>
                <SelectTrigger data-testid="contact-type-filter" className="w-40">
                  <SelectValue placeholder={t('contacts.type')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('contacts.type')}</SelectItem>
                  <SelectItem value="caller">{t('contacts.caller')}</SelectItem>
                  <SelectItem value="partner-org">{t('contacts.partnerOrg')}</SelectItem>
                  <SelectItem value="referral-resource">
                    {t('contacts.referralResource')}
                  </SelectItem>
                  <SelectItem value="other">{t('contacts.other')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={riskLevel || 'all'} onValueChange={handleRiskLevelChange}>
                <SelectTrigger data-testid="risk-level-filter" className="w-36">
                  <SelectValue placeholder={t('contacts.riskLevel')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('contacts.riskLevel')}</SelectItem>
                  <SelectItem value="low">{t('contacts.low')}</SelectItem>
                  <SelectItem value="medium">{t('contacts.medium')}</SelectItem>
                  <SelectItem value="high">{t('contacts.high')}</SelectItem>
                  <SelectItem value="critical">{t('contacts.critical')}</SelectItem>
                </SelectContent>
              </Select>
              {teams.length > 0 && (
                <Select value={teamId || 'all'} onValueChange={handleTeamChange}>
                  <SelectTrigger data-testid="team-filter" className="w-40">
                    <SelectValue placeholder={t('teams.team', { defaultValue: 'Team' })} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t('teams.allTeams', { defaultValue: 'All Teams' })}
                    </SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name || '[encrypted]'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {tagDefs.length > 0 && (
                <Select value={tag || 'all'} onValueChange={handleTagChange}>
                  <SelectTrigger data-testid="tag-filter" className="w-36">
                    <SelectValue placeholder={t('tags.tag', { defaultValue: 'Tag' })} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t('tags.allTags', { defaultValue: 'All Tags' })}
                    </SelectItem>
                    {tagDefs.map((td) => (
                      <SelectItem key={td.id} value={td.name}>
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={
                              {
                                '--tag-color': td.color || '#888',
                                backgroundColor: 'var(--tag-color)',
                              } as React.CSSProperties
                            }
                          />
                          {td.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contact list */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-3">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="ml-auto h-4 w-24" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <BookUser className="mx-auto mb-2 h-8 w-8 opacity-40" />
              {t('contacts.noContacts')}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* Select all header */}
              <div className="flex items-center gap-3 px-4 py-2 bg-muted/20 sm:px-6">
                <Checkbox
                  data-testid="select-all-checkbox"
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label={t('contacts.selectAll', { defaultValue: 'Select all' })}
                />
                <span className="text-xs text-muted-foreground">
                  {someSelected
                    ? t('contacts.nSelected', {
                        defaultValue: '{{count}} selected',
                        count: selectedIds.size,
                      })
                    : t('contacts.selectAll', { defaultValue: 'Select all' })}
                </span>
              </div>

              {filtered.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center gap-3 px-4 sm:px-6 hover:bg-muted/30 transition-colors"
                >
                  <Checkbox
                    data-testid="contact-row-checkbox"
                    checked={selectedIds.has(contact.id)}
                    onCheckedChange={() => toggleSelect(contact.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={t('contacts.selectContact', {
                      defaultValue: 'Select {{name}}',
                      name: contact.displayName ?? contact.id,
                    })}
                  />
                  <button
                    type="button"
                    data-testid="contact-row"
                    className="flex flex-1 flex-wrap items-center gap-3 py-3 text-left"
                    onClick={() => {
                      navigate({
                        to: '/contacts/$contactId',
                        params: { contactId: contact.id },
                        search: (prev) => prev,
                      })
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {contact.displayName ?? '[encrypted]'}
                    </span>
                    <Badge variant="outline" className="shrink-0 text-xs capitalize">
                      {getContactTypeLabel(contact.contactType)}
                    </Badge>
                    {contact.riskLevel && contact.riskLevel !== 'low' && (
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-xs capitalize ${RISK_COLORS[contact.riskLevel] ?? ''}`}
                      >
                        {t(`contacts.${contact.riskLevel}`, { defaultValue: contact.riskLevel })}
                      </Badge>
                    )}
                    {contact.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {contact.tags.slice(0, 3).map((slug) => {
                          const def = tagDefs.find((t) => t.name === slug)
                          return (
                            <TagBadge
                              key={slug}
                              label={def?.label ?? slug}
                              color={def?.color ?? ''}
                            />
                          )
                        })}
                        {contact.tags.length > 3 && (
                          <Badge variant="secondary" className="text-xs">
                            +{contact.tags.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {contact.lastInteractionAt
                        ? new Date(contact.lastInteractionAt).toLocaleDateString()
                        : new Date(contact.createdAt).toLocaleDateString()}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk action toolbar */}
      {someSelected && (
        <BulkActionToolbar
          selectedCount={selectedIds.size}
          teams={teams}
          hubId={hubId}
          onTag={handleBulkTag}
          onRiskLevel={handleBulkRiskLevel}
          onAssignTeam={handleBulkAssignTeam}
          onDelete={handleBulkDelete}
          onClear={clearSelection}
          isPending={bulkUpdate.isPending || bulkDelete.isPending || assignTeam.isPending}
        />
      )}

      <CreateContactDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false)
          // useCreateContact mutation invalidates contacts.all in onSuccess
        }}
      />

      <ImportContactsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          setImportOpen(false)
          // useImportContacts mutation invalidates contacts.all in onSuccess
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// BulkActionToolbar
// ---------------------------------------------------------------------------

function BulkActionToolbar({
  selectedCount,
  teams,
  hubId,
  onTag,
  onRiskLevel,
  onAssignTeam,
  onDelete,
  onClear,
  isPending,
}: {
  selectedCount: number
  teams: Array<{ id: string; name?: string; encryptedName?: string }>
  hubId: string
  onTag: (tags: string[]) => void
  onRiskLevel: (level: string) => void
  onAssignTeam: (teamId: string) => void
  onDelete: () => void
  onClear: () => void
  isPending: boolean
}) {
  const { t } = useTranslation()
  const [tagValue, setTagValue] = useState<string[]>([])

  return (
    <div
      data-testid="bulk-toolbar"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg border bg-background/95 backdrop-blur px-4 py-2.5 shadow-lg"
    >
      <span className="text-sm font-medium whitespace-nowrap" data-testid="bulk-selected-count">
        {t('contacts.nSelected', { defaultValue: '{{count}} selected', count: selectedCount })}
      </span>

      <div className="h-5 w-px bg-border" />

      {/* Tag */}
      <Popover>
        <PopoverTrigger asChild>
          <Button data-testid="bulk-tag-btn" variant="outline" size="sm" disabled={isPending}>
            <Tag className="mr-1.5 h-3.5 w-3.5" />
            {t('contacts.tag', { defaultValue: 'Tag' })}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3" align="center" side="top">
          <TagInput
            value={tagValue}
            onChange={setTagValue}
            placeholder={t('tags.searchTags', { defaultValue: 'Search tags...' })}
          />
          <Button
            data-testid="bulk-tag-apply"
            size="sm"
            className="mt-2 w-full"
            disabled={tagValue.length === 0}
            onClick={() => {
              onTag(tagValue)
              setTagValue([])
            }}
          >
            {t('contacts.applyTags', { defaultValue: 'Apply Tags' })}
          </Button>
        </PopoverContent>
      </Popover>

      {/* Risk Level */}
      <Popover>
        <PopoverTrigger asChild>
          <Button data-testid="bulk-risk-btn" variant="outline" size="sm" disabled={isPending}>
            {t('contacts.riskLevel', { defaultValue: 'Risk Level' })}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-40 p-2" align="center" side="top">
          <div className="flex flex-col gap-1">
            {['low', 'medium', 'high', 'critical'].map((level) => (
              <Button
                key={level}
                data-testid={`bulk-risk-${level}`}
                variant="ghost"
                size="sm"
                className="justify-start capitalize"
                onClick={() => onRiskLevel(level)}
              >
                <span
                  className={`mr-2 h-2.5 w-2.5 rounded-full ${RISK_COLORS[level]?.split(' ')[0] ?? ''}`}
                />
                {t(`contacts.${level}`, { defaultValue: level })}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Assign Team */}
      {teams.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button data-testid="bulk-team-btn" variant="outline" size="sm" disabled={isPending}>
              <Users className="mr-1.5 h-3.5 w-3.5" />
              {t('teams.team', { defaultValue: 'Team' })}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="center" side="top">
            <div className="flex flex-col gap-1">
              {teams.map((team) => (
                <Button
                  key={team.id}
                  data-testid={`bulk-team-${team.id}`}
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => onAssignTeam(team.id)}
                >
                  {team.name || '[encrypted]'}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Delete */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            data-testid="bulk-delete-btn"
            variant="destructive"
            size="sm"
            disabled={isPending}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {t('contacts.delete', { defaultValue: 'Delete' })}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('contacts.confirmBulkDelete', {
                defaultValue: 'Delete {{count}} contacts?',
                count: selectedCount,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('contacts.confirmBulkDeleteDescription', {
                defaultValue:
                  'This action cannot be undone. Selected contacts will be permanently removed.',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', { defaultValue: 'Cancel' })}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="bulk-delete-confirm"
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('contacts.delete', { defaultValue: 'Delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="h-5 w-px bg-border" />

      {/* Clear */}
      <Button data-testid="bulk-clear-btn" variant="ghost" size="sm" onClick={onClear}>
        <X className="mr-1.5 h-3.5 w-3.5" />
        {t('common.clear', { defaultValue: 'Clear' })}
      </Button>
    </div>
  )
}
