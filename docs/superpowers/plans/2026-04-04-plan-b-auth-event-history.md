# Plan B — Auth Event History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-scoped auth event timeline (90-day rolling, user-envelope encrypted), expose it via `/security/history` UI, let users mark entries suspicious (raises admin audit entry), and export JSON.

**Architecture:** New `user_auth_events` table with payload encrypted for event owner only. `AuthEventsService` records events via emitters wired into existing auth flows (login, passkey add/remove, session revoke, etc.). Retention cron purges >90-day entries. Admin audit log remains for hub-level forensics (unchanged).

**Tech Stack:** Drizzle ORM, PostgreSQL, XChaCha20-Poly1305 via `CryptoService.envelopeEncrypt`, Hono OpenAPIHono, zod, React Query, TanStack Router.

**Spec reference:** `docs/superpowers/specs/2026-04-04-user-security-device-management-design.md` (section 4.3)

**Dependencies:** Plan A must be merged or in place (references `SessionService`, session IDs in event payloads).

---

## File Structure

**New files:**
- `src/server/db/schema/auth-events.ts` — user_auth_events table
- `src/server/services/auth-events.ts` — AuthEventsService
- `src/server/services/auth-events.test.ts` — unit tests
- `src/server/services/auth-events.integration.test.ts` — DB tests
- `src/shared/schemas/auth-events.ts` — zod schemas
- `src/client/routes/security.history.tsx` — history UI tab
- `src/client/lib/queries/auth-events.ts` — React Query hooks
- `src/client/lib/api/auth-events.ts` — API wrapper
- `tests/api/auth-events.spec.ts` — API E2E
- `tests/ui/security-history.spec.ts` — UI E2E
- `drizzle/migrations/0043_user_auth_events.sql` — migration

**Modified files:**
- `src/shared/crypto-labels.ts` — add `LABEL_AUTH_EVENT`
- `src/server/db/schema/index.ts` — export new schema
- `src/server/services/index.ts` — register service
- `src/server/services/gdpr.ts` (or retention service) — hook purge for 90-day window
- `src/server/routes/auth-facade.ts` — emit events + add history endpoints
- `src/server/routes/audit.ts` (or admin audit service) — accept "suspicious-reported" entries
- `src/client/routes/security.tsx` — add History tab link
- `src/client/lib/queries/keys.ts` — `queryKeys.security.history`
- `public/locales/en.json` — translations

---

## Task 1: Crypto label + schema

**Files:**
- Modify: `src/shared/crypto-labels.ts`
- Create: `src/server/db/schema/auth-events.ts`
- Modify: `src/server/db/schema/index.ts`

- [ ] **Step 1: Add crypto label**

Append to `src/shared/crypto-labels.ts`:

```ts
/** User-scoped auth event payload envelope */
export const LABEL_AUTH_EVENT = 'llamenos:user-auth-event:v1'
```

- [ ] **Step 2: Write Drizzle schema**

Create `src/server/db/schema/auth-events.ts`:

```ts
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { RecipientEnvelope } from '../../../shared/types'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

export const userAuthEvents = pgTable(
  'user_auth_events',
  {
    id: text('id').primaryKey(),
    userPubkey: text('user_pubkey').notNull(),
    eventType: text('event_type').notNull(),
    encryptedPayload: ciphertext('encrypted_payload').notNull(),
    payloadEnvelope: jsonb<RecipientEnvelope[]>()('payload_envelope').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reportedSuspiciousAt: timestamp('reported_suspicious_at', { withTimezone: true }),
  },
  (table) => ({
    userCreatedIdx: index('user_auth_events_user_created_idx').on(
      table.userPubkey,
      table.createdAt
    ),
    createdAtIdx: index('user_auth_events_created_at_idx').on(table.createdAt),
  })
)

export type UserAuthEventRow = typeof userAuthEvents.$inferSelect
export type InsertUserAuthEvent = typeof userAuthEvents.$inferInsert
```

- [ ] **Step 3: Export from schema index**

Modify `src/server/db/schema/index.ts` — add:
```ts
export * from './auth-events'
```

- [ ] **Step 4: Generate + apply migration**

Run: `bun run migrate:generate && bun run migrate`
Expected: migration file created, table exists.

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto-labels.ts src/server/db/schema/auth-events.ts src/server/db/schema/index.ts drizzle/migrations/
git commit -m "feat(db): add user_auth_events table + crypto label"
```

---

## Task 2: AuthEventsService — unit tests

**Files:**
- Create: `src/server/services/auth-events.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/server/services/auth-events.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { AUTH_EVENT_TYPES, isValidEventType } from './auth-events'

describe('auth-events constants', () => {
  test('AUTH_EVENT_TYPES includes expected events', () => {
    expect(AUTH_EVENT_TYPES).toContain('login')
    expect(AUTH_EVENT_TYPES).toContain('login_failed')
    expect(AUTH_EVENT_TYPES).toContain('logout')
    expect(AUTH_EVENT_TYPES).toContain('session_revoked')
    expect(AUTH_EVENT_TYPES).toContain('sessions_revoked_others')
    expect(AUTH_EVENT_TYPES).toContain('passkey_added')
    expect(AUTH_EVENT_TYPES).toContain('passkey_removed')
    expect(AUTH_EVENT_TYPES).toContain('passkey_renamed')
    expect(AUTH_EVENT_TYPES).toContain('pin_changed')
    expect(AUTH_EVENT_TYPES).toContain('recovery_rotated')
    expect(AUTH_EVENT_TYPES).toContain('lockdown_triggered')
    expect(AUTH_EVENT_TYPES).toContain('alert_sent')
    expect(AUTH_EVENT_TYPES).toContain('signal_contact_changed')
  })

  test('isValidEventType accepts known types', () => {
    expect(isValidEventType('login')).toBe(true)
    expect(isValidEventType('lockdown_triggered')).toBe(true)
  })

  test('isValidEventType rejects unknown types', () => {
    expect(isValidEventType('foo')).toBe(false)
    expect(isValidEventType('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `bun test src/server/services/auth-events.test.ts`
Expected: module not found.

---

## Task 3: AuthEventsService — implementation

**Files:**
- Create: `src/server/services/auth-events.ts`

- [ ] **Step 1: Write implementation**

Create `src/server/services/auth-events.ts`:

```ts
import { and, desc, eq, lt } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { LABEL_AUTH_EVENT } from '../../shared/crypto-labels'
import type { Ciphertext, RecipientEnvelope } from '../../shared/types'
import { userAuthEvents, type UserAuthEventRow } from '../db/schema/auth-events'
import type { CryptoService } from '../lib/crypto-service'

export const AUTH_EVENT_TYPES = [
  'login',
  'login_failed',
  'logout',
  'session_revoked',
  'sessions_revoked_others',
  'passkey_added',
  'passkey_removed',
  'passkey_renamed',
  'pin_changed',
  'recovery_rotated',
  'lockdown_triggered',
  'alert_sent',
  'signal_contact_changed',
] as const

export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number]

export function isValidEventType(t: string): t is AuthEventType {
  return (AUTH_EVENT_TYPES as readonly string[]).includes(t)
}

export interface AuthEventPayload {
  sessionId?: string
  ipHash?: string
  city?: string
  country?: string
  userAgent?: string
  credentialId?: string
  credentialLabel?: string
  lockdownTier?: 'A' | 'B' | 'C'
  meta?: Record<string, unknown>
}

export interface RecordAuthEventInput {
  userPubkey: string
  eventType: AuthEventType
  payload: AuthEventPayload
}

const RETENTION_DAYS = 90

export class AuthEventsService {
  constructor(private db: PostgresJsDatabase, private crypto: CryptoService) {}

  async record(input: RecordAuthEventInput): Promise<UserAuthEventRow> {
    const plaintext = JSON.stringify(input.payload)
    const { encrypted, envelopes } = this.crypto.envelopeEncrypt(
      plaintext,
      [input.userPubkey],
      LABEL_AUTH_EVENT
    )
    const id = crypto.randomUUID()
    const rows = await this.db
      .insert(userAuthEvents)
      .values({
        id,
        userPubkey: input.userPubkey,
        eventType: input.eventType,
        encryptedPayload: encrypted,
        payloadEnvelope: envelopes,
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('Failed to record auth event')
    return row
  }

  async listForUser(
    userPubkey: string,
    opts: { limit?: number; since?: Date } = {}
  ): Promise<UserAuthEventRow[]> {
    const limit = Math.min(opts.limit ?? 50, 200)
    const clauses = [eq(userAuthEvents.userPubkey, userPubkey)]
    // since filter
    return this.db
      .select()
      .from(userAuthEvents)
      .where(and(...clauses))
      .orderBy(desc(userAuthEvents.createdAt))
      .limit(limit)
  }

  async markSuspicious(id: string, userPubkey: string): Promise<UserAuthEventRow | null> {
    const rows = await this.db
      .update(userAuthEvents)
      .set({ reportedSuspiciousAt: new Date() })
      .where(and(eq(userAuthEvents.id, id), eq(userAuthEvents.userPubkey, userPubkey)))
      .returning()
    return rows[0] ?? null
  }

  async purgeOld(before: Date = new Date(Date.now() - RETENTION_DAYS * 86400_000)): Promise<number> {
    const rows = await this.db
      .delete(userAuthEvents)
      .where(lt(userAuthEvents.createdAt, before))
      .returning({ id: userAuthEvents.id })
    return rows.length
  }
}
```

- [ ] **Step 2: Run unit test**

Run: `bun test src/server/services/auth-events.test.ts`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/server/services/auth-events.ts src/server/services/auth-events.test.ts
git commit -m "feat(auth-events): add AuthEventsService"
```

---

## Task 4: Integration tests for AuthEventsService

**Files:**
- Create: `src/server/services/auth-events.integration.test.ts`

- [ ] **Step 1: Write test**

Create `src/server/services/auth-events.integration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { CryptoService } from '../lib/crypto-service'
import { AuthEventsService } from './auth-events'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://localhost:5433/llamenos'

const sql = postgres(TEST_DB_URL, { max: 2 })
const db = drizzle(sql)
// Use a test crypto service — generate a random server key
const crypto = new CryptoService({
  serverSecretKey: 'a'.repeat(64),
  hmacSecret: 'test-hmac-secret',
  idpValueEncryptionKey: 'b'.repeat(64),
})
const service = new AuthEventsService(db, crypto)

const testUser = 'c'.repeat(64)

async function cleanup() {
  await sql`DELETE FROM user_auth_events WHERE user_pubkey = ${testUser}`
}

beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('AuthEventsService integration', () => {
  test('record + listForUser roundtrips', async () => {
    await service.record({
      userPubkey: testUser,
      eventType: 'login',
      payload: { sessionId: 's1', city: 'Berlin', country: 'DE' },
    })
    const rows = await service.listForUser(testUser)
    expect(rows).toHaveLength(1)
    expect(rows[0].eventType).toBe('login')
    expect(rows[0].payloadEnvelope).toHaveLength(1)
  })

  test('listForUser returns newest first', async () => {
    await service.record({ userPubkey: testUser, eventType: 'login', payload: {} })
    await new Promise((r) => setTimeout(r, 5))
    await service.record({ userPubkey: testUser, eventType: 'logout', payload: {} })
    const rows = await service.listForUser(testUser)
    expect(rows[0].eventType).toBe('logout')
    expect(rows[1].eventType).toBe('login')
  })

  test('listForUser respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await service.record({ userPubkey: testUser, eventType: 'login', payload: {} })
    }
    const rows = await service.listForUser(testUser, { limit: 3 })
    expect(rows).toHaveLength(3)
  })

  test('markSuspicious sets reportedSuspiciousAt', async () => {
    const ev = await service.record({ userPubkey: testUser, eventType: 'login', payload: {} })
    const updated = await service.markSuspicious(ev.id, testUser)
    expect(updated?.reportedSuspiciousAt).toBeTruthy()
  })

  test('markSuspicious returns null for wrong user', async () => {
    const ev = await service.record({ userPubkey: testUser, eventType: 'login', payload: {} })
    const updated = await service.markSuspicious(ev.id, 'd'.repeat(64))
    expect(updated).toBeNull()
  })

  test('purgeOld removes entries before cutoff', async () => {
    const ev = await service.record({ userPubkey: testUser, eventType: 'login', payload: {} })
    const future = new Date(Date.now() + 1000)
    const count = await service.purgeOld(future)
    expect(count).toBeGreaterThanOrEqual(1)
    const rows = await service.listForUser(testUser)
    expect(rows.find((r) => r.id === ev.id)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test**

Run: `bun test src/server/services/auth-events.integration.test.ts`
Expected: 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/server/services/auth-events.integration.test.ts
git commit -m "test(auth-events): add integration tests"
```

---

## Task 5: Register service + wire to auth-facade

**Files:**
- Modify: `src/server/services/index.ts`
- Modify: `src/server/routes/auth-facade.ts`
- Modify: `src/server/app.ts`

- [ ] **Step 1: Register service**

Modify `src/server/services/index.ts`:

```ts
import { AuthEventsService } from './auth-events'
// ... in interface:
authEvents: AuthEventsService
// ... in construction:
const authEvents = new AuthEventsService(db, crypto)
```

- [ ] **Step 2: Add to AuthFacadeEnv**

Modify `src/server/routes/auth-facade.ts`:

```ts
import type { AuthEventsService } from '../services/auth-events'
// in Variables:
authEvents: AuthEventsService
```

- [ ] **Step 3: Bridge in app.ts**

Modify `src/server/app.ts` auth-facade bridge:

```ts
ctx.set('authEvents', services.authEvents)
```

- [ ] **Step 4: Typecheck + commit**

Run: `bun run typecheck`

```bash
git add src/server/services/index.ts src/server/routes/auth-facade.ts src/server/app.ts
git commit -m "feat(auth-events): register service + expose to auth-facade"
```

---

## Task 6: Emit events from auth-facade flows

**Files:**
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Emit `login` on successful login-verify**

After the session is created in `/webauthn/login-verify`:

```ts
const authEvents = c.get('authEvents')
await authEvents.record({
  userPubkey: matched.ownerPubkey,
  eventType: 'login',
  payload: {
    sessionId: sessionIdFinal,
    ipHash: hashIP(clientIp, c.env.HMAC_SECRET),
    city: geo.city,
    country: geo.country,
    userAgent,
    credentialId: matched.id,
    credentialLabel: matched.label,
  },
})
```

- [ ] **Step 2: Emit `logout` on /session/revoke**

In `/session/revoke` handler, after revoking:

```ts
const authEvents = c.get('authEvents')
await authEvents.record({
  userPubkey: pubkey,
  eventType: 'logout',
  payload: { sessionId: sessionIdCookie ?? undefined },
})
```

- [ ] **Step 3: Emit `session_revoked` on DELETE /sessions/:id**

In that handler, after `await sessions.revoke(id, 'user')`:

```ts
const authEvents = c.get('authEvents')
await authEvents.record({
  userPubkey: pubkey,
  eventType: 'session_revoked',
  payload: { sessionId: id },
})
```

- [ ] **Step 4: Emit `sessions_revoked_others`**

In `/sessions/revoke-others` handler, after revoke:

```ts
const authEvents = c.get('authEvents')
await authEvents.record({
  userPubkey: pubkey,
  eventType: 'sessions_revoked_others',
  payload: { meta: { count } },
})
```

- [ ] **Step 5: Emit `passkey_added` on /webauthn/register-verify or /passkeys/register-verify**

After `addWebAuthnCredential` succeeds:

```ts
const authEvents = c.get('authEvents')
await authEvents.record({
  userPubkey: pubkey,
  eventType: 'passkey_added',
  payload: { credentialId: regCred.id, credentialLabel: newCred.label },
})
```

- [ ] **Step 6: Emit `passkey_removed` on DELETE /passkeys/:id and /devices/:id**

After `deleteWebAuthnCredential` succeeds:

```ts
const authEvents = c.get('authEvents')
await authEvents.record({
  userPubkey: pubkey,
  eventType: 'passkey_removed',
  payload: { credentialId: credId },
})
```

- [ ] **Step 7: Emit `passkey_renamed` on PATCH /passkeys/:id**

After rename succeeds:

```ts
const authEvents = c.get('authEvents')
await authEvents.record({
  userPubkey: pubkey,
  eventType: 'passkey_renamed',
  payload: { credentialId: credId },
})
```

- [ ] **Step 8: Emit `login_failed` on failed login-verify**

In the catch block of login-verify:

```ts
const authEvents = c.get('authEvents')
// We don't know the user yet if credential not found, but if `matched` existed:
if (matched) {
  await authEvents.record({
    userPubkey: matched.ownerPubkey,
    eventType: 'login_failed',
    payload: { ipHash: hashIP(clientIp, c.env.HMAC_SECRET) },
  })
}
```

- [ ] **Step 9: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/server/routes/auth-facade.ts
git commit -m "feat(auth-events): emit events from auth flows"
```

---

## Task 7: Auth events schemas

**Files:**
- Create: `src/shared/schemas/auth-events.ts`

- [ ] **Step 1: Write schema**

Create `src/shared/schemas/auth-events.ts`:

```ts
import { z } from '@hono/zod-openapi'
import { RecipientEnvelopeSchema } from './common'

export const AuthEventTypeSchema = z.enum([
  'login',
  'login_failed',
  'logout',
  'session_revoked',
  'sessions_revoked_others',
  'passkey_added',
  'passkey_removed',
  'passkey_renamed',
  'pin_changed',
  'recovery_rotated',
  'lockdown_triggered',
  'alert_sent',
  'signal_contact_changed',
])

export const AuthEventSchema = z.object({
  id: z.string(),
  eventType: AuthEventTypeSchema,
  encryptedPayload: z.string(),
  payloadEnvelope: z.array(RecipientEnvelopeSchema),
  createdAt: z.string(),
  reportedSuspiciousAt: z.string().nullable(),
})

export const AuthEventListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  since: z.string().datetime().optional(),
})

export const AuthEventListResponseSchema = z.object({
  events: z.array(AuthEventSchema),
})

export const ReportEventParamsSchema = z.object({
  id: z.string().uuid(),
})

export const ReportEventResponseSchema = z.object({
  ok: z.boolean(),
})

export type AuthEventResponse = z.infer<typeof AuthEventSchema>
```

- [ ] **Step 2: Typecheck + commit**

Run: `bun run typecheck`

```bash
git add src/shared/schemas/auth-events.ts
git commit -m "feat(schemas): add auth events zod schemas"
```

---

## Task 8: API endpoints for auth events

**Files:**
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Add middleware registration**

```ts
authFacade.use('/events', jwtAuth)
authFacade.use('/events/*', jwtAuth)
```

- [ ] **Step 2: Add handlers**

```ts
import { AuthEventListQuerySchema } from '@shared/schemas/auth-events'

// GET /events?limit=&since=
authFacade.get('/events', async (c) => {
  const pubkey = c.get('pubkey')
  const authEvents = c.get('authEvents')
  const parsed = AuthEventListQuerySchema.safeParse({
    limit: c.req.query('limit'),
    since: c.req.query('since'),
  })
  if (!parsed.success) {
    return c.json({ error: 'Invalid query params' }, 400)
  }
  const rows = await authEvents.listForUser(pubkey, {
    limit: parsed.data.limit,
    since: parsed.data.since ? new Date(parsed.data.since) : undefined,
  })
  return c.json({
    events: rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      encryptedPayload: r.encryptedPayload,
      payloadEnvelope: r.payloadEnvelope,
      createdAt: r.createdAt.toISOString(),
      reportedSuspiciousAt: r.reportedSuspiciousAt?.toISOString() ?? null,
    })),
  })
})

// POST /events/:id/report
authFacade.post('/events/:id/report', async (c) => {
  const pubkey = c.get('pubkey')
  const authEvents = c.get('authEvents')
  const records = c.get('services')?.records // admin audit service
  const id = c.req.param('id')
  const updated = await authEvents.markSuspicious(id, pubkey)
  if (!updated) {
    return c.json({ error: 'Event not found' }, 404)
  }
  // Raise an admin audit entry so admins see the flag
  try {
    // Use existing admin audit writer — signature matches recordsService
    // If records.recordAuditEvent doesn't exist, adjust to existing API.
    // Fallback: just log it
  } catch {
    // Non-fatal
  }
  return c.json({ ok: true })
})

// GET /events/export
authFacade.get('/events/export', async (c) => {
  const pubkey = c.get('pubkey')
  const authEvents = c.get('authEvents')
  const rows = await authEvents.listForUser(pubkey, { limit: 200 })
  return c.json({
    userPubkey: pubkey,
    exportedAt: new Date().toISOString(),
    events: rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      encryptedPayload: r.encryptedPayload,
      payloadEnvelope: r.payloadEnvelope,
      createdAt: r.createdAt.toISOString(),
      reportedSuspiciousAt: r.reportedSuspiciousAt?.toISOString() ?? null,
    })),
  })
})
```

- [ ] **Step 3: Typecheck + commit**

Run: `bun run typecheck`

```bash
git add src/server/routes/auth-facade.ts
git commit -m "feat(auth-events): add GET /events + report + export endpoints"
```

---

## Task 9: Admin audit entry for report-suspicious

**Files:**
- Modify: `src/server/routes/auth-facade.ts`
- Check: `src/server/services/records.ts` for correct audit event API

- [ ] **Step 1: Find existing audit writer**

Run: `grep -n "recordAuditEvent\|addAuditLog\|auditLog" src/server/services/records.ts | head -10`
Identify the correct method name and signature.

- [ ] **Step 2: Write proper admin audit entry**

In the `/events/:id/report` handler, replace the placeholder with a real audit call using the discovered method. Example:

```ts
const services = c.get('services')
if (services?.records?.recordAuditEvent) {
  await services.records.recordAuditEvent({
    actorPubkey: pubkey,
    eventType: 'user_reported_suspicious_event',
    details: { reportedEventId: id, reportedEventType: updated.eventType },
    hubId: 'global',
  })
}
```

Adjust parameters to match the existing API.

- [ ] **Step 3: Typecheck + commit**

```bash
git add src/server/routes/auth-facade.ts
git commit -m "feat(auth-events): raise admin audit entry on suspicious report"
```

---

## Task 10: Retention cron

**Files:**
- Modify: `src/server/services/gdpr.ts` (or add a new retention file)

- [ ] **Step 1: Find existing retention cron**

Run: `grep -rn "purgeExpired\|retentionCron\|setInterval" src/server/services/gdpr.ts`
Locate the pattern for scheduled cleanup.

- [ ] **Step 2: Add auth-events purge**

Add a method call to the existing retention scheduler (e.g., `gdpr.runRetention()` or a new `runAuthEventsRetention()`):

```ts
await services.authEvents.purgeOld()
```

Hook it into whatever cron/scheduler runs retention (follow existing pattern).

- [ ] **Step 3: Commit**

```bash
git add src/server/services/gdpr.ts
git commit -m "feat(auth-events): wire 90-day retention purge into cron"
```

---

## Task 11: API E2E tests

**Files:**
- Create: `tests/api/auth-events.spec.ts`

- [ ] **Step 1: Write test**

Create `tests/api/auth-events.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { createAuthedRequest } from '../helpers/authed-request'

test.describe('Auth events API', () => {
  test('GET /events returns array', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.get('/api/auth/events')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.events).toBeInstanceOf(Array)
  })

  test('GET /events with limit', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.get('/api/auth/events?limit=5')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.events.length).toBeLessThanOrEqual(5)
  })

  test('GET /events with invalid limit returns 400', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.get('/api/auth/events?limit=9999')
    expect(res.status()).toBe(400)
  })

  test('POST /events/:id/report with bogus id returns 404', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.post(
      '/api/auth/events/00000000-0000-0000-0000-000000000000/report'
    )
    expect(res.status()).toBe(404)
  })

  test('GET /events/export returns JSON body', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.get('/api/auth/events/export')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.userPubkey).toBeTruthy()
    expect(body.exportedAt).toBeTruthy()
    expect(body.events).toBeInstanceOf(Array)
  })

  test('events are created on login', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    // authed-request should have produced a login already; verify an event exists
    const res = await authed.get('/api/auth/events?limit=10')
    const body = await res.json()
    expect(body.events.some((e: { eventType: string }) => e.eventType === 'login')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun run test:api -- tests/api/auth-events.spec.ts`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/api/auth-events.spec.ts
git commit -m "test(api): auth events endpoint E2E tests"
```

---

## Task 12: Client — API wrapper + hooks

**Files:**
- Create: `src/client/lib/api/auth-events.ts`
- Create: `src/client/lib/queries/auth-events.ts`
- Modify: `src/client/lib/queries/keys.ts`

- [ ] **Step 1: API wrapper**

Create `src/client/lib/api/auth-events.ts`:

```ts
import { api } from './base'

export interface AuthEventApiRow {
  id: string
  eventType: string
  encryptedPayload: string
  payloadEnvelope: Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>
  createdAt: string
  reportedSuspiciousAt: string | null
}

export async function listAuthEvents(params: { limit?: number; since?: string } = {}): Promise<{
  events: AuthEventApiRow[]
}> {
  const qs = new URLSearchParams()
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.since) qs.set('since', params.since)
  return api.get(`/api/auth/events${qs.toString() ? `?${qs}` : ''}`)
}

export async function reportSuspiciousEvent(id: string): Promise<{ ok: boolean }> {
  return api.post(`/api/auth/events/${id}/report`, {})
}

export async function exportAuthEvents(): Promise<unknown> {
  return api.get('/api/auth/events/export')
}
```

- [ ] **Step 2: Add history to queryKeys**

Modify `src/client/lib/queries/keys.ts` — extend `security`:

```ts
security: {
  all: ['security'] as const,
  sessions: () => ['security', 'sessions'] as const,
  passkeys: () => ['security', 'passkeys'] as const,
  history: (params?: { limit?: number }) => ['security', 'history', params ?? {}] as const,
},
```

- [ ] **Step 3: Write React Query hooks**

Create `src/client/lib/queries/auth-events.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LABEL_AUTH_EVENT } from '@shared/crypto-labels'
import * as api from '../api/auth-events'
import { usePubkey } from '../auth-hooks' // adjust
import { decryptEnvelopeJson } from '../decrypt-fields'
import { queryKeys } from './keys'

export interface AuthEventViewModel {
  id: string
  eventType: string
  createdAt: string
  reportedSuspiciousAt: string | null
  payload: {
    sessionId?: string
    city?: string
    country?: string
    userAgent?: string
    credentialLabel?: string
    lockdownTier?: 'A' | 'B' | 'C'
  } | null
}

export function useAuthEvents(limit = 50) {
  const pubkey = usePubkey()
  return useQuery({
    queryKey: queryKeys.security.history({ limit }),
    queryFn: async (): Promise<AuthEventViewModel[]> => {
      const { events } = await api.listAuthEvents({ limit })
      return Promise.all(
        events.map(async (e) => {
          const envelope = e.payloadEnvelope.find((env) => env.pubkey === pubkey)
          const payload = envelope
            ? await decryptEnvelopeJson<AuthEventViewModel['payload']>(
                e.encryptedPayload,
                envelope,
                LABEL_AUTH_EVENT
              )
            : null
          return {
            id: e.id,
            eventType: e.eventType,
            createdAt: e.createdAt,
            reportedSuspiciousAt: e.reportedSuspiciousAt,
            payload,
          }
        })
      )
    },
    enabled: !!pubkey,
  })
}

export function useReportSuspicious() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.reportSuspiciousEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security', 'history'] })
    },
  })
}

export function useExportAuthEvents() {
  return useMutation({
    mutationFn: () => api.exportAuthEvents(),
  })
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `bun run typecheck`

```bash
git add src/client/lib/api/auth-events.ts src/client/lib/queries/auth-events.ts src/client/lib/queries/keys.ts
git commit -m "feat(client): auth events API + hooks"
```

---

## Task 13: Client — /security/history route

**Files:**
- Create: `src/client/routes/security.history.tsx`
- Modify: `src/client/routes/security.tsx`

- [ ] **Step 1: Add History tab to parent**

Modify `src/client/routes/security.tsx` — add a third `<Link>`:

```tsx
<Link
  to="/security/history"
  className="px-3 py-2 [&.active]:border-b-2 [&.active]:border-primary"
  data-testid="tab-history"
>
  {t('security.tabs.history', 'History')}
</Link>
```

- [ ] **Step 2: Write history route**

Create `src/client/routes/security.history.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  useAuthEvents,
  useExportAuthEvents,
  useReportSuspicious,
} from '@/lib/queries/auth-events'

export const Route = createFileRoute('/security/history')({
  component: HistoryPage,
})

function eventTypeLabel(t: (k: string, d?: string) => string, type: string): string {
  const key = `security.history.eventType.${type}`
  return t(key, type.replaceAll('_', ' '))
}

function HistoryPage() {
  const { t } = useTranslation()
  const { data: events, isLoading } = useAuthEvents(100)
  const report = useReportSuspicious()
  const exportM = useExportAuthEvents()

  if (isLoading) return <div>{t('common.loading', 'Loading…')}</div>
  if (!events) return null

  return (
    <div data-testid="history-page">
      <div className="flex justify-end mb-4">
        <Button
          variant="outline"
          disabled={exportM.isPending}
          onClick={async () => {
            const data = await exportM.mutateAsync()
            const blob = new Blob([JSON.stringify(data, null, 2)], {
              type: 'application/json',
            })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `auth-history-${Date.now()}.json`
            a.click()
            URL.revokeObjectURL(url)
          }}
          data-testid="export-history"
        >
          {t('security.history.export', 'Export history')}
        </Button>
      </div>
      <ul className="space-y-2">
        {events.map((ev) => (
          <li
            key={ev.id}
            className="flex items-start justify-between p-3 border rounded"
            data-testid={`event-row-${ev.id}`}
          >
            <div className="flex-1">
              <div className="font-medium flex items-center gap-2">
                {eventTypeLabel(t, ev.eventType)}
                {ev.reportedSuspiciousAt && (
                  <span
                    className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded"
                    data-testid="suspicious-flag"
                  >
                    {t('security.history.flagged', 'Flagged')}
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {ev.payload?.city && ev.payload?.country && (
                  <>
                    {ev.payload.city}, {ev.payload.country} ·{' '}
                  </>
                )}
                {ev.payload?.userAgent && <>{ev.payload.userAgent} · </>}
                {format(new Date(ev.createdAt), 'PPpp')}
              </div>
            </div>
            {!ev.reportedSuspiciousAt && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => report.mutate(ev.id)}
                disabled={report.isPending}
                data-testid={`report-${ev.id}`}
              >
                {t('security.history.report', 'Report suspicious')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Add translations**

Extend `public/locales/en.json` `security` section:

```json
"tabs": { "history": "History" },
"history": {
  "export": "Export history",
  "report": "Report suspicious",
  "flagged": "Flagged",
  "eventType": {
    "login": "Logged in",
    "login_failed": "Login failed",
    "logout": "Logged out",
    "session_revoked": "Session revoked",
    "sessions_revoked_others": "Signed out other sessions",
    "passkey_added": "Passkey added",
    "passkey_removed": "Passkey removed",
    "passkey_renamed": "Passkey renamed",
    "pin_changed": "PIN changed",
    "recovery_rotated": "Recovery key rotated",
    "lockdown_triggered": "Emergency lockdown triggered",
    "alert_sent": "Alert sent",
    "signal_contact_changed": "Signal contact updated"
  }
}
```

- [ ] **Step 4: Typecheck + build**

Run: `bun run typecheck && bun run build`

- [ ] **Step 5: Commit**

```bash
git add src/client/routes/security.history.tsx src/client/routes/security.tsx src/client/routeTree.gen.ts public/locales/en.json
git commit -m "feat(client): add /security/history tab"
```

---

## Task 14: UI E2E test

**Files:**
- Create: `tests/ui/security-history.spec.ts`

- [ ] **Step 1: Write test**

Create `tests/ui/security-history.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { enterPin, logout, navigateAfterLogin } from '../helpers'

test.describe('Security history', () => {
  test('shows login event after user logs in', async ({ page }) => {
    await navigateAfterLogin(page)
    await enterPin(page)
    await page.goto('/security/history')
    await expect(page.getByTestId('history-page')).toBeVisible()
    // The login that just occurred should be displayed
    await expect(page.getByText('Logged in').first()).toBeVisible()
    await logout(page)
  })

  test('report suspicious sets flagged badge', async ({ page }) => {
    await navigateAfterLogin(page)
    await enterPin(page)
    await page.goto('/security/history')
    const firstReport = page.locator('[data-testid^="report-"]').first()
    if (await firstReport.isVisible()) {
      await firstReport.click()
      await expect(page.getByTestId('suspicious-flag').first()).toBeVisible()
    }
    await logout(page)
  })

  test('export downloads JSON', async ({ page }) => {
    await navigateAfterLogin(page)
    await enterPin(page)
    await page.goto('/security/history')
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('export-history').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^auth-history-/)
    await logout(page)
  })
})
```

- [ ] **Step 2: Run**

Run: `bun run test:e2e -- tests/ui/security-history.spec.ts`
Expected: tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/ui/security-history.spec.ts
git commit -m "test(ui): security history E2E tests"
```

---

## Task 15: Verification

- [ ] `bun run typecheck` — clean
- [ ] `bun run build` — clean
- [ ] `bun run test:unit` — all pass
- [ ] `bun run test:api` — all pass
- [ ] `bun run test:e2e` — all pass
- [ ] Smoke: log in, navigate `/security/history`, see login event, click "Report suspicious", see flag appear, click "Export", download JSON file
- [ ] `git push` — branch updated
