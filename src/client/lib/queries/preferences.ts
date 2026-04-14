/**
 * React Query hooks for subscriber messaging preferences.
 *
 * Preferences are fetched via a public token (no auth cookie) — the token is
 * passed as a URL query parameter and forwarded to the API.
 */

import { type PreferencesUpdateInput, PreferencesUpdateSchema } from '@shared/schemas/blasts'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_BASE } from '../api/client'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubscriberChannel {
  type: string
  verified: boolean
}

export interface SubscriberPrefs {
  channels: SubscriberChannel[]
  language: string
  status: string
}

// ---------------------------------------------------------------------------
// preferencesOptions
// ---------------------------------------------------------------------------

/**
 * Fetch subscriber preferences by token.
 * Uses staleTime Infinity — preferences don't change in the background;
 * the user updates them manually.
 */
export const preferencesOptions = (token: string) =>
  queryOptions({
    queryKey: queryKeys.preferences.mine(),
    queryFn: async (): Promise<SubscriberPrefs> => {
      const res = await fetch(
        `${API_BASE}/messaging/preferences?token=${encodeURIComponent(token)}`
      )
      if (!res.ok) throw new Error('Invalid token')
      return res.json() as Promise<SubscriberPrefs>
    },
    enabled: !!token,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

// ---------------------------------------------------------------------------
// usePreferences
// ---------------------------------------------------------------------------

export function usePreferences(token: string) {
  return useQuery(preferencesOptions(token))
}

// ---------------------------------------------------------------------------
// useUpdatePreferences
// ---------------------------------------------------------------------------

export function useUpdatePreferences(token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (updates: PreferencesUpdateInput): Promise<SubscriberPrefs> => {
      // Client-side validation: matches server-side schema so we fail fast
      // before even making the network request.
      const parsed = PreferencesUpdateSchema.safeParse(updates)
      if (!parsed.success) {
        throw new Error(`Invalid preferences: ${parsed.error.message}`)
      }
      const res = await fetch(
        `${API_BASE}/messaging/preferences?token=${encodeURIComponent(token)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        }
      )
      if (!res.ok) throw new Error('Update failed')
      return res.json() as Promise<SubscriberPrefs>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.preferences.mine(), updated)
    },
  })
}
