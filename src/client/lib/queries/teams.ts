/**
 * React Query hooks for team management.
 *
 * Teams are hub-scoped organizational groups. Names and descriptions
 * are encrypted with the hub key (like roles). Cache is moderately
 * long-lived since teams change infrequently.
 */

import {
  type ContactTeamAssignment,
  type Team,
  type TeamMember,
  addTeamMembers,
  assignTeamContacts,
  createTeam,
  deleteTeam,
  listTeamContacts,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  unassignTeamContact,
  updateTeam,
} from '@/lib/api'
import { decryptHubField } from '@/lib/hub-field-crypto'
import type { Ciphertext } from '@shared/crypto-types'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// teamsListOptions
// ---------------------------------------------------------------------------

export const teamsListOptions = (hubId = 'global') =>
  queryOptions({
    queryKey: queryKeys.teams.list(),
    queryFn: async () => {
      const { teams } = await listTeams()
      return Promise.all(
        teams.map(async (team) => ({
          ...team,
          name: await decryptHubField(team.encryptedName, hubId, team.id, 'encrypted_name'),
          description: await decryptHubField(
            team.encryptedDescription,
            hubId,
            team.id,
            'encrypted_description'
          ),
        }))
      )
    },
    staleTime: 5 * 60 * 1000,
  })

// ---------------------------------------------------------------------------
// useTeams
// ---------------------------------------------------------------------------

export function useTeams(hubId = 'global') {
  return useQuery(teamsListOptions(hubId))
}

// ---------------------------------------------------------------------------
// teamMembersOptions
// ---------------------------------------------------------------------------

export const teamMembersOptions = (teamId: string) =>
  queryOptions({
    queryKey: queryKeys.teams.members(teamId),
    queryFn: async () => {
      const { members } = await listTeamMembers(teamId)
      return members
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!teamId,
  })

// ---------------------------------------------------------------------------
// useTeamMembers
// ---------------------------------------------------------------------------

export function useTeamMembers(teamId: string) {
  return useQuery(teamMembersOptions(teamId))
}

// ---------------------------------------------------------------------------
// teamContactsOptions
// ---------------------------------------------------------------------------

export const teamContactsOptions = (teamId: string) =>
  queryOptions({
    queryKey: queryKeys.teams.contacts(teamId),
    queryFn: async () => {
      const { assignments } = await listTeamContacts(teamId)
      return assignments
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!teamId,
  })

// ---------------------------------------------------------------------------
// useTeamContacts
// ---------------------------------------------------------------------------

export function useTeamContacts(teamId: string) {
  return useQuery(teamContactsOptions(teamId))
}

// ---------------------------------------------------------------------------
// useCreateTeam
// ---------------------------------------------------------------------------

export function useCreateTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      id?: string
      encryptedName: Ciphertext
      encryptedDescription?: Ciphertext
    }) => createTeam(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateTeam
// ---------------------------------------------------------------------------

export function useUpdateTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: {
        encryptedName?: Ciphertext
        encryptedDescription?: Ciphertext | null
      }
    }) => updateTeam(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteTeam
// ---------------------------------------------------------------------------

export function useDeleteTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useAddTeamMembers
// ---------------------------------------------------------------------------

export function useAddTeamMembers() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ teamId, pubkeys }: { teamId: string; pubkeys: string[] }) =>
      addTeamMembers(teamId, pubkeys),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.teams.members(variables.teamId),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useRemoveTeamMember
// ---------------------------------------------------------------------------

export function useRemoveTeamMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ teamId, pubkey }: { teamId: string; pubkey: string }) =>
      removeTeamMember(teamId, pubkey),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.teams.members(variables.teamId),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useAssignTeamContacts
// ---------------------------------------------------------------------------

export function useAssignTeamContacts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ teamId, contactIds }: { teamId: string; contactIds: string[] }) =>
      assignTeamContacts(teamId, contactIds),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.teams.contacts(variables.teamId),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUnassignTeamContact
// ---------------------------------------------------------------------------

export function useUnassignTeamContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ teamId, contactId }: { teamId: string; contactId: string }) =>
      unassignTeamContact(teamId, contactId),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.teams.contacts(variables.teamId),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { Team, TeamMember, ContactTeamAssignment }
