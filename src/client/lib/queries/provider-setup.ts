/**
 * React Query hooks for the telephony provider setup wizard.
 * Covers credential validation, OAuth, A2P brand/campaign, phone number
 * provisioning, and webhook configuration.
 */

import {
  type A2PBrandInput,
  type A2PCampaignInput,
  type ProviderCredentials,
  configureProviderWebhooks,
  getA2PStatus,
  getWebhookUrls,
  listProviderPhoneNumbers,
  provisionPhoneNumber,
  searchAvailablePhoneNumbers,
  skipA2P,
  startProviderOAuth,
  submitA2PBrand,
  submitA2PCampaign,
  validateProviderCredentials,
} from '@/lib/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useWebhookUrls() {
  return useQuery({
    queryKey: queryKeys.providerSetup.webhooks(),
    queryFn: getWebhookUrls,
    staleTime: 5 * 60_000,
  })
}

export function useA2PStatus() {
  return useQuery({
    queryKey: queryKeys.providerSetup.a2pStatus(),
    queryFn: getA2PStatus,
    staleTime: 30_000,
  })
}

export function useListPhoneNumbers(credentials: ProviderCredentials | null) {
  return useQuery({
    queryKey: queryKeys.providerSetup.phoneNumbers(),
    queryFn: () => {
      if (!credentials) throw new Error('credentials required')
      return listProviderPhoneNumbers(credentials)
    },
    enabled: !!credentials,
    staleTime: 60_000,
  })
}

export function useSearchPhoneNumbers(
  credentials: ProviderCredentials | null,
  params: { country: string; areaCode?: string; contains?: string },
  enabled: boolean
) {
  return useQuery({
    queryKey: queryKeys.providerSetup.searchNumbers(params),
    queryFn: () => {
      if (!credentials) throw new Error('credentials required')
      return searchAvailablePhoneNumbers({ ...credentials, ...params })
    },
    enabled: enabled && !!credentials,
    staleTime: 60_000,
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useValidateCredentials() {
  return useMutation({
    mutationFn: validateProviderCredentials,
  })
}

export function useStartOAuth() {
  return useMutation({
    mutationFn: (provider: Parameters<typeof startProviderOAuth>[0]) =>
      startProviderOAuth(provider),
  })
}

export function useProvisionNumber() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: provisionPhoneNumber,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.providerSetup.all })
    },
  })
}

export function useConfigureWebhooks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: configureProviderWebhooks,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.providerSetup.webhooks() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.provider() })
    },
  })
}

export function useSubmitA2PBrand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: A2PBrandInput) => submitA2PBrand(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.providerSetup.a2pStatus() })
    },
  })
}

export function useSubmitA2PCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: A2PCampaignInput) => submitA2PCampaign(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.providerSetup.a2pStatus() })
    },
  })
}

export function useSkipA2P() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: skipA2P,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.providerSetup.a2pStatus() })
    },
  })
}
