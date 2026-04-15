/**
 * React Query hooks for all admin settings endpoints.
 *
 * Each settings domain has a dedicated query hook (staleTime 10min) and an
 * update mutation that invalidates the relevant query on success.
 */

import {
  type CallSettings,
  type IvrAudioRecording,
  type SpamSettings,
  type TelephonyProviderConfig,
  getCallSettings,
  getCustomFields,
  getGeocodingSettings,
  getIvrLanguages,
  getMessagingConfig,
  getRetentionSettings,
  getSpamSettings,
  getTelephonyProvider,
  getTranscriptionSettings,
  getWebAuthnSettings,
  listIvrAudio,
  updateCallSettings,
  updateCustomFields,
  updateGeocodingSettings,
  updateIvrLanguages,
  updateMessagingConfig,
  updateRetentionSettings,
  updateSpamSettings,
  updateTelephonyProvider,
  updateTranscriptionSettings,
  updateWebAuthnSettings,
} from '@/lib/api'
import { decryptArrayFields } from '@/lib/decrypt-fields'
import { decryptHubField } from '@/lib/hub-field-crypto'
import * as keyManager from '@/lib/key-manager'
import { type WebAuthnCredentialInfo, listCredentials } from '@/lib/webauthn'
import { LABEL_USER_PII } from '@shared/crypto-labels'
import type { WebAuthnSettings } from '@shared/schemas'
import type {
  CustomFieldDefinition,
  GeocodingConfigAdmin,
  MessagingConfig,
  RetentionSettings,
  TelephonyProviderDraft,
} from '@shared/types'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

const STALE_10_MIN = 10 * 60_000

// ---------------------------------------------------------------------------
// spamSettingsOptions / useSpamSettings
// ---------------------------------------------------------------------------

const spamSettingsOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings.spam(),
    queryFn: (): Promise<SpamSettings> => getSpamSettings(),
    staleTime: STALE_10_MIN,
  })

function useSpamSettings() {
  return useQuery(spamSettingsOptions())
}

function useUpdateSpamSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<SpamSettings>) => updateSpamSettings(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.spam() })
    },
  })
}

// ---------------------------------------------------------------------------
// callSettingsOptions / useCallSettings
// ---------------------------------------------------------------------------

const callSettingsOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings.call(),
    queryFn: (): Promise<CallSettings> => getCallSettings(),
    staleTime: STALE_10_MIN,
  })

function useCallSettings() {
  return useQuery(callSettingsOptions())
}

function useUpdateCallSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<CallSettings>) => updateCallSettings(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.call() })
    },
  })
}

// ---------------------------------------------------------------------------
// transcriptionSettingsOptions / useTranscriptionSettings
// ---------------------------------------------------------------------------

interface TranscriptionSettings {
  globalEnabled: boolean
  allowUserOptOut: boolean
}

const transcriptionSettingsOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings.transcription(),
    queryFn: (): Promise<TranscriptionSettings> => getTranscriptionSettings(),
    staleTime: STALE_10_MIN,
  })

function useTranscriptionSettings() {
  return useQuery(transcriptionSettingsOptions())
}

function useUpdateTranscriptionSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { globalEnabled?: boolean; allowUserOptOut?: boolean }) =>
      updateTranscriptionSettings(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.transcription() })
    },
  })
}

// ---------------------------------------------------------------------------
// ivrLanguagesOptions / useIvrLanguages
// ---------------------------------------------------------------------------

export const ivrLanguagesOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings.ivrLanguages(),
    queryFn: async (): Promise<string[]> => {
      const res = await getIvrLanguages()
      return res.enabledLanguages ?? []
    },
    staleTime: STALE_10_MIN,
  })

function useIvrLanguages() {
  return useQuery(ivrLanguagesOptions())
}

function useUpdateIvrLanguages() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (enabledLanguages: string[]) => updateIvrLanguages({ enabledLanguages }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.ivrLanguages() })
    },
  })
}

// ---------------------------------------------------------------------------
// ivrAudioOptions / useIvrAudio
// ---------------------------------------------------------------------------

export const ivrAudioOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings.ivrAudio(),
    queryFn: async (): Promise<IvrAudioRecording[]> => {
      const res = await listIvrAudio()
      return res.recordings
    },
    staleTime: STALE_10_MIN,
  })

function useIvrAudio() {
  return useQuery(ivrAudioOptions())
}

// ---------------------------------------------------------------------------
// webAuthnSettingsOptions / useWebAuthnSettings
// ---------------------------------------------------------------------------

const webAuthnSettingsOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings.webauthn(),
    queryFn: (): Promise<WebAuthnSettings> => getWebAuthnSettings(),
    staleTime: STALE_10_MIN,
  })

function useWebAuthnSettings() {
  return useQuery(webAuthnSettingsOptions())
}

function useUpdateWebAuthnSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<WebAuthnSettings>) => updateWebAuthnSettings(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.webauthn() })
    },
  })
}

// ---------------------------------------------------------------------------
// customFieldsOptions / useCustomFields
// ---------------------------------------------------------------------------

export const customFieldsOptions = (hubId = 'global') =>
  queryOptions({
    queryKey: queryKeys.settings.customFields(),
    queryFn: async (): Promise<CustomFieldDefinition[]> => {
      const res = await getCustomFields()
      return Promise.all(
        res.fields.map(async (field) => {
          const decryptedOptions = await decryptHubField(
            field.encryptedOptions,
            hubId,
            field.id,
            'encrypted_options'
          )
          return {
            ...field,
            name: await decryptHubField(
              field.encryptedFieldName,
              hubId,
              field.id,
              'encrypted_field_name'
            ),
            label: await decryptHubField(field.encryptedLabel, hubId, field.id, 'encrypted_label'),
            options: decryptedOptions
              ? (() => {
                  try {
                    return JSON.parse(decryptedOptions) as string[]
                  } catch {
                    return field.options
                  }
                })()
              : field.options,
          }
        })
      )
    },
    staleTime: STALE_10_MIN,
  })

export function useCustomFields(hubId = 'global') {
  return useQuery(customFieldsOptions(hubId))
}

function useUpdateCustomFields() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fields: CustomFieldDefinition[]) => updateCustomFields(fields),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.customFields() })
    },
  })
}

// ---------------------------------------------------------------------------
// providerConfigOptions / useProviderConfig
// ---------------------------------------------------------------------------

const providerConfigOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings.provider(),
    queryFn: (): Promise<TelephonyProviderConfig | null> => getTelephonyProvider(),
    staleTime: STALE_10_MIN,
  })

function useProviderConfig() {
  return useQuery(providerConfigOptions())
}

function useUpdateProviderConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (config: TelephonyProviderDraft) =>
      updateTelephonyProvider(config as TelephonyProviderConfig),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.provider() })
    },
  })
}

// ---------------------------------------------------------------------------
// messagingConfigOptions / useMessagingConfig
// ---------------------------------------------------------------------------

const messagingConfigOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings.messaging(),
    queryFn: (): Promise<MessagingConfig> => getMessagingConfig(),
    staleTime: STALE_10_MIN,
  })

function useMessagingConfig() {
  return useQuery(messagingConfigOptions())
}

function useUpdateMessagingConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<MessagingConfig>) => updateMessagingConfig(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.messaging() })
    },
  })
}

// ---------------------------------------------------------------------------
// geocodingConfigOptions / useGeocodingConfig
// ---------------------------------------------------------------------------

const geocodingConfigOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings.geocoding(),
    queryFn: (): Promise<GeocodingConfigAdmin> => getGeocodingSettings(),
    staleTime: STALE_10_MIN,
  })

function useGeocodingConfig() {
  return useQuery(geocodingConfigOptions())
}

function useUpdateGeocodingConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<GeocodingConfigAdmin>) => updateGeocodingSettings(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.geocoding() })
    },
  })
}

// ---------------------------------------------------------------------------
// retentionSettingsOptions / useRetentionSettings
// ---------------------------------------------------------------------------

const retentionSettingsOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings.retention(),
    queryFn: (): Promise<RetentionSettings> => getRetentionSettings(),
    staleTime: STALE_10_MIN,
  })

function useRetentionSettings() {
  return useQuery(retentionSettingsOptions())
}

function useUpdateRetentionSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<RetentionSettings>) => updateRetentionSettings(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.retention() })
    },
  })
}

// ---------------------------------------------------------------------------
// webAuthnCredsOptions / useWebAuthnCreds
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt the current user's WebAuthn credentials.
 * Label names (encryptedLabel → label) are encrypted with LABEL_USER_PII.
 */
const webAuthnCredsOptions = () =>
  queryOptions({
    queryKey: queryKeys.credentials.mine(),
    queryFn: async (): Promise<WebAuthnCredentialInfo[]> => {
      const creds = await listCredentials()
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          creds as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_USER_PII
        )
      }
      return creds
    },
  })

export function useWebAuthnCreds() {
  return useQuery(webAuthnCredsOptions())
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type {
  CallSettings,
  CustomFieldDefinition,
  GeocodingConfigAdmin,
  IvrAudioRecording,
  MessagingConfig,
  RetentionSettings,
  SpamSettings,
  TelephonyProviderConfig,
  TranscriptionSettings,
  WebAuthnCredentialInfo,
  WebAuthnSettings,
}
