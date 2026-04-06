/**
 * Query key factories for all API resources.
 *
 * Structured keys enable targeted cache invalidation:
 *   queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
 *
 * Each `all` entry is a plain array (not a function) so it serves as the
 * prefix for all sub-keys in that resource, enabling wildcard invalidation.
 */

/**
 * All query key domain names. Used by ENCRYPTED_QUERY_KEYS in query-client.ts
 * to ensure new domains are explicitly classified as encrypted or plaintext.
 */
export type QueryKeyDomain = keyof typeof queryKeys

export const queryKeys = {
  users: {
    all: ['users'] as const,
    list: () => ['users', 'list'] as const,
    detail: (pubkey: string) => ['users', 'detail', pubkey] as const,
  },

  invites: {
    all: ['invites'] as const,
    list: () => ['invites', 'list'] as const,
    channels: () => ['invites', 'channels'] as const,
  },

  contacts: {
    all: ['contacts'] as const,
    list: (filters?: { contactType?: string; riskLevel?: string }) =>
      ['contacts', 'list', filters ?? {}] as const,
    detail: (id: string) => ['contacts', 'detail', id] as const,
    timeline: (id: string) => ['contacts', 'timeline', id] as const,
    relationships: () => ['contacts', 'relationships'] as const,
  },

  notes: {
    all: ['notes'] as const,
    list: (filters?: { callId?: string; page?: number; limit?: number }) =>
      ['notes', 'list', filters ?? {}] as const,
    detail: (id: string) => ['notes', 'detail', id] as const,
  },

  calls: {
    all: ['calls'] as const,
    active: () => ['calls', 'active'] as const,
    history: (filters?: {
      page?: number
      limit?: number
      search?: string
      dateFrom?: string
      dateTo?: string
      voicemailOnly?: boolean
    }) => ['calls', 'history', filters ?? {}] as const,
    detail: (id: string) => ['calls', 'detail', id] as const,
    todayCount: () => ['calls', 'todayCount'] as const,
  },

  shifts: {
    all: ['shifts'] as const,
    list: () => ['shifts', 'list'] as const,
    fallback: () => ['shifts', 'fallback'] as const,
    myStatus: () => ['shifts', 'myStatus'] as const,
  },

  bans: {
    all: ['bans'] as const,
    list: () => ['bans', 'list'] as const,
  },

  audit: {
    all: ['audit'] as const,
    list: (filters?: {
      page?: number
      limit?: number
      actorPubkey?: string
      eventType?: string
      dateFrom?: string
      dateTo?: string
      search?: string
    }) => ['audit', 'list', filters ?? {}] as const,
  },

  reports: {
    all: ['reports'] as const,
    list: (filters?: {
      status?: string
      category?: string
      page?: number
      limit?: number
    }) => ['reports', 'list', filters ?? {}] as const,
    detail: (id: string) => ['reports', 'detail', id] as const,
    messages: (reportId: string) => ['reports', 'messages', reportId] as const,
  },

  blasts: {
    all: ['blasts'] as const,
    list: () => ['blasts', 'list'] as const,
    settings: () => ['blasts', 'settings'] as const,
    subscribers: () => ['blasts', 'subscribers'] as const,
    subscriberStats: () => ['blasts', 'subscriberStats'] as const,
  },

  conversations: {
    all: ['conversations'] as const,
    list: (filters?: {
      status?: string
      channel?: string
      page?: number
      limit?: number
    }) => ['conversations', 'list', filters ?? {}] as const,
    messages: (conversationId: string) => ['conversations', 'messages', conversationId] as const,
  },

  settings: {
    spam: () => ['settings', 'spam'] as const,
    call: () => ['settings', 'call'] as const,
    transcription: () => ['settings', 'transcription'] as const,
    ivrLanguages: () => ['settings', 'ivrLanguages'] as const,
    ivrAudio: () => ['settings', 'ivrAudio'] as const,
    webauthn: () => ['settings', 'webauthn'] as const,
    customFields: () => ['settings', 'customFields'] as const,
    provider: () => ['settings', 'provider'] as const,
    messaging: () => ['settings', 'messaging'] as const,
    geocoding: () => ['settings', 'geocoding'] as const,
    reportTypes: () => ['settings', 'reportTypes'] as const,
    retention: () => ['settings', 'retention'] as const,
  },

  hubs: {
    all: ['hubs'] as const,
    list: () => ['hubs', 'list'] as const,
  },

  preferences: {
    mine: () => ['preferences', 'mine'] as const,
  },

  credentials: {
    mine: () => ['credentials', 'mine'] as const,
  },

  analytics: {
    callVolume: (days?: number) => ['analytics', 'callVolume', days ?? null] as const,
    callHours: () => ['analytics', 'callHours'] as const,
    userStats: () => ['analytics', 'userStats'] as const,
  },

  presence: {
    list: () => ['presence', 'list'] as const,
  },

  roles: {
    all: ['roles'] as const,
    list: () => ['roles', 'list'] as const,
    permissions: () => ['roles', 'permissions'] as const,
  },

  intakes: {
    all: ['intakes'] as const,
    list: (status?: string) => ['intakes', 'list', status ?? ''] as const,
    detail: (id: string) => ['intakes', 'detail', id] as const,
  },

  tags: {
    all: ['tags'] as const,
    list: (hubId?: string) => ['tags', 'list', hubId ?? ''] as const,
  },

  teams: {
    all: ['teams'] as const,
    list: (hubId?: string) => ['teams', 'list', hubId ?? ''] as const,
    detail: (id: string) => ['teams', 'detail', id] as const,
    members: (id: string) => ['teams', 'members', id] as const,
    contacts: (id: string) => ['teams', 'contacts', id] as const,
  },

  provider: {
    health: () => ['provider', 'health'] as const,
  },

  firehose: {
    list: () => ['firehose'] as const,
    detail: (id: string) => ['firehose', id] as const,
    status: () => ['firehose', 'status'] as const,
  },

  security: {
    all: ['security'] as const,
    sessions: () => ['security', 'sessions'] as const,
    passkeys: () => ['security', 'passkeys'] as const,
    history: (params?: { limit?: number }) => ['security', 'history', params ?? {}] as const,
  },
} as const
