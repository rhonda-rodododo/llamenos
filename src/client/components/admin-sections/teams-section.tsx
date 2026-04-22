import { ChevronDown, ChevronRight, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ContactSelect } from '@/components/contacts/contact-select'
import { SectionBody, SectionDescription } from '@/components/section-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { UserMultiSelect } from '@/components/user-multi-select'
import type { Team } from '@/lib/api'
import { useConfig } from '@/lib/config'
import { encryptHubField } from '@/lib/hub-field-crypto'
import {
  useAddTeamMembers,
  useAssignTeamContacts,
  useCreateTeam,
  useDeleteTeam,
  useRemoveTeamMember,
  useTeamContacts,
  useTeamMembers,
  useTeams,
  useUnassignTeamContact,
  useUpdateTeam,
} from '@/lib/queries/teams'
import { useUsers } from '@/lib/queries/users'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface TeamFormData {
  name: string
  description: string
}

export function TeamsSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'

  const { data: teams = [], isLoading: teamsLoading } = useTeams(hubId)
  const { data: users = [] } = useUsers()
  const createTeam = useCreateTeam()
  const updateTeam = useUpdateTeam()
  const deleteTeamMutation = useDeleteTeam()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<TeamFormData>({ name: '', description: '' })
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null)
  const [showSaved, setShowSaved] = useState(false)

  function startCreate() {
    setEditingId('new')
    setForm({ name: '', description: '' })
  }

  function startEdit(team: Team) {
    setEditingId(team.id)
    setForm({
      name: team.name || '',
      description: team.description || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm({ name: '', description: '' })
  }

  function flashSaved() {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    const trimmedName = form.name.trim()
    const trimmedDesc = form.description.trim()

    if (editingId === 'new') {
      // Pre-generate a client UUID for the new team so the AAD can be bound to a stable ID.
      const newId = crypto.randomUUID()
      const encryptedName = await encryptHubField(trimmedName, hubId, newId, 'encrypted_name')
      if (!encryptedName) {
        toast(t('common.error', { defaultValue: 'Error' }), 'error')
        return
      }
      const encryptedDescription = trimmedDesc
        ? await encryptHubField(trimmedDesc, hubId, newId, 'encrypted_description')
        : undefined
      createTeam.mutate(
        {
          id: newId,
          encryptedName,
          encryptedDescription,
        },
        {
          onSuccess: () => {
            cancelEdit()
            flashSaved()
            toast(t('teams.created', { defaultValue: 'Team created' }), 'success')
          },
          onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
        }
      )
    } else if (editingId) {
      const encryptedName = await encryptHubField(trimmedName, hubId, editingId, 'encrypted_name')
      if (!encryptedName) {
        toast(t('common.error', { defaultValue: 'Error' }), 'error')
        return
      }
      const encryptedDescription = trimmedDesc
        ? ((await encryptHubField(trimmedDesc, hubId, editingId, 'encrypted_description')) ?? null)
        : null
      updateTeam.mutate(
        {
          id: editingId,
          data: {
            encryptedName,
            encryptedDescription,
          },
        },
        {
          onSuccess: () => {
            cancelEdit()
            flashSaved()
            toast(t('teams.updated', { defaultValue: 'Team updated' }), 'success')
          },
          onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
        }
      )
    }
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteTeamMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast(t('teams.deleted', { defaultValue: 'Team deleted' }), 'success')
        if (editingId === deleteTarget.id) cancelEdit()
        if (expandedTeamId === deleteTarget.id) setExpandedTeamId(null)
        setDeleteTarget(null)
      },
      onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
    })
  }

  function toggleExpand(teamId: string) {
    setExpandedTeamId((prev) => (prev === teamId ? null : teamId))
  }

  const isSaving = createTeam.isPending || updateTeam.isPending

  if (teamsLoading) return null

  return (
    <SectionBody>
      <SectionDescription>
        {t('teams.description', {
          defaultValue: 'Organize users into teams for contact assignment and shift management.',
        })}
      </SectionDescription>

      <div className="space-y-2" data-testid="admin-teams-list">
        {teams.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t('teams.empty', { defaultValue: 'No teams yet. Create one to get started.' })}
          </p>
        )}
        {teams.map((team) => (
          <div key={team.id}>
            <div
              className={cn(
                'flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors',
                editingId === team.id && 'border-primary/30 bg-primary/5',
                expandedTeamId === team.id && 'rounded-b-none'
              )}
            >
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => toggleExpand(team.id)}
                data-testid={`admin-teams-expand-${team.id}`}
              >
                {expandedTeamId === team.id ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{team.name || '[encrypted]'}</span>
                </div>
                {team.encryptedDescription && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {team.description || ''}
                  </p>
                )}
                <div className="flex gap-3 mt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {team.memberCount} {t('teams.members', { defaultValue: 'members' })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {team.contactCount} {t('teams.contacts', { defaultValue: 'contacts' })}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit(team)}
                  disabled={editingId !== null}
                  data-testid={`admin-teams-edit-${team.id}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="sr-only">{t('common.edit', { defaultValue: 'Edit' })}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteTarget(team)}
                  disabled={editingId !== null}
                  data-testid={`admin-teams-delete-${team.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  <span className="sr-only">{t('common.delete', { defaultValue: 'Delete' })}</span>
                </Button>
              </div>
            </div>

            {expandedTeamId === team.id && (
              <>
                <TeamMembersPanel teamId={team.id} users={users} />
                <TeamContactsPanel teamId={team.id} />
              </>
            )}
          </div>
        ))}
      </div>

      {editingId !== null && (
        <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <h4 className="text-sm font-medium">
            {editingId === 'new'
              ? t('teams.createTeam', { defaultValue: 'Create Team' })
              : t('teams.editTeam', { defaultValue: 'Edit Team' })}
          </h4>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('teams.name', { defaultValue: 'Name' })}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('teams.namePlaceholder', { defaultValue: 'e.g. Crisis Response' })}
                maxLength={100}
                data-testid="admin-teams-name-input"
              />
            </div>

            <div className="space-y-1">
              <Label>{t('teams.descriptionLabel', { defaultValue: 'Description' })}</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={t('teams.descriptionPlaceholder', {
                  defaultValue: 'Brief description of this team...',
                })}
                rows={2}
                maxLength={200}
                data-testid="admin-teams-description-input"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              disabled={isSaving || !form.name.trim()}
              onClick={handleSave}
              data-testid="admin-teams-save"
            >
              <Save className="h-4 w-4" />
              {isSaving
                ? t('common.loading', { defaultValue: 'Loading...' })
                : t('common.save', { defaultValue: 'Save' })}
            </Button>
            <Button variant="outline" onClick={cancelEdit} data-testid="admin-teams-cancel">
              <X className="h-4 w-4" />
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        </div>
      )}

      {editingId === null && (
        <Button variant="outline" onClick={startCreate} data-testid="admin-teams-create">
          <Plus className="h-4 w-4" />
          {t('teams.createTeam', { defaultValue: 'Create Team' })}
        </Button>
      )}

      {showSaved && (
        <span data-testid="admin-teams-save-success" className="text-sm text-green-600">
          {t('common.success', { defaultValue: 'Saved' })}
        </span>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('teams.deleteTitle', { defaultValue: 'Delete Team' })}
        description={
          deleteTarget
            ? t('teams.deleteConfirm', {
                defaultValue:
                  'Are you sure you want to delete this team? All member and contact assignments will be removed.',
              })
            : ''
        }
        variant="destructive"
        onConfirm={handleDelete}
      />
    </SectionBody>
  )
}

// ---------------------------------------------------------------------------
// TeamContactsPanel — inline expansion for managing team contact assignments
// ---------------------------------------------------------------------------

function TeamContactsPanel({ teamId }: { teamId: string }) {
  const { t } = useTranslation()
  const { toast } = useToast()

  const { data: assignments = [] } = useTeamContacts(teamId)
  const assignContacts = useAssignTeamContacts()
  const unassignContact = useUnassignTeamContact()

  const [addingContacts, setAddingContacts] = useState(false)
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])

  const assignedContactIds = new Set(assignments.map((a) => a.contactId))

  function handleAssign() {
    const newIds = selectedContactIds.filter((id) => !assignedContactIds.has(id))
    if (!newIds.length) return
    assignContacts.mutate(
      { teamId, contactIds: newIds },
      {
        onSuccess: () => {
          setSelectedContactIds([])
          setAddingContacts(false)
          toast(t('teams.contactsAssigned', { defaultValue: 'Contacts assigned' }), 'success')
        },
        onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
      }
    )
  }

  function handleUnassign(contactId: string) {
    unassignContact.mutate(
      { teamId, contactId },
      {
        onSuccess: () =>
          toast(t('teams.contactUnassigned', { defaultValue: 'Contact unassigned' }), 'success'),
        onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
      }
    )
  }

  return (
    <div
      className="rounded-b-lg border border-t-0 border-border bg-muted/20 px-4 py-3 space-y-3"
      data-testid={`admin-teams-contacts-panel-${teamId}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('teams.contacts', { defaultValue: 'Contacts' })} ({assignments.length})
        </span>
        {!addingContacts && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAddingContacts(true)}
            data-testid={`admin-teams-add-contact-btn-${teamId}`}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('teams.assignContact', { defaultValue: 'Assign' })}
          </Button>
        )}
      </div>

      {assignments.length > 0 ? (
        <div className="space-y-1">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50 transition-colors"
              data-testid={`admin-teams-contact-row-${assignment.contactId}`}
            >
              <span className="flex-1 text-sm truncate text-muted-foreground">
                {assignment.contactId.slice(0, 12)}…
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => handleUnassign(assignment.contactId)}
                data-testid={`admin-teams-unassign-contact-${assignment.contactId}`}
              >
                <X className="h-3 w-3 text-destructive" />
                <span className="sr-only">{t('common.remove', { defaultValue: 'Remove' })}</span>
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('teams.noContacts', { defaultValue: 'No contacts assigned yet' })}
        </p>
      )}

      {addingContacts && (
        <div className="space-y-2 border-t border-border pt-2">
          <ContactSelect
            value={selectedContactIds}
            onChange={(val) => setSelectedContactIds(Array.isArray(val) ? val : val ? [val] : [])}
            multiple
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!selectedContactIds.length || assignContacts.isPending}
              onClick={handleAssign}
              data-testid={`admin-teams-confirm-assign-contacts-${teamId}`}
            >
              {assignContacts.isPending
                ? t('common.loading', { defaultValue: 'Loading...' })
                : t('teams.assignContacts', { defaultValue: 'Assign Contacts' })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAddingContacts(false)
                setSelectedContactIds([])
              }}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TeamMembersPanel — inline expansion for managing team members
// ---------------------------------------------------------------------------

function TeamMembersPanel({
  teamId,
  users,
}: {
  teamId: string
  users: import('@/lib/api').User[]
}) {
  const { t } = useTranslation()
  const { toast } = useToast()

  const { data: members = [] } = useTeamMembers(teamId)
  const addMembers = useAddTeamMembers()
  const removeMember = useRemoveTeamMember()

  const [addingMembers, setAddingMembers] = useState(false)
  const [selectedPubkeys, setSelectedPubkeys] = useState<string[]>([])

  const memberPubkeys = new Set(members.map((m) => m.userPubkey))
  const availableUsers = users.filter((u) => !memberPubkeys.has(u.pubkey))

  function handleAddMembers() {
    if (!selectedPubkeys.length) return
    addMembers.mutate(
      { teamId, pubkeys: selectedPubkeys },
      {
        onSuccess: () => {
          setSelectedPubkeys([])
          setAddingMembers(false)
          toast(t('teams.membersAdded', { defaultValue: 'Members added' }), 'success')
        },
        onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
      }
    )
  }

  function handleRemoveMember(pubkey: string) {
    removeMember.mutate(
      { teamId, pubkey },
      {
        onSuccess: () =>
          toast(t('teams.memberRemoved', { defaultValue: 'Member removed' }), 'success'),
        onError: () => toast(t('common.error', { defaultValue: 'Error' }), 'error'),
      }
    )
  }

  function getUserName(pubkey: string): string {
    const user = users.find((u) => u.pubkey === pubkey)
    return user?.name || `${pubkey.slice(0, 12)}...`
  }

  return (
    <div
      className="border border-t-0 border-border bg-muted/30 px-4 py-3 space-y-3"
      data-testid={`admin-teams-members-panel-${teamId}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('teams.members', { defaultValue: 'Members' })} ({members.length})
        </span>
        {!addingMembers && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAddingMembers(true)}
            data-testid={`admin-teams-add-member-btn-${teamId}`}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('teams.addMember', { defaultValue: 'Add' })}
          </Button>
        )}
      </div>

      {members.length > 0 ? (
        <div className="space-y-1">
          {members.map((member) => (
            <div
              key={member.userPubkey}
              className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50 transition-colors"
            >
              <span className="flex-1 text-sm truncate">{getUserName(member.userPubkey)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => handleRemoveMember(member.userPubkey)}
                data-testid={`admin-teams-remove-member-${member.userPubkey}`}
              >
                <X className="h-3 w-3 text-destructive" />
                <span className="sr-only">{t('common.remove', { defaultValue: 'Remove' })}</span>
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('teams.noMembers', { defaultValue: 'No members yet' })}
        </p>
      )}

      {addingMembers && (
        <div className="space-y-2 border-t border-border pt-2">
          <UserMultiSelect
            users={availableUsers}
            selected={selectedPubkeys}
            onSelectionChange={setSelectedPubkeys}
            placeholder={t('teams.selectMembers', { defaultValue: 'Select members...' })}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!selectedPubkeys.length || addMembers.isPending}
              onClick={handleAddMembers}
              data-testid={`admin-teams-confirm-add-members-${teamId}`}
            >
              {addMembers.isPending
                ? t('common.loading', { defaultValue: 'Loading...' })
                : t('teams.addMembers', { defaultValue: 'Add Members' })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAddingMembers(false)
                setSelectedPubkeys([])
              }}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
