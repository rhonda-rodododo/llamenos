import { z } from '@hono/zod-openapi'

// --- Shared param schemas ---

export const MlsHubIdParamSchema = z.object({
  hubId: z.string().openapi({ param: { name: 'hubId', in: 'path' }, example: 'hub-abc123' }),
})

export const MlsDeviceIdParamSchema = z.object({
  hubId: z.string().openapi({ param: { name: 'hubId', in: 'path' } }),
  deviceId: z.string().openapi({ param: { name: 'deviceId', in: 'path' } }),
})

// --- POST /api/mls/hub/:hubId/bootstrap ---

export const MlsBootstrapRequestSchema = z.object({
  deviceId: z.string().min(1),
  groupId: z.string().min(1),
})
export type MlsBootstrapRequest = z.infer<typeof MlsBootstrapRequestSchema>

export const MlsBootstrapResponseSchema = z.object({
  hubId: z.string(),
  groupId: z.string(),
  ciphersuite: z.number().int(),
  epoch: z.number().int(),
  createdAt: z.string(),
})
export type MlsBootstrapResponse = z.infer<typeof MlsBootstrapResponseSchema>

// --- POST /api/mls/hub/:hubId/key-packages ---

export const MlsUploadKeyPackagesRequestSchema = z.object({
  deviceId: z.string().min(1),
  keyPackages: z
    .array(
      z.object({
        keyPackageRef: z.string().min(1),
        keyPackageData: z.string().min(1),
      })
    )
    .min(1)
    .max(100),
})
export type MlsUploadKeyPackagesRequest = z.infer<typeof MlsUploadKeyPackagesRequestSchema>

export const MlsUploadKeyPackagesResponseSchema = z.object({
  uploaded: z.number().int(),
})
export type MlsUploadKeyPackagesResponse = z.infer<typeof MlsUploadKeyPackagesResponseSchema>

// --- GET /api/mls/hub/:hubId/key-packages/:deviceId ---

export const MlsFetchKeyPackageResponseSchema = z.object({
  id: z.string(),
  keyPackageRef: z.string(),
  keyPackageData: z.string(),
  keyPackagesRemaining: z.number().int(),
})
export type MlsFetchKeyPackageResponse = z.infer<typeof MlsFetchKeyPackageResponseSchema>

// --- POST /api/mls/hub/:hubId/commits ---

export const MlsCommitRequestSchema = z.object({
  deviceId: z.string().min(1),
  epoch: z.number().int().min(0),
  commitData: z.string().min(1),
  welcomeData: z.string().nullish(),
})
export type MlsCommitRequest = z.infer<typeof MlsCommitRequestSchema>

export const MlsCommitResponseSchema = z.object({
  id: z.string(),
  epoch: z.number().int(),
  hubId: z.string(),
  createdAt: z.string(),
})
export type MlsCommitResponse = z.infer<typeof MlsCommitResponseSchema>

// --- GET /api/mls/hub/:hubId/commits?sinceEpoch=N ---

export const MlsFetchCommitsQuerySchema = z.object({
  sinceEpoch: z.coerce.number().int().min(0).optional(),
})

export const MlsFetchCommitsResponseSchema = z.object({
  commits: z.array(
    z.object({
      id: z.string(),
      epoch: z.number().int(),
      committerDeviceId: z.string(),
      commitData: z.string(),
      welcomeData: z.string().nullable(),
      createdAt: z.string(),
    })
  ),
})
export type MlsFetchCommitsResponse = z.infer<typeof MlsFetchCommitsResponseSchema>

// --- GET /api/mls/hub/:hubId/epoch ---

export const MlsCurrentEpochResponseSchema = z.object({
  hubId: z.string(),
  groupId: z.string(),
  ciphersuite: z.number().int(),
  currentEpoch: z.number().int(),
  lastCommitAt: z.string().nullable(),
})
export type MlsCurrentEpochResponse = z.infer<typeof MlsCurrentEpochResponseSchema>

// --- GET /api/mls/hub/:hubId/key-packages/counts ---

export const MlsKeyPackageCountsResponseSchema = z.object({
  counts: z.array(
    z.object({
      deviceId: z.string(),
      available: z.number().int(),
    })
  ),
})
export type MlsKeyPackageCountsResponse = z.infer<typeof MlsKeyPackageCountsResponseSchema>

// --- POST /api/mls/hub/:hubId/commits/purge ---

export const MlsPurgeEpochResponseSchema = z.object({
  purged: z.number().int(),
  remaining: z.number().int(),
})
export type MlsPurgeEpochResponse = z.infer<typeof MlsPurgeEpochResponseSchema>
