/**
 * Settings Management API Tests
 *
 * Tests admin settings endpoints: call settings, spam settings, custom fields,
 * IVR languages, WebAuthn policy, data retention, setup state, provider health,
 * transcription, geocoding, and fallback group.
 *
 * Each section verifies: read defaults, update, persistence (re-read), and
 * permission guards (volunteer cannot access admin-only endpoints).
 */

import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('Settings Management', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'Settings Test Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── Call Settings ───────────────────────────────────────────────────────

  test.describe('Call Settings', () => {
    test('admin can read call settings', async () => {
      const res = await adminApi.get('/api/settings/call')
      expect(res.status()).toBe(200)
      const body = await res.json()
      // Should have expected structure
      expect(body).toBeDefined()
    })

    test('admin can update call settings', async () => {
      const res = await adminApi.patch('/api/settings/call', {
        queueTimeoutSeconds: 120,
        voicemailMaxSeconds: 60,
      })
      expect(res.status()).toBe(200)
    })

    test('updated call settings persist on re-read', async () => {
      const res = await adminApi.get('/api/settings/call')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.queueTimeoutSeconds).toBe(120)
      expect(body.voicemailMaxSeconds).toBe(60)
    })

    test('admin can set voiceCallE2eePolicy and it round-trips', async () => {
      // Default should be 'preferred' when no prior value.
      const readRes = await adminApi.get('/api/settings/call')
      expect(readRes.status()).toBe(200)
      const readBody = await readRes.json()
      expect(['required', 'preferred', 'off']).toContain(readBody.voiceCallE2eePolicy)

      // Update to 'required'.
      const patchRes = await adminApi.patch('/api/settings/call', {
        voiceCallE2eePolicy: 'required',
      })
      expect(patchRes.status()).toBe(200)
      const patchBody = await patchRes.json()
      expect(patchBody.voiceCallE2eePolicy).toBe('required')

      // Re-read and confirm persistence.
      const reread = await adminApi.get('/api/settings/call')
      const rereadBody = await reread.json()
      expect(rereadBody.voiceCallE2eePolicy).toBe('required')

      // Reset to 'preferred' so downstream tests are not affected by this
      // serial fixture.
      const resetRes = await adminApi.patch('/api/settings/call', {
        voiceCallE2eePolicy: 'preferred',
      })
      expect(resetRes.status()).toBe(200)
    })

    test('voiceCallE2eePolicy rejects invalid values (falls back to current)', async () => {
      const patchRes = await adminApi.patch('/api/settings/call', {
        voiceCallE2eePolicy: 'not-a-valid-policy',
      })
      // Service falls back to current rather than erroring — verify the
      // persisted value remains a valid policy literal.
      expect(patchRes.status()).toBe(200)
      const body = await patchRes.json()
      expect(['required', 'preferred', 'off']).toContain(body.voiceCallE2eePolicy)
    })

    test('user cannot read call settings', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/call')
      expect(res.status()).toBe(403)
    })

    test('user cannot update call settings', async () => {
      const res = await ctx.api('volunteer').patch('/api/settings/call', {
        queueTimeoutSeconds: 999,
      })
      expect(res.status()).toBe(403)
    })
  })

  // ─── Spam Settings ───────────────────────────────────────────────────────

  test.describe('Spam Settings', () => {
    test('admin can read spam settings with expected defaults', async () => {
      const res = await adminApi.get('/api/settings/spam')
      expect(res.status()).toBe(200)
      const body = await res.json()
      // Verify default structure
      expect(typeof body.voiceCaptchaEnabled).toBe('boolean')
      expect(typeof body.rateLimitEnabled).toBe('boolean')
      expect(typeof body.maxCallsPerMinute).toBe('number')
      expect(typeof body.blockDurationMinutes).toBe('number')
      expect(typeof body.captchaMaxAttempts).toBe('number')
    })

    test('admin can update captchaMaxAttempts', async () => {
      const res = await adminApi.patch('/api/settings/spam', {
        captchaMaxAttempts: 5,
        voiceCaptchaEnabled: true,
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.captchaMaxAttempts).toBe(5)
      expect(body.voiceCaptchaEnabled).toBe(true)
    })

    test('updated spam settings persist on re-read', async () => {
      const res = await adminApi.get('/api/settings/spam')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.captchaMaxAttempts).toBe(5)
      expect(body.voiceCaptchaEnabled).toBe(true)
    })

    test('admin can update rate limit fields', async () => {
      const res = await adminApi.patch('/api/settings/spam', {
        rateLimitEnabled: false,
        maxCallsPerMinute: 10,
        blockDurationMinutes: 60,
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.rateLimitEnabled).toBe(false)
      expect(body.maxCallsPerMinute).toBe(10)
      expect(body.blockDurationMinutes).toBe(60)
    })

    test('user cannot read spam settings', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/spam')
      expect(res.status()).toBe(403)
    })

    test('user cannot update spam settings', async () => {
      const res = await ctx.api('volunteer').patch('/api/settings/spam', {
        captchaMaxAttempts: 1,
      })
      expect(res.status()).toBe(403)
    })
  })

  // ─── Custom Fields ───────────────────────────────────────────────────────

  test.describe('Custom Fields', () => {
    const fieldId = `field-test-${Date.now()}`

    test('admin can read custom fields (initially empty or existing)', async () => {
      const res = await adminApi.get('/api/settings/custom-fields')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.fields)).toBe(true)
    })

    test('admin can set custom fields with a text field', async () => {
      const res = await adminApi.put('/api/settings/custom-fields', {
        fields: [
          {
            id: fieldId,
            name: 'test_field',
            label: 'Test Field',
            type: 'text',
            required: false,
            visibleTo: 'contacts:envelope-summary',
            context: 'call-notes',
            order: 0,
          },
        ],
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.fields).toHaveLength(1)
      expect(body.fields[0].id).toBe(fieldId)
      expect(body.fields[0].type).toBe('text')
    })

    test('custom fields persist on re-read', async () => {
      const res = await adminApi.get('/api/settings/custom-fields')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.fields.length).toBeGreaterThanOrEqual(1)
      const field = body.fields.find((f: { id: string }) => f.id === fieldId)
      expect(field).toBeDefined()
      expect(field.type).toBe('text')
      expect(field.required).toBe(false)
    })

    test('admin can replace custom fields with multiple fields', async () => {
      const res = await adminApi.put('/api/settings/custom-fields', {
        fields: [
          {
            id: `field-a-${Date.now()}`,
            name: 'urgency',
            label: 'Urgency Level',
            type: 'select',
            required: true,
            visibleTo: 'contacts:envelope-summary',
            context: 'call-notes',
            order: 0,
            options: ['low', 'medium', 'high'],
          },
          {
            id: `field-b-${Date.now()}`,
            name: 'notes_extra',
            label: 'Additional Notes',
            type: 'text',
            required: false,
            visibleTo: 'contacts:envelope-summary',
            context: 'call-notes',
            order: 1,
          },
        ],
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.fields).toHaveLength(2)
    })

    test('admin can clear all custom fields', async () => {
      const res = await adminApi.put('/api/settings/custom-fields', {
        fields: [],
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.fields).toHaveLength(0)
    })

    test('user can read custom fields (filtered view)', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/custom-fields')
      // Users can read fields (needed for note forms) but get filtered view
      expect(res.status()).toBe(200)
    })

    test('user cannot update custom fields', async () => {
      const res = await ctx.api('volunteer').put('/api/settings/custom-fields', {
        fields: [
          {
            id: 'hack-attempt',
            name: 'hacked',
            label: 'Hacked',
            type: 'text',
            required: false,
            visibleTo: 'contacts:envelope-summary',
            context: 'call-notes',
            order: 0,
          },
        ],
      })
      expect(res.status()).toBe(403)
    })
  })

  // ─── Transcription Settings ──────────────────────────────────────────────

  test.describe('Transcription Settings', () => {
    test('any authenticated user can read transcription settings', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/transcription')
      expect(res.status()).toBe(200)
      const body = await res.json()
      // Should have expected structure
      expect(typeof body.globalEnabled).toBe('boolean')
    })

    test('admin can update transcription settings', async () => {
      const res = await adminApi.patch('/api/settings/transcription', {
        globalEnabled: true,
        allowUserOptOut: true,
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.globalEnabled).toBe(true)
      expect(body.allowUserOptOut).toBe(true)
    })

    test('updated transcription settings persist on re-read', async () => {
      const res = await adminApi.get('/api/settings/transcription')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.globalEnabled).toBe(true)
      expect(body.allowUserOptOut).toBe(true)
    })

    test('admin can disable transcription', async () => {
      const res = await adminApi.patch('/api/settings/transcription', {
        globalEnabled: false,
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.globalEnabled).toBe(false)
    })

    test('user cannot update global transcription settings', async () => {
      const res = await ctx.api('volunteer').patch('/api/settings/transcription', {
        globalEnabled: false,
      })
      expect(res.status()).toBe(403)
    })
  })

  // ─── IVR Languages ──────────────────────────────────────────────────────

  test.describe('IVR Languages', () => {
    test('admin can read IVR languages with default set', async () => {
      const res = await adminApi.get('/api/settings/ivr-languages')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.enabledLanguages)).toBe(true)
      expect(body.enabledLanguages.length).toBeGreaterThan(0)
    })

    test('admin can update IVR languages to a subset', async () => {
      const res = await adminApi.patch('/api/settings/ivr-languages', {
        enabledLanguages: ['en', 'es'],
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.enabledLanguages).toEqual(['en', 'es'])
    })

    test('updated IVR languages persist on re-read', async () => {
      const res = await adminApi.get('/api/settings/ivr-languages')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.enabledLanguages).toEqual(['en', 'es'])
    })

    test('admin can set multiple IVR languages', async () => {
      const res = await adminApi.patch('/api/settings/ivr-languages', {
        enabledLanguages: ['en', 'es', 'zh', 'fr', 'ar'],
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.enabledLanguages).toHaveLength(5)
      expect(body.enabledLanguages).toContain('en')
      expect(body.enabledLanguages).toContain('ar')
    })

    test('invalid language codes are filtered out', async () => {
      const res = await adminApi.patch('/api/settings/ivr-languages', {
        enabledLanguages: ['en', 'xx-invalid', 'es'],
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      // Only valid codes should be stored
      expect(body.enabledLanguages).toContain('en')
      expect(body.enabledLanguages).toContain('es')
      expect(body.enabledLanguages).not.toContain('xx-invalid')
    })

    test('user cannot read IVR languages', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/ivr-languages')
      expect(res.status()).toBe(403)
    })

    test('user cannot update IVR languages', async () => {
      const res = await ctx.api('volunteer').patch('/api/settings/ivr-languages', {
        enabledLanguages: ['en'],
      })
      expect(res.status()).toBe(403)
    })
  })

  // ─── WebAuthn Settings ───────────────────────────────────────────────────

  test.describe('WebAuthn Settings', () => {
    test('admin can read WebAuthn settings', async () => {
      const res = await adminApi.get('/api/settings/webauthn')
      expect(res.status()).toBe(200)
    })

    test('admin can update WebAuthn settings', async () => {
      const res = await adminApi.patch('/api/settings/webauthn', {
        required: false,
      })
      expect(res.status()).toBe(200)
    })

    test('user cannot manage WebAuthn settings', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/webauthn')
      expect(res.status()).toBe(403)
    })
  })

  // ─── Data Retention (GDPR) ──────────────────────────────────────────────

  test.describe('Data Retention', () => {
    test('admin can read retention settings', async () => {
      const res = await adminApi.get('/api/settings/retention')
      expect(res.status()).toBe(200)
    })

    test('admin can update retention settings', async () => {
      const res = await adminApi.put('/api/settings/retention', {
        callRecordRetentionDays: 365,
        auditLogRetentionDays: 730,
      })
      expect(res.status()).toBe(200)
    })

    test('user cannot manage retention settings', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/retention')
      expect(res.status()).toBe(403)
    })
  })

  // ─── Setup State ─────────────────────────────────────────────────────────

  test.describe('Setup State', () => {
    test('admin can read setup state', async () => {
      const res = await adminApi.get('/api/settings/setup')
      expect(res.status()).toBe(200)
    })

    test('user cannot read setup state', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/setup')
      expect(res.status()).toBe(403)
    })
  })

  // ─── Provider Health ─────────────────────────────────────────────────────

  test.describe('Provider Health', () => {
    test('admin can check provider health', async () => {
      const res = await adminApi.get('/api/settings/provider-health')
      expect(res.status()).toBe(200)
    })
  })

  // ─── Permissions Catalog ─────────────────────────────────────────────────

  test.describe('Permissions Catalog', () => {
    test('returns complete permissions organized by domain', async () => {
      const res = await adminApi.get('/api/settings/permissions')
      expect(res.status()).toBe(200)
      const body = await res.json()

      expect(body.permissions).toBeDefined()
      expect(body.byDomain).toBeDefined()

      // Verify key domains exist
      const expectedDomains = ['calls', 'notes', 'bans', 'shifts', 'settings', 'audit', 'users']
      for (const domain of expectedDomains) {
        expect(body.byDomain[domain], `domain '${domain}' should exist`).toBeDefined()
      }
    })

    test('user cannot read permissions catalog', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/permissions')
      expect(res.status()).toBe(403)
    })
  })

  // ─── Fallback Group ─────────────────────────────────────────────────────

  test.describe('Fallback Group', () => {
    test('admin can read fallback group (initially empty)', async () => {
      const res = await adminApi.get('/api/settings/fallback-group')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.pubkeys)).toBe(true)
    })

    test('admin can set fallback group pubkeys', async () => {
      const fakePubkey1 = 'a'.repeat(64)
      const fakePubkey2 = 'b'.repeat(64)
      const res = await adminApi.put('/api/settings/fallback-group', {
        pubkeys: [fakePubkey1, fakePubkey2],
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.pubkeys).toEqual([fakePubkey1, fakePubkey2])
    })

    test('fallback group pubkeys persist on re-read', async () => {
      const res = await adminApi.get('/api/settings/fallback-group')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.pubkeys).toHaveLength(2)
      expect(body.pubkeys[0]).toBe('a'.repeat(64))
      expect(body.pubkeys[1]).toBe('b'.repeat(64))
    })

    test('admin can clear fallback group', async () => {
      const res = await adminApi.put('/api/settings/fallback-group', {
        pubkeys: [],
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.pubkeys).toEqual([])
    })

    test('user cannot read fallback group', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/fallback-group')
      expect(res.status()).toBe(403)
    })

    test('user cannot update fallback group', async () => {
      const res = await ctx.api('volunteer').put('/api/settings/fallback-group', {
        pubkeys: ['c'.repeat(64)],
      })
      expect(res.status()).toBe(403)
    })
  })

  // ─── Geocoding Settings ──────────────────────────────────────────────────

  test.describe('Geocoding Settings', () => {
    test('admin can read geocoding config', async () => {
      const res = await adminApi.get('/api/geocoding/settings')
      expect(res.status()).toBe(200)
      const body = await res.json()
      // Should have expected structure with defaults
      expect(typeof body.enabled).toBe('boolean')
      expect('provider' in body).toBe(true)
    })

    test('admin can update geocoding config', async () => {
      const res = await adminApi.patch('/api/geocoding/settings', {
        provider: 'opencage',
        enabled: true,
        countries: ['US', 'MX'],
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.provider).toBe('opencage')
      expect(body.enabled).toBe(true)
      expect(body.countries).toEqual(['US', 'MX'])
    })

    test('updated geocoding config persists on re-read', async () => {
      const res = await adminApi.get('/api/geocoding/settings')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.provider).toBe('opencage')
      expect(body.enabled).toBe(true)
      expect(body.countries).toEqual(['US', 'MX'])
    })

    test('admin can read public geocoding config (no apiKey exposed)', async () => {
      const res = await adminApi.get('/api/geocoding/config')
      expect(res.status()).toBe(200)
      const body = await res.json()
      // Public endpoint should not expose apiKey
      expect(body.apiKey).toBeUndefined()
      expect(typeof body.enabled).toBe('boolean')
    })

    test('user cannot read admin geocoding settings', async () => {
      const res = await ctx.api('volunteer').get('/api/geocoding/settings')
      expect(res.status()).toBe(403)
    })

    test('user cannot update geocoding settings', async () => {
      const res = await ctx.api('volunteer').patch('/api/geocoding/settings', {
        provider: 'opencage',
      })
      expect(res.status()).toBe(403)
    })

    test('user can read public geocoding config', async () => {
      // Public config is available to any authenticated user
      const res = await ctx.api('volunteer').get('/api/geocoding/config')
      expect(res.status()).toBe(200)
    })
  })
})
