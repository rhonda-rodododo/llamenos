# Plan C — Signal Notification Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-knowledge notification path so the app server can send Signal alerts to users without holding plaintext Signal identifiers. Add `user_signal_contacts` + `user_security_prefs` tables, a `signal-notifier` sidecar that maps HMAC hash → plaintext, a `UserNotificationsService` on the app server, alert triggers, digest cron, Signal-only invite enforcement, and onboarding prompt for Signal contact registration.

**Architecture:** The existing signal-cli-rest-api bridge is unchanged. A new thin **signal-notifier** sidecar service sits in front of it, accepting `{identifierHash, message, disappearingTimer}` from the app server and resolving via its own hash→plaintext persistence. The app server's `UserNotificationsService` only ever sees hashes. Clients register Signal identifiers by computing hash on-device and POSTing plaintext directly to the notifier sidecar.

**Tech Stack:** Bun/Hono for the sidecar, SQLite (bun:sqlite) for sidecar persistence, Drizzle + Postgres for app-server tables, existing SignalAdapter for bridge delivery.

**Spec reference:** `docs/superpowers/specs/2026-04-04-user-security-device-management-design.md` (sections 4.4, 4.5)

**Dependencies:** Plan A (sessions) and Plan B (auth events) merged/present.

---

## File Structure

**New files:**
- `signal-notifier/` (new sub-project directory at repo root)
  - `signal-notifier/src/server.ts` — sidecar HTTP server
  - `signal-notifier/src/store.ts` — SQLite-backed hash→identifier store
  - `signal-notifier/src/bridge-client.ts` — signal-cli-rest-api client
  - `signal-notifier/src/store.test.ts` — unit tests
  - `signal-notifier/package.json`
  - `signal-notifier/tsconfig.json`
  - `signal-notifier/Dockerfile`
- `src/server/db/schema/signal-contacts.ts`
- `src/server/db/schema/security-prefs.ts`
- `src/server/services/user-notifications.ts`
- `src/server/services/user-notifications.test.ts`
- `src/server/services/signal-contacts.ts`
- `src/server/services/signal-contacts.test.ts`
- `src/server/services/security-prefs.ts`
- `src/server/services/digest-cron.ts`
- `src/shared/schemas/signal-contact.ts`
- `src/shared/schemas/security-prefs.ts`
- `src/shared/signal-identifier-normalize.ts`
- `src/client/lib/signal-contact-registration.ts`
- `drizzle/migrations/0044_user_signal_contacts.sql`
- `drizzle/migrations/0045_user_security_prefs.sql`
- `tests/api/signal-contacts.spec.ts`
- `tests/api/security-prefs.spec.ts`
- `tests/api/signal-only-invites.spec.ts`

**Modified files:**
- `src/shared/crypto-labels.ts` — add `LABEL_SIGNAL_CONTACT`
- `src/server/services/invite-delivery-service.ts` — restrict user invite channels to Signal
- `src/server/routes/invites.ts` — reject non-signal channels for user invites
- `src/server/routes/auth-facade.ts` — add Signal contact + security prefs endpoints + alert triggers
- `src/server/services/sessions.ts` — add `hasSeenIpHash` method
- `src/server/services/index.ts` — register new services
- `src/server/app.ts` — bridge new services to auth-facade
- `src/server/server.ts` — schedule digest cron
- `src/client/lib/crypto-worker.ts` + `crypto-worker-client.ts` — expose `computeHmac`
- `src/client/routes/onboarding.tsx` — add Signal contact prompt step
- `deploy/docker/docker-compose.yml` — add signal-notifier service
- `deploy/docker/docker-compose.dev.yml` — add signal-notifier service
- `.env.example` — notifier config vars
- `src/server/db/schema/index.ts` — export new schemas

---

## Task 1: DB schemas + migrations

**Files:**
- Create: `src/server/db/schema/signal-contacts.ts`
- Create: `src/server/db/schema/security-prefs.ts`
- Modify: `src/server/db/schema/index.ts`

- [ ] **Step 1: Signal contacts schema**

Create `src/server/db/schema/signal-contacts.ts`:

```ts
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { RecipientEnvelope } from '../../../shared/types'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

export const userSignalContacts = pgTable(
  'user_signal_contacts',
  {
    userPubkey: text('user_pubkey').primaryKey(),
    identifierHash: text('identifier_hash').notNull(),
    identifierCiphertext: ciphertext('identifier_ciphertext').notNull(),
    identifierEnvelope: jsonb<RecipientEnvelope[]>()('identifier_envelope').notNull().default([]),
    identifierType: text('identifier_type').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    identifierHashIdx: index('user_signal_contacts_identifier_hash_idx').on(table.identifierHash),
  })
)

export type UserSignalContactRow = typeof userSignalContacts.$inferSelect
```

- [ ] **Step 2: Security prefs schema**

Create `src/server/db/schema/security-prefs.ts`:

```ts
import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const userSecurityPrefs = pgTable('user_security_prefs', {
  userPubkey: text('user_pubkey').primaryKey(),
  lockDelayMs: integer('lock_delay_ms').notNull().default(30000),
  disappearingTimerDays: integer('disappearing_timer_days').notNull().default(1),
  digestCadence: text('digest_cadence').notNull().default('weekly'),
  alertOnNewDevice: boolean('alert_on_new_device').notNull().default(true),
  alertOnPasskeyChange: boolean('alert_on_passkey_change').notNull().default(true),
  alertOnPinChange: boolean('alert_on_pin_change').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type UserSecurityPrefsRow = typeof userSecurityPrefs.$inferSelect
```

- [ ] **Step 3: Export from index**

Modify `src/server/db/schema/index.ts`:

```ts
export * from './signal-contacts'
export * from './security-prefs'
```

- [ ] **Step 4: Add crypto label**

Append to `src/shared/crypto-labels.ts`:

```ts
/** Signal contact identifier envelope (user-scoped) */
export const LABEL_SIGNAL_CONTACT = 'llamenos:signal-contact:v1'
```

- [ ] **Step 5: Generate and apply migrations**

Run: `bun run migrate:generate && bun run migrate`
Expected: two new migration files, both tables exist.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema/signal-contacts.ts src/server/db/schema/security-prefs.ts src/server/db/schema/index.ts src/shared/crypto-labels.ts drizzle/migrations/
git commit -m "feat(db): user_signal_contacts + user_security_prefs tables"
```

---

## Task 2: signal-notifier sidecar scaffold

**Files:**
- Create: `signal-notifier/package.json`
- Create: `signal-notifier/tsconfig.json`
- Create: `signal-notifier/src/store.ts`
- Create: `signal-notifier/src/bridge-client.ts`
- Create: `signal-notifier/src/server.ts`
- Create: `signal-notifier/Dockerfile`

- [ ] **Step 1: package.json**

Create `signal-notifier/package.json`:

```json
{
  "name": "signal-notifier",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "bun run --watch src/server.ts",
    "start": "bun run src/server.ts",
    "test": "bun test"
  },
  "dependencies": {
    "hono": "^4.6.0"
  }
}
```

- [ ] **Step 2: tsconfig**

Create `signal-notifier/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: SQLite-backed store**

Create `signal-notifier/src/store.ts`:

```ts
import { Database } from 'bun:sqlite'

export interface StoredIdentifier {
  hash: string
  plaintext: string
  type: 'phone' | 'username'
  createdAt: number
}

export class IdentifierStore {
  private db: Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS identifiers (
          hash TEXT PRIMARY KEY,
          plaintext TEXT NOT NULL,
          type TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`
      )
      .run()
  }

  register(hash: string, plaintext: string, type: 'phone' | 'username'): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO identifiers (hash, plaintext, type, created_at) VALUES (?, ?, ?, ?)`
      )
      .run(hash, plaintext, type, Date.now())
  }

  lookup(hash: string): StoredIdentifier | null {
    const row = this.db
      .prepare(
        'SELECT hash, plaintext, type, created_at as createdAt FROM identifiers WHERE hash = ?'
      )
      .get(hash) as StoredIdentifier | null
    return row ?? null
  }

  remove(hash: string): void {
    this.db.prepare('DELETE FROM identifiers WHERE hash = ?').run(hash)
  }
}
```

- [ ] **Step 4: Bridge client**

Create `signal-notifier/src/bridge-client.ts`:

```ts
export interface BridgeConfig {
  bridgeUrl: string
  bridgeApiKey: string
  registeredNumber: string
}

export async function sendSignalMessage(
  cfg: BridgeConfig,
  recipient: string,
  message: string,
  disappearingTimerSeconds: number | null
): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, unknown> = {
    number: cfg.registeredNumber,
    recipients: [recipient],
    message,
  }
  if (disappearingTimerSeconds !== null) {
    body.message_timer = disappearingTimerSeconds
  }
  try {
    const res = await fetch(`${cfg.bridgeUrl.replace(/\/+$/, '')}/v2/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.bridgeApiKey ? { authorization: `Bearer ${cfg.bridgeApiKey}` } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `Bridge ${res.status}: ${text}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'bridge error' }
  }
}
```

- [ ] **Step 5: HTTP server**

Create `signal-notifier/src/server.ts`:

```ts
import { Hono } from 'hono'
import { sendSignalMessage } from './bridge-client'
import { IdentifierStore } from './store'

const port = Number(process.env.PORT ?? 3100)
const apiKey = process.env.NOTIFIER_API_KEY ?? ''
const dbPath = process.env.NOTIFIER_DB_PATH ?? './data/notifier.db'
const bridgeUrl = process.env.SIGNAL_BRIDGE_URL ?? 'http://signal-cli-rest-api:8080'
const bridgeApiKey = process.env.SIGNAL_BRIDGE_API_KEY ?? ''
const registeredNumber = process.env.SIGNAL_REGISTERED_NUMBER ?? ''

const store = new IdentifierStore(dbPath)
const app = new Hono()

// Auth middleware for /notify + admin endpoints
app.use('/notify', async (c, next) => {
  const header = c.req.header('authorization')
  if (!apiKey || header !== `Bearer ${apiKey}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

// Public registration: client computes hash on-device and posts plaintext + registration token
app.post('/identities/register', async (c) => {
  const body = await c.req.json<{
    identifierHash: string
    plaintextIdentifier: string
    identifierType: 'phone' | 'username'
    registrationToken: string
  }>()
  if (!body.identifierHash || !body.plaintextIdentifier || !body.registrationToken) {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (body.identifierType !== 'phone' && body.identifierType !== 'username') {
    return c.json({ error: 'Invalid identifier type' }, 400)
  }
  store.register(body.identifierHash, body.plaintextIdentifier, body.identifierType)
  return c.json({ ok: true })
})

// App-server-only: send a notification
app.post('/notify', async (c) => {
  const body = await c.req.json<{
    identifierHash: string
    message: string
    disappearingTimerSeconds?: number
  }>()
  const entry = store.lookup(body.identifierHash)
  if (!entry) {
    return c.json({ error: 'Identifier not found' }, 404)
  }
  const result = await sendSignalMessage(
    { bridgeUrl, bridgeApiKey, registeredNumber },
    entry.plaintext,
    body.message,
    body.disappearingTimerSeconds ?? null
  )
  if (!result.ok) {
    return c.json({ error: result.error }, 502)
  }
  return c.json({ ok: true })
})

// App-server-only: delete an identifier
app.delete('/identities/:hash', async (c) => {
  const header = c.req.header('authorization')
  if (!apiKey || header !== `Bearer ${apiKey}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const hash = c.req.param('hash')
  store.remove(hash)
  return c.json({ ok: true })
})

app.get('/healthz', (c) => c.json({ ok: true }))

export default { port, fetch: app.fetch }
```

- [ ] **Step 6: Dockerfile**

Create `signal-notifier/Dockerfile`:

```dockerfile
FROM oven/bun:1-slim
WORKDIR /app
COPY package.json ./
RUN bun install
COPY tsconfig.json ./
COPY src/ ./src/
RUN mkdir -p /app/data
ENV NOTIFIER_DB_PATH=/app/data/notifier.db
EXPOSE 3100
CMD ["bun", "run", "src/server.ts"]
```

- [ ] **Step 7: Commit**

```bash
git add signal-notifier/
git commit -m "feat(signal-notifier): add sidecar HTTP service scaffolding"
```

---

## Task 3: signal-notifier unit tests

**Files:**
- Create: `signal-notifier/src/store.test.ts`

- [ ] **Step 1: Write test**

Create `signal-notifier/src/store.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { unlinkSync } from 'node:fs'
import { IdentifierStore } from './store'

const TEST_DB = './test-notifier.db'

afterEach(() => {
  try {
    unlinkSync(TEST_DB)
  } catch {}
})

describe('IdentifierStore', () => {
  test('register + lookup roundtrips', () => {
    const store = new IdentifierStore(TEST_DB)
    store.register('hash1', '+15551234567', 'phone')
    const result = store.lookup('hash1')
    expect(result?.plaintext).toBe('+15551234567')
    expect(result?.type).toBe('phone')
  })

  test('lookup returns null for unknown hash', () => {
    const store = new IdentifierStore(TEST_DB)
    expect(store.lookup('missing')).toBeNull()
  })

  test('register replaces existing entry', () => {
    const store = new IdentifierStore(TEST_DB)
    store.register('hash1', '+15551111111', 'phone')
    store.register('hash1', '+15552222222', 'phone')
    expect(store.lookup('hash1')?.plaintext).toBe('+15552222222')
  })

  test('remove deletes entry', () => {
    const store = new IdentifierStore(TEST_DB)
    store.register('hash1', '+15551111111', 'phone')
    store.remove('hash1')
    expect(store.lookup('hash1')).toBeNull()
  })
})
```

- [ ] **Step 2: Install deps + run**

Run: `cd signal-notifier && bun install && bun test`
Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add signal-notifier/src/store.test.ts signal-notifier/bun.lock
git commit -m "test(signal-notifier): IdentifierStore unit tests"
```

---

## Task 4: Docker Compose wiring

**Files:**
- Modify: `deploy/docker/docker-compose.yml`
- Modify: `deploy/docker/docker-compose.dev.yml`
- Modify: `.env.example`

- [ ] **Step 1: Add to dev compose**

Add to `deploy/docker/docker-compose.dev.yml` services:

```yaml
  signal-notifier:
    build:
      context: ../../signal-notifier
      dockerfile: Dockerfile
    ports:
      - "3100:3100"
    environment:
      NOTIFIER_API_KEY: ${SIGNAL_NOTIFIER_API_KEY}
      SIGNAL_BRIDGE_URL: ${SIGNAL_BRIDGE_URL:-http://signal-cli-rest-api:8080}
      SIGNAL_BRIDGE_API_KEY: ${SIGNAL_BRIDGE_API_KEY}
      SIGNAL_REGISTERED_NUMBER: ${SIGNAL_REGISTERED_NUMBER}
    volumes:
      - signal_notifier_data:/app/data
```

And append to `volumes`: `signal_notifier_data:`

- [ ] **Step 2: Add to prod compose**

Same service block in `deploy/docker/docker-compose.yml`.

- [ ] **Step 3: Env vars**

Append to `.env.example`:

```
# Signal notifier sidecar
SIGNAL_NOTIFIER_URL=http://signal-notifier:3100
SIGNAL_NOTIFIER_API_KEY=<random-hex-32-bytes>
```

- [ ] **Step 4: Commit**

```bash
git add deploy/docker/docker-compose.yml deploy/docker/docker-compose.dev.yml .env.example
git commit -m "feat(deploy): signal-notifier in docker compose"
```

---

## Task 5: Signal identifier normalize + schemas

**Files:**
- Create: `src/shared/signal-identifier-normalize.ts`
- Create: `src/shared/schemas/signal-contact.ts`
- Create: `src/shared/schemas/security-prefs.ts`

- [ ] **Step 1: Normalize helper**

Create `src/shared/signal-identifier-normalize.ts`:

```ts
export function normalizeSignalIdentifier(
  input: string,
  type: 'phone' | 'username'
): string {
  if (type === 'phone') {
    const stripped = input.replace(/[^\d+]/g, '')
    return stripped.startsWith('+') ? stripped : `+${stripped}`
  }
  const lowered = input.toLowerCase().trim()
  return lowered.startsWith('@') ? lowered : `@${lowered}`
}
```

- [ ] **Step 2: Signal contact schemas**

Create `src/shared/schemas/signal-contact.ts`:

```ts
import { z } from '@hono/zod-openapi'
import { RecipientEnvelopeSchema } from './common'

export const SignalIdentifierTypeSchema = z.enum(['phone', 'username'])

export const SignalContactResponseSchema = z.object({
  identifierHash: z.string(),
  identifierCiphertext: z.string(),
  identifierEnvelope: z.array(RecipientEnvelopeSchema),
  identifierType: SignalIdentifierTypeSchema,
  verifiedAt: z.string().nullable(),
  updatedAt: z.string(),
})

export const SignalContactRegisterSchema = z.object({
  identifierHash: z.string().min(32).max(128),
  identifierCiphertext: z.string(),
  identifierEnvelope: z.array(RecipientEnvelopeSchema),
  identifierType: SignalIdentifierTypeSchema,
  bridgeRegistrationToken: z.string(),
})

export const RegisterTokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  notifierUrl: z.string(),
})

export type SignalContactResponse = z.infer<typeof SignalContactResponseSchema>
export type SignalContactRegisterInput = z.infer<typeof SignalContactRegisterSchema>
```

- [ ] **Step 3: Security prefs schemas**

Create `src/shared/schemas/security-prefs.ts`:

```ts
import { z } from '@hono/zod-openapi'

export const DigestCadenceSchema = z.enum(['off', 'daily', 'weekly'])

export const SecurityPrefsSchema = z.object({
  lockDelayMs: z.number().int().min(0).max(600_000),
  disappearingTimerDays: z.number().int().min(1).max(7),
  digestCadence: DigestCadenceSchema,
  alertOnNewDevice: z.boolean(),
  alertOnPasskeyChange: z.boolean(),
  alertOnPinChange: z.boolean(),
})

export const UpdateSecurityPrefsSchema = SecurityPrefsSchema.partial()

export type SecurityPrefs = z.infer<typeof SecurityPrefsSchema>
```

- [ ] **Step 4: Typecheck + commit**

```bash
git add src/shared/signal-identifier-normalize.ts src/shared/schemas/signal-contact.ts src/shared/schemas/security-prefs.ts
git commit -m "feat(schemas): signal contact + security prefs zod schemas"
```

---

## Task 6: SignalContactsService

**Files:**
- Create: `src/server/services/signal-contacts.ts`
- Create: `src/server/services/signal-contacts.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/server/services/signal-contacts.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { normalizeSignalIdentifier } from '../../shared/signal-identifier-normalize'

describe('normalizeSignalIdentifier', () => {
  test('normalizes phone by stripping formatting', () => {
    expect(normalizeSignalIdentifier('+1 (555) 123-4567', 'phone')).toBe('+15551234567')
  })

  test('lowercases usernames', () => {
    expect(normalizeSignalIdentifier('@Handle.01', 'username')).toBe('@handle.01')
  })

  test('adds @ prefix to usernames missing it', () => {
    expect(normalizeSignalIdentifier('alice.42', 'username')).toBe('@alice.42')
  })

  test('adds + to phone numbers missing it', () => {
    expect(normalizeSignalIdentifier('15551234567', 'phone')).toBe('+15551234567')
  })
})
```

- [ ] **Step 2: Run test — expect fail on normalize import path only if needed**

Run: `bun test src/server/services/signal-contacts.test.ts`
Expected: 4 tests should pass since normalize helper was created in Task 5.

- [ ] **Step 3: Write SignalContactsService**

Create `src/server/services/signal-contacts.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { Ciphertext, RecipientEnvelope } from '../../shared/types'
import { userSignalContacts, type UserSignalContactRow } from '../db/schema/signal-contacts'

export { normalizeSignalIdentifier } from '../../shared/signal-identifier-normalize'

export function hashSignalIdentifier(normalized: string, secret: string): string {
  const mac = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(normalized))
  return bytesToHex(mac)
}

export interface UpsertSignalContactInput {
  userPubkey: string
  identifierHash: string
  identifierCiphertext: Ciphertext
  identifierEnvelope: RecipientEnvelope[]
  identifierType: 'phone' | 'username'
}

export class SignalContactsService {
  constructor(private db: PostgresJsDatabase, private hmacSecret: string) {}

  async upsert(input: UpsertSignalContactInput): Promise<UserSignalContactRow> {
    const existing = await this.findByUser(input.userPubkey)
    if (existing) {
      const rows = await this.db
        .update(userSignalContacts)
        .set({
          identifierHash: input.identifierHash,
          identifierCiphertext: input.identifierCiphertext,
          identifierEnvelope: input.identifierEnvelope,
          identifierType: input.identifierType,
          updatedAt: new Date(),
          verifiedAt: new Date(),
        })
        .where(eq(userSignalContacts.userPubkey, input.userPubkey))
        .returning()
      return rows[0]
    }
    const rows = await this.db
      .insert(userSignalContacts)
      .values({
        userPubkey: input.userPubkey,
        identifierHash: input.identifierHash,
        identifierCiphertext: input.identifierCiphertext,
        identifierEnvelope: input.identifierEnvelope,
        identifierType: input.identifierType,
        verifiedAt: new Date(),
      })
      .returning()
    return rows[0]
  }

  async findByUser(userPubkey: string): Promise<UserSignalContactRow | null> {
    const rows = await this.db
      .select()
      .from(userSignalContacts)
      .where(eq(userSignalContacts.userPubkey, userPubkey))
      .limit(1)
    return rows[0] ?? null
  }

  async deleteByUser(userPubkey: string): Promise<void> {
    await this.db.delete(userSignalContacts).where(eq(userSignalContacts.userPubkey, userPubkey))
  }

  hashIdentifier(normalized: string): string {
    return hashSignalIdentifier(normalized, this.hmacSecret)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/services/signal-contacts.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/signal-contacts.ts src/server/services/signal-contacts.test.ts
git commit -m "feat(signal-contacts): SignalContactsService + HMAC helper"
```

---

## Task 7: SecurityPrefsService

**Files:**
- Create: `src/server/services/security-prefs.ts`

- [ ] **Step 1: Write service**

Create `src/server/services/security-prefs.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { userSecurityPrefs, type UserSecurityPrefsRow } from '../db/schema/security-prefs'

export type DigestCadence = 'off' | 'daily' | 'weekly'

const DEFAULTS = {
  lockDelayMs: 30000,
  disappearingTimerDays: 1,
  digestCadence: 'weekly' as DigestCadence,
  alertOnNewDevice: true,
  alertOnPasskeyChange: true,
  alertOnPinChange: true,
}

export class SecurityPrefsService {
  constructor(private db: PostgresJsDatabase) {}

  async get(userPubkey: string): Promise<UserSecurityPrefsRow> {
    const rows = await this.db
      .select()
      .from(userSecurityPrefs)
      .where(eq(userSecurityPrefs.userPubkey, userPubkey))
      .limit(1)
    if (rows[0]) return rows[0]
    const inserted = await this.db
      .insert(userSecurityPrefs)
      .values({ userPubkey, ...DEFAULTS })
      .returning()
    return inserted[0]
  }

  async update(
    userPubkey: string,
    patch: Partial<Omit<UserSecurityPrefsRow, 'userPubkey' | 'updatedAt'>>
  ): Promise<UserSecurityPrefsRow> {
    await this.get(userPubkey)
    const rows = await this.db
      .update(userSecurityPrefs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(userSecurityPrefs.userPubkey, userPubkey))
      .returning()
    return rows[0]
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
git add src/server/services/security-prefs.ts
git commit -m "feat(security-prefs): SecurityPrefsService with defaults"
```

---

## Task 8: UserNotificationsService

**Files:**
- Create: `src/server/services/user-notifications.ts`
- Create: `src/server/services/user-notifications.test.ts`

- [ ] **Step 1: Write test**

Create `src/server/services/user-notifications.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { formatDisappearingTimerSeconds, renderAlertMessage } from './user-notifications'

describe('user-notifications formatters', () => {
  test('formatDisappearingTimerSeconds converts days to seconds', () => {
    expect(formatDisappearingTimerSeconds(1)).toBe(86400)
    expect(formatDisappearingTimerSeconds(7)).toBe(7 * 86400)
  })

  test('renderAlertMessage for new_device includes city', () => {
    const msg = renderAlertMessage({
      type: 'new_device',
      city: 'Berlin',
      country: 'DE',
      userAgent: 'Firefox on macOS',
    })
    expect(msg).toContain('Berlin')
    expect(msg).toContain('Firefox')
  })

  test('renderAlertMessage for passkey_added includes label', () => {
    const msg = renderAlertMessage({ type: 'passkey_added', credentialLabel: 'MacBook' })
    expect(msg).toContain('MacBook')
  })

  test('renderAlertMessage for lockdown includes tier', () => {
    const msg = renderAlertMessage({ type: 'lockdown_triggered', tier: 'B' })
    expect(msg).toContain('tier B')
  })
})
```

- [ ] **Step 2: Write implementation**

Create `src/server/services/user-notifications.ts`:

```ts
import type { AuthEventsService } from './auth-events'
import type { SecurityPrefsService } from './security-prefs'
import type { SignalContactsService } from './signal-contacts'

export type AlertInput =
  | { type: 'new_device'; city: string; country: string; userAgent: string }
  | { type: 'passkey_added'; credentialLabel: string }
  | { type: 'passkey_removed'; credentialLabel: string }
  | { type: 'pin_changed' }
  | { type: 'recovery_rotated' }
  | { type: 'lockdown_triggered'; tier: 'A' | 'B' | 'C' }
  | { type: 'session_revoked_remote'; city: string; country: string }
  | { type: 'digest'; periodDays: number; loginCount: number; alertCount: number; failedCount: number }

export function formatDisappearingTimerSeconds(days: number): number {
  return days * 86400
}

export function renderAlertMessage(input: AlertInput): string {
  switch (input.type) {
    case 'new_device':
      return `New sign-in detected from ${input.city}, ${input.country} (${input.userAgent}). If this wasn't you, revoke the session and rotate your PIN.`
    case 'passkey_added':
      return `Passkey "${input.credentialLabel}" was added to your account.`
    case 'passkey_removed':
      return `Passkey "${input.credentialLabel}" was removed from your account.`
    case 'pin_changed':
      return `Your PIN was changed. If this wasn't you, trigger an emergency lockdown.`
    case 'recovery_rotated':
      return `Your recovery key was rotated. Save the new key in a safe place.`
    case 'lockdown_triggered':
      return `Emergency lockdown tier ${input.tier} was triggered on your account.`
    case 'session_revoked_remote':
      return `A session from ${input.city}, ${input.country} was revoked.`
    case 'digest':
      return `Weekly summary: ${input.loginCount} login(s), ${input.alertCount} alert(s), ${input.failedCount} failed attempt(s) over the last ${input.periodDays} days.`
  }
}

const MAX_RETRIES = 3

async function sendToNotifier(
  notifierUrl: string,
  apiKey: string,
  identifierHash: string,
  message: string,
  disappearingTimerSeconds: number
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${notifierUrl.replace(/\/+$/, '')}/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ identifierHash, message, disappearingTimerSeconds }),
    })
    if (!res.ok) {
      return { ok: false, error: `Notifier ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'notifier error' }
  }
}

export interface UserNotificationsConfig {
  notifierUrl: string
  notifierApiKey: string
}

export class UserNotificationsService {
  constructor(
    private signalContacts: SignalContactsService,
    private prefs: SecurityPrefsService,
    private authEvents: AuthEventsService,
    private config: UserNotificationsConfig
  ) {}

  async sendAlert(userPubkey: string, alert: AlertInput): Promise<{ delivered: boolean }> {
    const contact = await this.signalContacts.findByUser(userPubkey)
    if (!contact) return { delivered: false }
    const prefs = await this.prefs.get(userPubkey)

    if (alert.type === 'digest' && prefs.digestCadence === 'off') {
      return { delivered: false }
    }

    const message = renderAlertMessage(alert)
    const timer = formatDisappearingTimerSeconds(prefs.disappearingTimerDays)

    let lastErr = ''
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await sendToNotifier(
        this.config.notifierUrl,
        this.config.notifierApiKey,
        contact.identifierHash,
        message,
        timer
      )
      if (result.ok) {
        await this.authEvents.record({
          userPubkey,
          eventType: 'alert_sent',
          payload: { meta: { alertType: alert.type } },
        })
        return { delivered: true }
      }
      lastErr = result.error ?? 'unknown'
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt))
    }

    console.error(`[user-notifications] delivery failed for ${userPubkey}: ${lastErr}`)
    return { delivered: false }
  }
}
```

- [ ] **Step 3: Run test + commit**

Run: `bun test src/server/services/user-notifications.test.ts`
Expected: 4 tests pass.

```bash
git add src/server/services/user-notifications.ts src/server/services/user-notifications.test.ts
git commit -m "feat(notifications): UserNotificationsService with retry"
```

---

## Task 9: Register services + wire to auth-facade

**Files:**
- Modify: `src/server/services/index.ts`
- Modify: `src/server/routes/auth-facade.ts`
- Modify: `src/server/app.ts`

- [ ] **Step 1: Register services**

Modify `src/server/services/index.ts` — imports:

```ts
import { SecurityPrefsService } from './security-prefs'
import { SignalContactsService } from './signal-contacts'
import { UserNotificationsService } from './user-notifications'
```

Interface additions:

```ts
signalContacts: SignalContactsService
securityPrefs: SecurityPrefsService
userNotifications: UserNotificationsService
```

Construction:

```ts
const signalContacts = new SignalContactsService(db, process.env.HMAC_SECRET ?? '')
const securityPrefs = new SecurityPrefsService(db)
const userNotifications = new UserNotificationsService(
  signalContacts,
  securityPrefs,
  authEvents,
  {
    notifierUrl: process.env.SIGNAL_NOTIFIER_URL ?? 'http://signal-notifier:3100',
    notifierApiKey: process.env.SIGNAL_NOTIFIER_API_KEY ?? '',
  }
)
```

- [ ] **Step 2: Bridge to auth-facade**

Modify `src/server/routes/auth-facade.ts` AuthFacadeEnv Variables:

```ts
signalContacts: SignalContactsService
securityPrefs: SecurityPrefsService
userNotifications: UserNotificationsService
```

And imports:

```ts
import type { SignalContactsService } from '../services/signal-contacts'
import type { SecurityPrefsService } from '../services/security-prefs'
import type { UserNotificationsService } from '../services/user-notifications'
```

Modify `src/server/app.ts` auth-facade bridge middleware — add:

```ts
ctx.set('signalContacts', services.signalContacts)
ctx.set('securityPrefs', services.securityPrefs)
ctx.set('userNotifications', services.userNotifications)
```

- [ ] **Step 3: Typecheck + commit**

```bash
git add src/server/services/index.ts src/server/routes/auth-facade.ts src/server/app.ts
git commit -m "feat(services): register signal-contacts, security-prefs, notifications"
```

---

## Task 10: Signal contact endpoints

**Files:**
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Middleware**

Add near other `authFacade.use('...', jwtAuth)` calls:

```ts
authFacade.use('/signal-contact', jwtAuth)
authFacade.use('/signal-contact/*', jwtAuth)
```

- [ ] **Step 2: Imports**

Add at top of file:

```ts
import { SignalContactRegisterSchema } from '@shared/schemas/signal-contact'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
```

- [ ] **Step 3: Handlers**

```ts
authFacade.get('/signal-contact', async (c) => {
  const pubkey = c.get('pubkey')
  const svc = c.get('signalContacts')
  const contact = await svc.findByUser(pubkey)
  if (!contact) return c.json({ contact: null })
  return c.json({
    contact: {
      identifierHash: contact.identifierHash,
      identifierCiphertext: contact.identifierCiphertext,
      identifierEnvelope: contact.identifierEnvelope,
      identifierType: contact.identifierType,
      verifiedAt: contact.verifiedAt?.toISOString() ?? null,
      updatedAt: contact.updatedAt.toISOString(),
    },
  })
})

authFacade.get('/signal-contact/register-token', async (c) => {
  const pubkey = c.get('pubkey')
  const nonce = globalThis.crypto.randomUUID()
  const expiresAt = Date.now() + 5 * 60 * 1000
  const tokenBody = `${pubkey}:${nonce}:${expiresAt}`
  const mac = hmac(sha256, utf8ToBytes(c.env.HMAC_SECRET), utf8ToBytes(tokenBody))
  const token = `${tokenBody}:${bytesToHex(mac)}`
  return c.json({
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    notifierUrl: process.env.SIGNAL_NOTIFIER_URL ?? 'http://signal-notifier:3100',
  })
})

authFacade.post('/signal-contact', async (c) => {
  const pubkey = c.get('pubkey')
  const parsed = SignalContactRegisterSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid body' }, 400)
  }
  const parts = parsed.data.bridgeRegistrationToken.split(':')
  if (parts.length !== 4) return c.json({ error: 'Invalid token' }, 401)
  const [tokenPubkey, nonce, expiresStr, macHex] = parts
  if (tokenPubkey !== pubkey) return c.json({ error: 'Token mismatch' }, 401)
  if (Number(expiresStr) < Date.now()) return c.json({ error: 'Token expired' }, 401)
  const body = `${tokenPubkey}:${nonce}:${expiresStr}`
  const expected = bytesToHex(hmac(sha256, utf8ToBytes(c.env.HMAC_SECRET), utf8ToBytes(body)))
  if (expected !== macHex) return c.json({ error: 'Token invalid' }, 401)

  const svc = c.get('signalContacts')
  await svc.upsert({
    userPubkey: pubkey,
    identifierHash: parsed.data.identifierHash,
    identifierCiphertext: parsed.data.identifierCiphertext as never,
    identifierEnvelope: parsed.data.identifierEnvelope,
    identifierType: parsed.data.identifierType,
  })

  const authEvents = c.get('authEvents')
  await authEvents.record({
    userPubkey: pubkey,
    eventType: 'signal_contact_changed',
    payload: { meta: { identifierType: parsed.data.identifierType } },
  })

  return c.json({ ok: true })
})

authFacade.delete('/signal-contact', async (c) => {
  const pubkey = c.get('pubkey')
  const svc = c.get('signalContacts')
  const contact = await svc.findByUser(pubkey)
  if (contact) {
    try {
      await fetch(
        `${(process.env.SIGNAL_NOTIFIER_URL ?? '').replace(/\/+$/, '')}/identities/${contact.identifierHash}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${process.env.SIGNAL_NOTIFIER_API_KEY}` },
        }
      )
    } catch {
      // best-effort
    }
    await svc.deleteByUser(pubkey)
  }
  return c.json({ ok: true })
})
```

- [ ] **Step 4: Typecheck + commit**

```bash
git add src/server/routes/auth-facade.ts
git commit -m "feat(signal-contact): register/get/delete endpoints"
```

---

## Task 11: Security prefs endpoints

**Files:**
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Middleware**

```ts
authFacade.use('/security-prefs', jwtAuth)
```

- [ ] **Step 2: Handlers**

```ts
import { UpdateSecurityPrefsSchema } from '@shared/schemas/security-prefs'

authFacade.get('/security-prefs', async (c) => {
  const pubkey = c.get('pubkey')
  const svc = c.get('securityPrefs')
  const row = await svc.get(pubkey)
  return c.json({
    lockDelayMs: row.lockDelayMs,
    disappearingTimerDays: row.disappearingTimerDays,
    digestCadence: row.digestCadence,
    alertOnNewDevice: row.alertOnNewDevice,
    alertOnPasskeyChange: row.alertOnPasskeyChange,
    alertOnPinChange: row.alertOnPinChange,
  })
})

authFacade.patch('/security-prefs', async (c) => {
  const pubkey = c.get('pubkey')
  const parsed = UpdateSecurityPrefsSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid body' }, 400)
  }
  const svc = c.get('securityPrefs')
  const row = await svc.update(pubkey, parsed.data)
  return c.json({
    lockDelayMs: row.lockDelayMs,
    disappearingTimerDays: row.disappearingTimerDays,
    digestCadence: row.digestCadence,
    alertOnNewDevice: row.alertOnNewDevice,
    alertOnPasskeyChange: row.alertOnPasskeyChange,
    alertOnPinChange: row.alertOnPinChange,
  })
})
```

- [ ] **Step 3: Typecheck + commit**

```bash
git add src/server/routes/auth-facade.ts
git commit -m "feat(security-prefs): GET/PATCH endpoints"
```

---

## Task 12: Alert triggers in auth flows

**Files:**
- Modify: `src/server/services/sessions.ts` (add `hasSeenIpHash`)
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Add `hasSeenIpHash` method**

Modify `src/server/services/sessions.ts` — add method to SessionService:

```ts
async hasSeenIpHash(userPubkey: string, ipHash: string): Promise<boolean> {
  const rows = await this.db
    .select({ id: userSessions.id })
    .from(userSessions)
    .where(and(eq(userSessions.userPubkey, userPubkey), eq(userSessions.ipHash, ipHash)))
    .limit(1)
  return rows.length > 0
}
```

- [ ] **Step 2: Fire new_device alert in login-verify**

In `/webauthn/login-verify`, BEFORE the `await sessions.create(...)` call:

```ts
const ipHashValue = hashIP(clientIp, c.env.HMAC_SECRET)
const seenBefore = await sessions.hasSeenIpHash(matched.ownerPubkey, ipHashValue)
```

After session creation + login event recording:

```ts
if (!seenBefore) {
  const notifications = c.get('userNotifications')
  void notifications.sendAlert(matched.ownerPubkey, {
    type: 'new_device',
    city: geo.city,
    country: geo.country,
    userAgent: formatUserAgent(userAgent),
  })
}
```

- [ ] **Step 3: Fire passkey_added alert**

In `/webauthn/register-verify` AND `/passkeys/register-verify` handlers, after `addWebAuthnCredential`:

```ts
const notifications = c.get('userNotifications')
void notifications.sendAlert(pubkey, {
  type: 'passkey_added',
  credentialLabel: newCred.label,
})
```

- [ ] **Step 4: Fire passkey_removed alert**

In `DELETE /passkeys/:id` and `DELETE /devices/:id` handlers, BEFORE deleting, fetch the credential's label, then after delete success:

```ts
const existing = (await identity.getWebAuthnCredentials(pubkey)).find((c) => c.id === credId)
// ... delete ...
if (existing) {
  const notifications = c.get('userNotifications')
  void notifications.sendAlert(pubkey, {
    type: 'passkey_removed',
    credentialLabel: existing.label,
  })
}
```

- [ ] **Step 5: Import formatUserAgent**

At top of auth-facade.ts:

```ts
import { formatUserAgent } from '../services/sessions'
```

- [ ] **Step 6: Typecheck + commit**

```bash
git add src/server/services/sessions.ts src/server/routes/auth-facade.ts
git commit -m "feat(notifications): fire alerts on login/passkey events"
```

---

## Task 13: Signal-only user invite enforcement

**Files:**
- Modify: `src/server/services/invite-delivery-service.ts`
- Modify: `src/server/routes/invites.ts`

- [ ] **Step 1: Inspect existing service**

Run: `grep -n "InviteDeliveryChannel\|sms\|whatsapp" src/server/services/invite-delivery-service.ts`
Identify where the channel type is defined and the logic branches.

- [ ] **Step 2: Restrict channel type**

Modify `src/server/services/invite-delivery-service.ts`:

Change channel type:

```ts
export type InviteDeliveryChannel = 'signal'
```

Remove any code paths handling `'whatsapp'` or `'sms'` in `sendInvite()`. The SignalAdapter path is the only one kept.

- [ ] **Step 3: Update invite route validation**

Modify `src/server/routes/invites.ts` — find channel validation:

```ts
const ALLOWED_USER_INVITE_CHANNELS = ['signal'] as const
```

If `body.channel` isn't `'signal'`, return 400:

```ts
if (body.channel !== 'signal') {
  return c.json(
    { error: 'User invites can only be delivered via Signal.' },
    400
  )
}
```

- [ ] **Step 4: Remove non-signal paths**

Run: `grep -rn "'whatsapp'\|'sms'" src/server/services/invite-delivery-service.ts src/server/routes/invites.ts`
Expected: no matches in user-invite code paths.

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/server/services/invite-delivery-service.ts src/server/routes/invites.ts
git commit -m "feat(invites): enforce Signal-only delivery for user invites"
```

---

## Task 14: Client Signal contact registration helper

**Files:**
- Modify: `src/client/lib/crypto-worker-client.ts`
- Modify: `src/client/lib/crypto-worker.ts`
- Create: `src/client/lib/signal-contact-registration.ts`

- [ ] **Step 1: Expose HMAC on crypto worker**

Check existing worker: `grep -n "computeHmac\|hmac" src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts`

If not present, add to `src/client/lib/crypto-worker.ts` (inside the handler switch):

```ts
case 'computeHmac': {
  const { input, secret } = msg.payload as { input: string; secret: string }
  const mac = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(input))
  return bytesToHex(mac)
}
```

And in `src/client/lib/crypto-worker-client.ts`:

```ts
async computeHmac(input: string, secret: string): Promise<string> {
  return this.send('computeHmac', { input, secret })
}
```

(Adapt to existing RPC pattern in the file.)

- [ ] **Step 2: Registration helper**

Create `src/client/lib/signal-contact-registration.ts`:

```ts
import { LABEL_SIGNAL_CONTACT } from '@shared/crypto-labels'
import { normalizeSignalIdentifier } from '@shared/signal-identifier-normalize'
import { cryptoWorker } from './crypto-worker-client'

interface TokenResponse {
  token: string
  expiresAt: string
  notifierUrl: string
}

async function fetchToken(): Promise<TokenResponse> {
  const res = await fetch('/api/auth/signal-contact/register-token', {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('register-token failed')
  return res.json()
}

async function postContact(body: unknown): Promise<void> {
  const res = await fetch('/api/auth/signal-contact', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`contact POST failed: ${res.status}`)
}

export async function registerSignalContact(opts: {
  plaintextIdentifier: string
  identifierType: 'phone' | 'username'
  userPubkey: string
  hmacSecret: string
  accessToken: string
}): Promise<void> {
  const { token, notifierUrl } = await fetchToken()

  const normalized = normalizeSignalIdentifier(opts.plaintextIdentifier, opts.identifierType)
  const identifierHash = await cryptoWorker.computeHmac(normalized, opts.hmacSecret)

  const notifierRes = await fetch(`${notifierUrl.replace(/\/+$/, '')}/identities/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      identifierHash,
      plaintextIdentifier: normalized,
      identifierType: opts.identifierType,
      registrationToken: token,
    }),
  })
  if (!notifierRes.ok) {
    throw new Error(`notifier rejected registration: ${notifierRes.status}`)
  }

  const { encrypted, envelopes } = await cryptoWorker.envelopeEncrypt(
    JSON.stringify({ identifier: normalized, type: opts.identifierType }),
    [opts.userPubkey],
    LABEL_SIGNAL_CONTACT
  )

  await postContact({
    identifierHash,
    identifierCiphertext: encrypted,
    identifierEnvelope: envelopes,
    identifierType: opts.identifierType,
    bridgeRegistrationToken: token,
  })
}
```

- [ ] **Step 3: Note about HMAC secret delivery**

The client needs the `HMAC_SECRET` to compute the identifier hash. This secret is server-only currently. **Alternative**: compute the hash server-side too via a dedicated `POST /api/auth/signal-contact/hash` endpoint that returns the hash server-side given the plaintext... but that defeats zero-knowledge.

Better alternative: use a **per-user HMAC key** derived from the user's nsec, so the client computes the hash locally without any server secret. Add to the helper:

```ts
// Instead of server HMAC secret, derive a per-user key from the user's nsec:
const perUserKey = await cryptoWorker.deriveHmacKey('signal-contact-hash-v1')
const identifierHash = await cryptoWorker.computeHmac(normalized, perUserKey)
```

And server-side, store `identifierHash` as opaque — server never computes it, only looks it up. The only place the hash is recomputed is when a different client of the same user registers: they derive the same per-user key and get the same hash.

**Decision for this plan:** use the server HMAC_SECRET via an auth-exposed endpoint that returns a per-user HMAC key (derived server-side from HMAC_SECRET || userPubkey). Add `GET /api/auth/signal-contact/hmac-key` endpoint returning the derived key. Document that this key is user-scoped and never shared.

Add to `auth-facade.ts`:

```ts
authFacade.get('/signal-contact/hmac-key', async (c) => {
  const pubkey = c.get('pubkey')
  const key = bytesToHex(
    hmac(sha256, utf8ToBytes(c.env.HMAC_SECRET), utf8ToBytes(`signal-contact:${pubkey}`))
  )
  return c.json({ key })
})
```

And modify the registration helper to fetch it first:

```ts
const keyRes = await fetch('/api/auth/signal-contact/hmac-key', { credentials: 'include' })
const { key: userHmacKey } = await keyRes.json()
const identifierHash = await cryptoWorker.computeHmac(normalized, userHmacKey)
```

Replace `opts.hmacSecret` with this fetched key. Remove `hmacSecret` from the options.

- [ ] **Step 4: Server-side hash computation uses same derivation**

Modify `src/server/services/signal-contacts.ts` — `hashIdentifier` must use per-user key:

```ts
hashIdentifierForUser(normalized: string, userPubkey: string): string {
  const userKey = hmac(sha256, utf8ToBytes(this.hmacSecret), utf8ToBytes(`signal-contact:${userPubkey}`))
  const mac = hmac(sha256, userKey, utf8ToBytes(normalized))
  return bytesToHex(mac)
}
```

(This is mostly for test / admin utility paths — the runtime flow has the client compute the hash.)

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/client/lib/signal-contact-registration.ts src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts src/server/services/signal-contacts.ts src/server/routes/auth-facade.ts
git commit -m "feat(signal-contact): client registration helper + per-user hmac key"
```

---

## Task 15: Onboarding prompt for Signal contact

**Files:**
- Modify: `src/client/routes/onboarding.tsx`
- Create: `src/client/components/SignalContactPrompt.tsx`

- [ ] **Step 1: Build component**

Create `src/client/components/SignalContactPrompt.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { registerSignalContact } from '@/lib/signal-contact-registration'

export function SignalContactPrompt({
  userPubkey,
  onDone,
}: {
  userPubkey: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [identifierType, setIdentifierType] = useState<'phone' | 'username'>('phone')
  const [plaintext, setPlaintext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await registerSignalContact({
        plaintextIdentifier: plaintext,
        identifierType,
        userPubkey,
        accessToken: '', // pulled from cookie/auth
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-md mx-auto p-6 space-y-4" data-testid="signal-contact-prompt">
      <h2 className="text-xl font-semibold">
        {t('onboarding.signal.title', 'Where should we send security alerts?')}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t(
          'onboarding.signal.description',
          'We send security notifications to your Signal account only. Enter your Signal phone number or username.'
        )}
      </p>
      <RadioGroup
        value={identifierType}
        onValueChange={(v) => setIdentifierType(v as 'phone' | 'username')}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="phone" id="type-phone" />
          <Label htmlFor="type-phone">{t('onboarding.signal.phone', 'Phone number')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="username" id="type-username" />
          <Label htmlFor="type-username">{t('onboarding.signal.username', 'Signal username')}</Label>
        </div>
      </RadioGroup>
      <Input
        value={plaintext}
        onChange={(e) => setPlaintext(e.target.value)}
        placeholder={
          identifierType === 'phone' ? '+15551234567' : '@handle.01'
        }
        data-testid="signal-identifier-input"
      />
      {error && <div className="text-sm text-red-600" data-testid="signal-error">{error}</div>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={submitting || !plaintext} data-testid="signal-submit">
          {submitting
            ? t('common.saving', 'Saving…')
            : t('onboarding.signal.save', 'Save')}
        </Button>
        <Button variant="ghost" onClick={onDone} data-testid="signal-skip">
          {t('onboarding.signal.skip', 'Skip for now')}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Mount in onboarding flow**

Modify `src/client/routes/onboarding.tsx` — add a step after the primary onboarding completes that renders `<SignalContactPrompt />`. If the user already has a contact (check via GET /api/auth/signal-contact), skip.

- [ ] **Step 3: Add translations**

Extend `public/locales/en.json`:

```json
"onboarding": {
  "signal": {
    "title": "Where should we send security alerts?",
    "description": "We send security notifications to your Signal account only. Enter your Signal phone number or username.",
    "phone": "Phone number",
    "username": "Signal username",
    "save": "Save",
    "skip": "Skip for now"
  }
}
```

- [ ] **Step 4: Typecheck + build + commit**

```bash
git add src/client/components/SignalContactPrompt.tsx src/client/routes/onboarding.tsx public/locales/en.json
git commit -m "feat(client): onboarding Signal contact prompt"
```

---

## Task 16: Digest cron

**Files:**
- Create: `src/server/services/digest-cron.ts`
- Modify: `src/server/server.ts`

- [ ] **Step 1: Write cron runner**

Create `src/server/services/digest-cron.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { userSecurityPrefs } from '../db/schema/security-prefs'
import type { AuthEventsService } from './auth-events'
import type { SecurityPrefsService } from './security-prefs'
import type { SignalContactsService } from './signal-contacts'
import type { UserNotificationsService } from './user-notifications'

export async function runDigestCron(
  db: PostgresJsDatabase,
  authEvents: AuthEventsService,
  _prefs: SecurityPrefsService,
  signalContacts: SignalContactsService,
  notifications: UserNotificationsService,
  cadence: 'daily' | 'weekly'
): Promise<{ sent: number }> {
  const periodDays = cadence === 'daily' ? 1 : 7
  const since = new Date(Date.now() - periodDays * 86400_000)

  const targets = await db
    .select()
    .from(userSecurityPrefs)
    .where(eq(userSecurityPrefs.digestCadence, cadence))

  let sent = 0
  for (const user of targets) {
    const contact = await signalContacts.findByUser(user.userPubkey)
    if (!contact) continue
    const events = await authEvents.listForUser(user.userPubkey, { limit: 200, since })
    const loginCount = events.filter((e) => e.eventType === 'login').length
    const failedCount = events.filter((e) => e.eventType === 'login_failed').length
    const alertCount = events.filter((e) => e.eventType === 'alert_sent').length
    const result = await notifications.sendAlert(user.userPubkey, {
      type: 'digest',
      periodDays,
      loginCount,
      alertCount,
      failedCount,
    })
    if (result.delivered) sent++
  }
  return { sent }
}
```

- [ ] **Step 2: Schedule in server.ts**

Find `src/server/server.ts` — after services are constructed, add:

```ts
import { runDigestCron } from './services/digest-cron'

setInterval(() => {
  runDigestCron(
    db,
    services.authEvents,
    services.securityPrefs,
    services.signalContacts,
    services.userNotifications,
    'daily'
  ).catch((err) => console.error('daily digest failed', err))
}, 24 * 3600 * 1000).unref?.()

setInterval(() => {
  runDigestCron(
    db,
    services.authEvents,
    services.securityPrefs,
    services.signalContacts,
    services.userNotifications,
    'weekly'
  ).catch((err) => console.error('weekly digest failed', err))
}, 7 * 24 * 3600 * 1000).unref?.()
```

- [ ] **Step 3: Commit**

```bash
git add src/server/services/digest-cron.ts src/server/server.ts
git commit -m "feat(notifications): daily + weekly digest cron"
```

---

## Task 17: API E2E tests

**Files:**
- Create: `tests/api/signal-contacts.spec.ts`
- Create: `tests/api/security-prefs.spec.ts`
- Create: `tests/api/signal-only-invites.spec.ts`

- [ ] **Step 1: Signal contacts**

Create `tests/api/signal-contacts.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { createAuthedRequest } from '../helpers/authed-request'

test.describe('Signal contact API', () => {
  test('GET /signal-contact returns null initially', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.get('/api/auth/signal-contact')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.contact).toBeNull()
  })

  test('GET /signal-contact/register-token returns token', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.get('/api/auth/signal-contact/register-token')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.token).toBeTruthy()
    expect(body.notifierUrl).toBeTruthy()
  })

  test('GET /signal-contact/hmac-key returns per-user key', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.get('/api/auth/signal-contact/hmac-key')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.key).toMatch(/^[0-9a-f]{64}$/)
  })

  test('POST /signal-contact rejects invalid token', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.post('/api/auth/signal-contact', {
      data: {
        identifierHash: 'a'.repeat(64),
        identifierCiphertext: 'x',
        identifierEnvelope: [],
        identifierType: 'phone',
        bridgeRegistrationToken: 'bogus:token:fields:here',
      },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(401)
  })
})
```

- [ ] **Step 2: Security prefs**

Create `tests/api/security-prefs.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { createAuthedRequest } from '../helpers/authed-request'

test.describe('Security prefs API', () => {
  test('GET returns defaults on first access', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.get('/api/auth/security-prefs')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.lockDelayMs).toBe(30000)
    expect(body.digestCadence).toBe('weekly')
    expect(body.disappearingTimerDays).toBe(1)
  })

  test('PATCH updates cadence', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.patch('/api/auth/security-prefs', {
      data: { digestCadence: 'off', disappearingTimerDays: 3 },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.digestCadence).toBe('off')
    expect(body.disappearingTimerDays).toBe(3)
  })

  test('PATCH rejects invalid disappearingTimerDays', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.patch('/api/auth/security-prefs', {
      data: { disappearingTimerDays: 99 },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(400)
  })
})
```

- [ ] **Step 3: Signal-only invites**

Create `tests/api/signal-only-invites.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { createAuthedRequest } from '../helpers/authed-request'

test.describe('Signal-only user invites', () => {
  test('user invite rejects sms channel', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.post('/api/invites/send', {
      data: { phone: '+15551234567', channel: 'sms', name: 'Test' },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(400)
  })

  test('user invite rejects whatsapp channel', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.post('/api/invites/send', {
      data: { phone: '+15551234567', channel: 'whatsapp', name: 'Test' },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(400)
  })
})
```

- [ ] **Step 4: Run + commit**

```bash
bun run test:api -- tests/api/signal-contacts.spec.ts tests/api/security-prefs.spec.ts tests/api/signal-only-invites.spec.ts
git add tests/api/
git commit -m "test(api): signal contacts + security prefs + signal-only invites"
```

---

## Task 18: Verification

- [ ] `bun run typecheck` — clean
- [ ] `bun run build` — clean
- [ ] `bun run test:unit` — all pass
- [ ] `signal-notifier` unit tests pass
- [ ] `bun run test:api` — all pass
- [ ] `docker compose -f deploy/docker/docker-compose.dev.yml up signal-notifier` — sidecar starts, `/healthz` returns 200
- [ ] Manual: log in with a new IP → verify Signal alert delivered via notifier logs + bridge
- [ ] `git push` — branch updated
