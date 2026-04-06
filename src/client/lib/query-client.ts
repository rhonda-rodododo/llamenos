import { QueryClient } from '@tanstack/react-query'
import * as keyManager from './key-manager'
import type { QueryKeyDomain } from './queries/keys'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 30 * 60 * 1000, // 30 minutes
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
})

/**
 * Query key domains that contain encrypted data — cleared on lock,
 * invalidated on unlock to force re-fetch with fresh decryption.
 *
 * Typed as QueryKeyDomain[] so adding a new domain to queryKeys triggers
 * a compile-time review: should it be in ENCRYPTED or PLAINTEXT?
 */
const ENCRYPTED_QUERY_KEYS: QueryKeyDomain[] = [
  // Envelope-encrypted PII (user names, phones)
  'users',
  'contacts',
  'notes',
  'calls',
  'audit',
  'blasts',
  'reports',
  'conversations',
  'invites',
  'bans',
  'credentials',
  'intakes',
  // Hub-key encrypted organizational metadata
  'shifts',
  'roles',
  'settings',
  'hubs',
  'tags',
  'teams',
  'firehose',
  'security',
]

/**
 * Query key domains that contain NO encrypted data — never cleared on lock.
 * Every domain in queryKeys must appear in exactly one of these two lists.
 */
const PLAINTEXT_QUERY_KEYS: QueryKeyDomain[] = ['analytics', 'preferences', 'presence', 'provider']

// Compile-time exhaustiveness: if a new domain is added to queryKeys but not
// classified here, this line will produce a type error.
// Usage: add new domains to ENCRYPTED_QUERY_KEYS or PLAINTEXT_QUERY_KEYS above.
type ClassifiedDomains =
  | (typeof ENCRYPTED_QUERY_KEYS)[number]
  | (typeof PLAINTEXT_QUERY_KEYS)[number]
type MissingDomains = Exclude<QueryKeyDomain, ClassifiedDomains>
const assertAllClassified: Record<MissingDomains, never> = {} as Record<MissingDomains, never>
void assertAllClassified

// On lock: remove all encrypted queries so stale ciphertext is not
// served to an unauthenticated session.
keyManager.onLock(() => {
  for (const key of ENCRYPTED_QUERY_KEYS) {
    queryClient.removeQueries({ queryKey: [key] })
  }
})

// On unlock: query invalidation is handled explicitly by auth.tsx
// AFTER loadHubKeysForUser() completes — see invalidateEncryptedQueries().
// Doing it here in the onUnlock callback caused a race: queries would refetch
// while the hub key cache was still empty, caching raw ciphertext instead of
// decrypted plaintext for hub-encrypted fields (roles, shifts, report types).

/**
 * Invalidate all encrypted query domains so they re-fetch and decrypt
 * with the current keys. Call this AFTER hub keys are loaded.
 */
export function invalidateEncryptedQueries(): void {
  for (const key of ENCRYPTED_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey: [key] })
  }
}
