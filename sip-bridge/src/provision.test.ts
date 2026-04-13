import { describe, expect, mock, test } from 'bun:test'
import type { AriClient } from './clients/ari-client'
import { deprovisionEndpoint, provisionEndpoint } from './endpoint-provisioner'

describe('provisionEndpoint', () => {
  test('provisions PJSIP auth, aor, and endpoint via ARI', async () => {
    const ariCalls: Array<{ method: string; configClass: string; objectType: string; id: string }> =
      []

    const mockAri: Pick<AriClient, 'configureDynamic' | 'deleteDynamic'> = {
      configureDynamic: mock(
        async (
          configClass: string,
          objectType: string,
          id: string,
          _fields: Record<string, string>
        ) => {
          ariCalls.push({ method: 'PUT', configClass, objectType, id })
        }
      ),
      deleteDynamic: mock(async () => {}),
    }

    const result = await provisionEndpoint(mockAri, 'abc123def456aabbccdd112233445566')

    expect(result.username).toBe('vol_abc123def456')
    expect(result.password).toBeTruthy()
    expect(result.password.length).toBeGreaterThanOrEqual(32)

    expect(ariCalls).toHaveLength(3)
    expect(ariCalls[0]).toEqual({
      method: 'PUT',
      configClass: 'res_pjsip',
      objectType: 'auth',
      id: 'vol_abc123def456',
    })
    expect(ariCalls[1]).toEqual({
      method: 'PUT',
      configClass: 'res_pjsip',
      objectType: 'aor',
      id: 'vol_abc123def456',
    })
    expect(ariCalls[2]).toEqual({
      method: 'PUT',
      configClass: 'res_pjsip',
      objectType: 'endpoint',
      id: 'vol_abc123def456',
    })
  })

  test('is idempotent — same username for same pubkey', async () => {
    const mockAri: Pick<AriClient, 'configureDynamic' | 'deleteDynamic'> = {
      configureDynamic: mock(async () => {}),
      deleteDynamic: mock(async () => {}),
    }

    const r1 = await provisionEndpoint(mockAri, 'abc123def456aabbccdd112233445566')
    const r2 = await provisionEndpoint(mockAri, 'abc123def456aabbccdd112233445566')

    expect(r1.username).toBe(r2.username)
  })

  test('rolls back on endpoint failure', async () => {
    const deleteCalls: string[] = []
    const mockAri: Pick<AriClient, 'configureDynamic' | 'deleteDynamic'> = {
      configureDynamic: mock(async (_cc: string, objectType: string) => {
        if (objectType === 'endpoint') throw new Error('ARI failure')
      }),
      deleteDynamic: mock(async (_cc: string, objectType: string) => {
        deleteCalls.push(objectType)
      }),
    }

    await expect(provisionEndpoint(mockAri, 'abc123def456aabb')).rejects.toThrow('ARI failure')
    expect(deleteCalls).toContain('aor')
    expect(deleteCalls).toContain('auth')
  })
})

describe('provisionEndpoint — Tier 5 SFrame', () => {
  test('Tier 5: provisioned endpoint forces Opus-only + refuses transcoding', async () => {
    const calls: Array<{
      configClass: string
      objectType: string
      id: string
      fields: Record<string, string>
    }> = []

    const mockAri: Pick<AriClient, 'configureDynamic' | 'deleteDynamic'> = {
      configureDynamic: mock(
        async (
          configClass: string,
          objectType: string,
          id: string,
          fields: Record<string, string>
        ) => {
          calls.push({ configClass, objectType, id, fields })
        }
      ),
      deleteDynamic: mock(async () => {}),
    }

    await provisionEndpoint(mockAri, 'abcdef0123456789')

    const endpointCall = calls.find(
      (c) => c.objectType === 'endpoint' && c.id === 'vol_abcdef012345'
    )
    expect(endpointCall).toBeDefined()

    const fields = endpointCall?.fields ?? {}
    expect(fields.context).toBe('volunteers-sframe')
    expect(fields.allow).toBe('opus')
    expect(fields.disallow).toBe('all')

    const expectedPrefs = 'prefer: pending, operation: intersect, keep: all, transcode: prevent'
    expect(fields.codec_prefs_incoming_offer).toBe(expectedPrefs)
    expect(fields.codec_prefs_outgoing_offer).toBe(expectedPrefs)
    expect(fields.codec_prefs_incoming_answer).toBe(expectedPrefs)
    expect(fields.codec_prefs_outgoing_answer).toBe(expectedPrefs)
  })
})

describe('deprovisionEndpoint', () => {
  test('deprovisions in reverse order: endpoint, aor, auth', async () => {
    const ariCalls: Array<{ objectType: string; id: string }> = []
    const mockAri: Pick<AriClient, 'deleteDynamic'> = {
      deleteDynamic: mock(async (_configClass: string, objectType: string, id: string) => {
        ariCalls.push({ objectType, id })
      }),
    }

    await deprovisionEndpoint(mockAri, 'abc123def456aabbccdd112233445566')

    expect(ariCalls).toHaveLength(3)
    expect(ariCalls[0].objectType).toBe('endpoint')
    expect(ariCalls[1].objectType).toBe('aor')
    expect(ariCalls[2].objectType).toBe('auth')
  })
})
