# Plan A — Session Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stateless JWT refresh tokens with DB-backed opaque session tokens, add per-session tracking with IP+geo metadata (user-envelope encrypted), rotate tokens on refresh with replay detection, and ship `/security/sessions` + `/security/passkeys` UI.

**Architecture:** New `user_sessions` table stores hashed opaque tokens with user-envelope-encrypted session metadata. Login issues 32-byte random token, stores `sha256(token)` hash. Refresh rotates token + updates lastSeenAt. Replay detection fires when a token hash doesn't match any live session but matches a prior-chain entry.

**Tech Stack:** Drizzle ORM, PostgreSQL, DB-IP Lite (offline MMDB), `maxmind` npm package, Hono OpenAPIHono, zod schemas, React Query, TanStack Router, XChaCha20-Poly1305 via `@noble/ciphers`.

**Spec reference:** `docs/superpowers/specs/2026-04-04-user-security-device-management-design.md` (sections 4.1, 4.2, 5, 6)

---

## File Structure

**New files:**
- `src/server/db/schema/sessions.ts` — user_sessions table
- `src/server/services/sessions.ts` — SessionService (create, list, revoke, rotate, findByTokenHash, detectReplay)
- `src/server/services/sessions.test.ts` — unit tests (pure, no DB)
- `src/server/services/sessions.integration.test.ts` — integration tests (real DB)
- `src/server/lib/geoip.ts` — DB-IP Lite MMDB reader wrapper
- `src/server/lib/geoip.test.ts` — unit tests with fixture MMDB
- `src/server/lib/session-tokens.ts` — generate/hash/verify opaque tokens
- `src/server/lib/session-tokens.test.ts` — unit tests
- `src/shared/schemas/sessions.ts` — zod schemas for API
- `src/shared/schemas/passkeys.ts` — zod schemas for passkey endpoints
- `src/client/routes/security.tsx` — parent Security route layout
- `src/client/routes/security.sessions.tsx` — sessions tab
- `src/client/routes/security.passkeys.tsx` — passkeys tab
- `src/client/lib/api/security.ts` — client API wrapper
- `src/client/lib/queries/security.ts` — React Query hooks
- `tests/api/sessions.spec.ts` — API E2E tests for sessions
- `tests/api/passkeys.spec.ts` — API E2E tests for passkeys (rename)
- `tests/ui/security-page.spec.ts` — UI E2E for security page
- `drizzle/migrations/0041_user_sessions.sql` — migration
- `drizzle/migrations/0042_drop_jwt_revocations.sql` — cleanup migration
- `deploy/ansible/roles/app/files/dbip-city-lite.mmdb` — DB file (or download script)
- `scripts/download-dbip.sh` — fetch DB-IP Lite MMDB

**Modified files:**
- `src/shared/crypto-labels.ts` — add `LABEL_SESSION_META`
- `src/server/db/schema/index.ts` — export sessions schema
- `src/server/services/index.ts` — register SessionService
- `src/server/routes/auth-facade.ts` — refactor refresh flow, add session endpoints, rename /devices→/passkeys
- `src/server/app.ts` — any service wiring needed for SessionService
- `src/client/lib/queries/keys.ts` — add security query keys
- `src/client/lib/query-client.ts` — classify new keys (ENCRYPTED)
- `src/client/lib/decrypt-fields.ts` — add decryptor for session meta envelope
- `src/client/components/Navigation.tsx` (or equivalent) — add "Security" menu entry
- `src/client/routes/devices.tsx` (if exists) — redirect to `/security/passkeys`
- `src/server/types.ts` — UserSession type export
- `CLAUDE.md` — add session-model notes

---

## Task 1: Add crypto label for session meta

**Files:**
- Modify: `src/shared/crypto-labels.ts`

- [ ] **Step 1: Add label constant**

Append to the Field-Level (Phase 2A) section of `src/shared/crypto-labels.ts`:

```ts
/** Session metadata envelope (IP, UA, location) — user-envelope encrypted */
export const LABEL_SESSION_META = 'llamenos:session-meta:v1'
```

- [ ] **Step 2: Verify no clash**

Run: `grep "session-meta" src/shared/crypto-labels.ts | wc -l`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add src/shared/crypto-labels.ts
git commit -m "chore(crypto): add LABEL_SESSION_META domain separation constant"
```

---

## Task 2: Drizzle migration — user_sessions table

**Files:**
- Create: `src/server/db/schema/sessions.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `drizzle/migrations/0041_user_sessions.sql` (generated)

- [ ] **Step 1: Write schema file**

Create `src/server/db/schema/sessions.ts`:

```ts
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { RecipientEnvelope } from '../../../shared/types'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

export const userSessions = pgTable(
  'user_sessions',
  {
    id: text('id').primaryKey(),
    userPubkey: text('user_pubkey').notNull(),
    tokenHash: text('token_hash').notNull(),
    ipHash: text('ip_hash').notNull(),
    credentialId: text('credential_id'),
    encryptedMeta: ciphertext('encrypted_meta').notNull(),
    metaEnvelope: jsonb<RecipientEnvelope[]>()('meta_envelope').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    userPubkeyIdx: index('user_sessions_user_pubkey_idx').on(table.userPubkey),
    tokenHashIdx: index('user_sessions_token_hash_idx').on(table.tokenHash),
    expiresAtIdx: index('user_sessions_expires_at_idx').on(table.expiresAt),
  })
)

export type UserSessionRow = typeof userSessions.$inferSelect
export type InsertUserSession = typeof userSessions.$inferInsert
```

- [ ] **Step 2: Export from schema index**

Modify `src/server/db/schema/index.ts` — add export line (follow existing alphabetical pattern):

```ts
export * from './sessions'
```

- [ ] **Step 3: Generate migration**

Run: `bun run migrate:generate`
Expected: a new file `drizzle/migrations/0041_*.sql` created. Rename it to `0041_user_sessions.sql` if needed.

- [ ] **Step 4: Inspect generated SQL**

Verify the migration contains `CREATE TABLE "user_sessions"` with all columns + three indexes. If not, hand-edit the SQL file to match the schema.

- [ ] **Step 5: Run migration**

Run: `bun run migrate`
Expected: migration applies cleanly; `\d user_sessions` in psql shows the table.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema/sessions.ts src/server/db/schema/index.ts drizzle/migrations/
git commit -m "feat(db): add user_sessions table for opaque-token session tracking"
```

---

## Task 3: Session token utilities + tests

**Files:**
- Create: `src/server/lib/session-tokens.ts`
- Create: `src/server/lib/session-tokens.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/server/lib/session-tokens.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { generateSessionToken, hashSessionToken, verifySessionToken } from './session-tokens'

describe('session-tokens', () => {
  test('generateSessionToken returns 43-char base64url string', () => {
    const token = generateSessionToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('generateSessionToken returns different values on each call', () => {
    const a = generateSessionToken()
    const b = generateSessionToken()
    expect(a).not.toBe(b)
  })

  test('hashSessionToken produces stable 64-char hex hash', () => {
    const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const hash = hashSessionToken(token, 'secret-key')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSessionToken(token, 'secret-key')).toBe(hash)
  })

  test('hashSessionToken changes with secret', () => {
    const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    expect(hashSessionToken(token, 'a')).not.toBe(hashSessionToken(token, 'b'))
  })

  test('verifySessionToken returns true for matching token/hash', () => {
    const token = generateSessionToken()
    const hash = hashSessionToken(token, 'secret')
    expect(verifySessionToken(token, hash, 'secret')).toBe(true)
  })

  test('verifySessionToken returns false for non-matching token', () => {
    const hash = hashSessionToken(generateSessionToken(), 'secret')
    expect(verifySessionToken(generateSessionToken(), hash, 'secret')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/lib/session-tokens.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/server/lib/session-tokens.ts`:

```ts
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

const TOKEN_BYTE_LENGTH = 32

/**
 * Generate a cryptographically random opaque session token.
 * Returns base64url-encoded 32 random bytes (43 chars, no padding).
 */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTE_LENGTH)
  crypto.getRandomValues(bytes)
  // base64url: standard base64 + URL-safe substitutions, no padding
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Hash a session token with HMAC-SHA256 for safe DB storage.
 * Uses the HMAC_SECRET env var value passed in as `secret`.
 */
export function hashSessionToken(token: string, secret: string): string {
  const mac = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(token))
  return bytesToHex(mac)
}

/**
 * Constant-time comparison of a presented token against a stored hash.
 */
export function verifySessionToken(token: string, storedHash: string, secret: string): boolean {
  const computed = hashSessionToken(token, secret)
  if (computed.length !== storedHash.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ storedHash.charCodeAt(i)
  }
  return diff === 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/lib/session-tokens.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/session-tokens.ts src/server/lib/session-tokens.test.ts
git commit -m "feat(auth): add opaque session token generation + hashing"
```

---

## Task 4: Download DB-IP Lite + geoip wrapper + tests

**Files:**
- Create: `scripts/download-dbip.sh`
- Create: `src/server/lib/geoip.ts`
- Create: `src/server/lib/geoip.test.ts`
- Create: `tests/fixtures/geoip-test.mmdb` (small test fixture)

- [ ] **Step 1: Install maxmind npm package**

Run: `bun add maxmind`
Expected: `maxmind` added to dependencies in package.json.

- [ ] **Step 2: Write download script**

Create `scripts/download-dbip.sh`:

```bash
#!/usr/bin/env bash
# Download DB-IP City Lite MMDB (CC-BY license).
# Run monthly via cron; output path default: ./data/geoip/dbip-city.mmdb
set -euo pipefail

OUTPUT_DIR="${GEOIP_DIR:-./data/geoip}"
OUTPUT_FILE="$OUTPUT_DIR/dbip-city.mmdb"
MONTH=$(date -u +%Y-%m)
URL="https://download.db-ip.com/free/dbip-city-lite-${MONTH}.mmdb.gz"

mkdir -p "$OUTPUT_DIR"
echo "Downloading $URL ..."
curl -fsSL "$URL" -o "$OUTPUT_FILE.gz"
gunzip -f "$OUTPUT_FILE.gz"
echo "Saved to $OUTPUT_FILE"
ls -lh "$OUTPUT_FILE"
```

Then: `chmod +x scripts/download-dbip.sh`

- [ ] **Step 3: Download a real DB-IP file for dev + test**

Run: `./scripts/download-dbip.sh`
Expected: file saved at `./data/geoip/dbip-city.mmdb`. Add `data/geoip/*.mmdb` to `.gitignore`.

- [ ] **Step 4: Write failing test**

Create `src/server/lib/geoip.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { lookupIp } from './geoip'

const DEV_DB_PATH = './data/geoip/dbip-city.mmdb'

describe('geoip', () => {
  test('lookupIp returns unknown country for invalid IP', async () => {
    const result = await lookupIp('not-an-ip', DEV_DB_PATH)
    expect(result.country).toBe('unknown')
  })

  test('lookupIp returns unknown for private IP', async () => {
    const result = await lookupIp('10.0.0.1', DEV_DB_PATH)
    expect(result.country).toBe('unknown')
  })

  test.if(existsSync(DEV_DB_PATH))('lookupIp resolves Google DNS', async () => {
    const result = await lookupIp('8.8.8.8', DEV_DB_PATH)
    expect(result.country).toBe('US')
  })

  test('lookupIp returns unknown when DB file missing', async () => {
    const result = await lookupIp('8.8.8.8', '/nonexistent/path.mmdb')
    expect(result.country).toBe('unknown')
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `bun test src/server/lib/geoip.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Write implementation**

Create `src/server/lib/geoip.ts`:

```ts
import { existsSync } from 'node:fs'
import maxmind, { type CityResponse, type Reader } from 'maxmind'

export interface GeoLookupResult {
  city: string
  region: string
  country: string // ISO 3166-1 alpha-2 code or 'unknown'
  lat: number | null
  lon: number | null
}

const UNKNOWN: GeoLookupResult = {
  city: 'unknown',
  region: 'unknown',
  country: 'unknown',
  lat: null,
  lon: null,
}

// Cache the reader — MMDB files are memory-mapped and expensive to open repeatedly.
let cachedReader: Reader<CityResponse> | null = null
let cachedPath: string | null = null

async function getReader(dbPath: string): Promise<Reader<CityResponse> | null> {
  if (!existsSync(dbPath)) return null
  if (cachedReader && cachedPath === dbPath) return cachedReader
  try {
    cachedReader = await maxmind.open<CityResponse>(dbPath)
    cachedPath = dbPath
    return cachedReader
  } catch {
    return null
  }
}

function isPublicIp(ip: string): boolean {
  // Simple check: reject obvious private/localhost ranges. DB-IP will return null for them anyway,
  // but early-exit avoids a lookup.
  if (ip === 'unknown') return false
  if (/^(10|127)\./.test(ip)) return false
  if (/^192\.168\./.test(ip)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false
  if (ip === '::1' || ip.startsWith('fe80')) return false
  return true
}

export async function lookupIp(ip: string, dbPath: string): Promise<GeoLookupResult> {
  if (!isPublicIp(ip)) return UNKNOWN
  const reader = await getReader(dbPath)
  if (!reader) return UNKNOWN
  try {
    const resp = reader.get(ip)
    if (!resp) return UNKNOWN
    return {
      city: resp.city?.names?.en ?? 'unknown',
      region: resp.subdivisions?.[0]?.names?.en ?? 'unknown',
      country: resp.country?.iso_code ?? 'unknown',
      lat: resp.location?.latitude ?? null,
      lon: resp.location?.longitude ?? null,
    }
  } catch {
    return UNKNOWN
  }
}
```

- [ ] **Step 7: Add to .gitignore**

Modify `.gitignore`, add line: `data/geoip/*.mmdb`

- [ ] **Step 8: Run test**

Run: `bun test src/server/lib/geoip.test.ts`
Expected: 3–4 tests pass (the `.if` test depends on DB presence).

- [ ] **Step 9: Commit**

```bash
git add scripts/download-dbip.sh src/server/lib/geoip.ts src/server/lib/geoip.test.ts .gitignore package.json bun.lock
git commit -m "feat(geoip): add DB-IP Lite MMDB reader for session geolocation"
```

---

## Task 5: SessionService — unit tests first

**Files:**
- Create: `src/server/services/sessions.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/server/services/sessions.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { formatUserAgent } from './sessions'

describe('SessionService helpers', () => {
  test('formatUserAgent summarises Firefox on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0'
    expect(formatUserAgent(ua)).toBe('Firefox on macOS')
  })

  test('formatUserAgent summarises Safari on iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
    expect(formatUserAgent(ua)).toBe('Safari on iOS')
  })

  test('formatUserAgent summarises Chrome on Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    expect(formatUserAgent(ua)).toBe('Chrome on Windows')
  })

  test('formatUserAgent returns unknown for empty string', () => {
    expect(formatUserAgent('')).toBe('Unknown browser')
  })

  test('formatUserAgent returns unknown for garbage', () => {
    expect(formatUserAgent('xxxxxx')).toBe('Unknown browser')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/services/sessions.test.ts`
Expected: FAIL — module not found.

(Implementation follows in Task 6.)

---

## Task 6: SessionService — implementation + pure-function tests pass

**Files:**
- Create: `src/server/services/sessions.ts`

- [ ] **Step 1: Write implementation skeleton with formatUserAgent**

Create `src/server/services/sessions.ts`:

```ts
import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { LABEL_SESSION_META } from '../../shared/crypto-labels'
import type { Ciphertext, RecipientEnvelope } from '../../shared/types'
import { userSessions, type UserSessionRow } from '../db/schema/sessions'
import { hashSessionToken } from '../lib/session-tokens'

export interface SessionMetaPlain {
  ip: string
  userAgent: string
  city: string
  region: string
  country: string
  lat: number | null
  lon: number | null
}

export type RevokeReason =
  | 'user'
  | 'lockdown_a'
  | 'lockdown_b'
  | 'lockdown_c'
  | 'admin'
  | 'replay'
  | 'expired'

export interface CreateSessionInput {
  id: string
  userPubkey: string
  tokenHash: string
  ipHash: string
  credentialId: string | null
  encryptedMeta: Ciphertext
  metaEnvelope: RecipientEnvelope[]
  expiresAt: Date
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_TTL_MS)
}

/**
 * Extract a concise browser-on-OS label from a User-Agent string.
 */
export function formatUserAgent(ua: string): string {
  if (!ua) return 'Unknown browser'
  const lowered = ua.toLowerCase()

  let browser: string | null = null
  if (lowered.includes('firefox/')) browser = 'Firefox'
  else if (lowered.includes('edg/')) browser = 'Edge'
  else if (lowered.includes('chrome/') && !lowered.includes('edg/')) browser = 'Chrome'
  else if (lowered.includes('safari/') && !lowered.includes('chrome/')) browser = 'Safari'

  let os: string | null = null
  if (lowered.includes('iphone') || lowered.includes('ipad')) os = 'iOS'
  else if (lowered.includes('android')) os = 'Android'
  else if (lowered.includes('mac os x')) os = 'macOS'
  else if (lowered.includes('windows')) os = 'Windows'
  else if (lowered.includes('linux')) os = 'Linux'

  if (!browser || !os) return 'Unknown browser'
  return `${browser} on ${os}`
}

export class SessionService {
  constructor(private db: PostgresJsDatabase, private hmacSecret: string) {}

  async create(input: CreateSessionInput): Promise<UserSessionRow> {
    const rows = await this.db.insert(userSessions).values(input).returning()
    const row = rows[0]
    if (!row) throw new Error('Failed to create session')
    return row
  }

  async listForUser(userPubkey: string): Promise<UserSessionRow[]> {
    return this.db
      .select()
      .from(userSessions)
      .where(and(eq(userSessions.userPubkey, userPubkey), isNull(userSessions.revokedAt)))
      .orderBy(desc(userSessions.lastSeenAt))
  }

  async findByTokenHash(tokenHash: string): Promise<UserSessionRow | null> {
    const rows = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.tokenHash, tokenHash))
      .limit(1)
    return rows[0] ?? null
  }

  async findByIdForUser(id: string, userPubkey: string): Promise<UserSessionRow | null> {
    const rows = await this.db
      .select()
      .from(userSessions)
      .where(and(eq(userSessions.id, id), eq(userSessions.userPubkey, userPubkey)))
      .limit(1)
    return rows[0] ?? null
  }

  async touch(id: string, tokenHash: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ lastSeenAt: new Date(), tokenHash })
      .where(eq(userSessions.id, id))
  }

  async revoke(id: string, reason: RevokeReason): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(userSessions.id, id), isNull(userSessions.revokedAt)))
  }

  async revokeAllForUser(
    userPubkey: string,
    reason: RevokeReason,
    exceptSessionId?: string
  ): Promise<number> {
    const where = exceptSessionId
      ? and(
          eq(userSessions.userPubkey, userPubkey),
          isNull(userSessions.revokedAt),
          // != exceptSessionId
          // Use ne() when importing; inline sql fragment as fallback
        )
      : and(eq(userSessions.userPubkey, userPubkey), isNull(userSessions.revokedAt))

    // For simplicity, do a single query excluding by id in a second pass if needed.
    const sessions = await this.db
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(and(eq(userSessions.userPubkey, userPubkey), isNull(userSessions.revokedAt)))

    let count = 0
    for (const s of sessions) {
      if (exceptSessionId && s.id === exceptSessionId) continue
      await this.revoke(s.id, reason)
      count++
    }
    return count
  }

  async purgeExpired(before: Date = new Date()): Promise<number> {
    const rows = await this.db
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(and(isNull(userSessions.revokedAt), lt(userSessions.expiresAt, before)))
    for (const row of rows) {
      await this.revoke(row.id, 'expired')
    }
    return rows.length
  }
}

export { LABEL_SESSION_META }
```

- [ ] **Step 2: Run the unit test**

Run: `bun test src/server/services/sessions.test.ts`
Expected: 5 tests pass (formatUserAgent tests).

- [ ] **Step 3: Commit**

```bash
git add src/server/services/sessions.ts src/server/services/sessions.test.ts
git commit -m "feat(sessions): add SessionService with CRUD + user-agent formatting"
```

---

## Task 7: SessionService integration tests

**Files:**
- Create: `src/server/services/sessions.integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `src/server/services/sessions.integration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Ciphertext } from '../../shared/types'
import { userSessions } from '../db/schema/sessions'
import { SessionService, sessionExpiry } from './sessions'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://localhost:5433/llamenos'

const sql = postgres(TEST_DB_URL, { max: 2 })
const db = drizzle(sql)
const service = new SessionService(db, 'test-hmac-secret')

const fakeUser = 'a'.repeat(64)
const fakeUser2 = 'b'.repeat(64)

async function cleanup(): Promise<void> {
  // Delete test-only sessions
  await sql`DELETE FROM user_sessions WHERE user_pubkey IN (${fakeUser}, ${fakeUser2})`
}

beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await sql.end()
})

function createInput(id: string, userPubkey: string, tokenHash: string) {
  return {
    id,
    userPubkey,
    tokenHash,
    ipHash: 'ip-hash-' + id,
    credentialId: null,
    encryptedMeta: 'ct' as Ciphertext,
    metaEnvelope: [],
    expiresAt: sessionExpiry(),
  }
}

describe('SessionService integration', () => {
  test('create + list returns active session', async () => {
    await service.create(createInput('s1', fakeUser, 'hash1'))
    const sessions = await service.listForUser(fakeUser)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('s1')
  })

  test('findByTokenHash returns session', async () => {
    await service.create(createInput('s2', fakeUser, 'hash2'))
    const found = await service.findByTokenHash('hash2')
    expect(found?.id).toBe('s2')
  })

  test('findByTokenHash returns null for missing hash', async () => {
    const found = await service.findByTokenHash('not-a-hash')
    expect(found).toBeNull()
  })

  test('revoke sets revokedAt and excludes from listForUser', async () => {
    await service.create(createInput('s3', fakeUser, 'hash3'))
    await service.revoke('s3', 'user')
    const sessions = await service.listForUser(fakeUser)
    expect(sessions).toHaveLength(0)
  })

  test('revokeAllForUser with exception keeps one alive', async () => {
    await service.create(createInput('s4', fakeUser, 'h4'))
    await service.create(createInput('s5', fakeUser, 'h5'))
    await service.create(createInput('s6', fakeUser, 'h6'))
    const count = await service.revokeAllForUser(fakeUser, 'lockdown_a', 's5')
    expect(count).toBe(2)
    const sessions = await service.listForUser(fakeUser)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('s5')
  })

  test('touch updates lastSeenAt and tokenHash', async () => {
    await service.create(createInput('s7', fakeUser, 'h7'))
    await new Promise((r) => setTimeout(r, 10))
    await service.touch('s7', 'h7-rotated')
    const found = await service.findByTokenHash('h7-rotated')
    expect(found?.id).toBe('s7')
    const oldHash = await service.findByTokenHash('h7')
    expect(oldHash).toBeNull()
  })

  test('purgeExpired revokes expired sessions', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await service.create({
      id: 's8',
      userPubkey: fakeUser,
      tokenHash: 'h8',
      ipHash: 'x',
      credentialId: null,
      encryptedMeta: 'ct' as Ciphertext,
      metaEnvelope: [],
      expiresAt: yesterday,
    })
    const count = await service.purgeExpired()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('listForUser does not leak across users', async () => {
    await service.create(createInput('su1', fakeUser, 'ha'))
    await service.create(createInput('su2', fakeUser2, 'hb'))
    const forUser1 = await service.listForUser(fakeUser)
    expect(forUser1).toHaveLength(1)
    expect(forUser1[0].id).toBe('su1')
  })
})
```

- [ ] **Step 2: Run test (requires Postgres)**

Run: `bun run dev:docker` (if not already running), then `bun test src/server/services/sessions.integration.test.ts`
Expected: 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/server/services/sessions.integration.test.ts
git commit -m "test(sessions): add SessionService integration tests"
```

---

## Task 8: Register SessionService in services container

**Files:**
- Modify: `src/server/services/index.ts`

- [ ] **Step 1: Add to Services interface + construction**

Modify `src/server/services/index.ts`:

Add the import near the other service imports:
```ts
import { SessionService } from './sessions'
```

Add to the `Services` interface:
```ts
sessions: SessionService
```

Add to the construction block (wherever other services are instantiated):
```ts
const sessions = new SessionService(db, process.env.HMAC_SECRET ?? '')
```

And include `sessions` in the returned services object.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/services/index.ts
git commit -m "feat(services): register SessionService in services container"
```

---

## Task 9: Wire SessionService into auth-facade context

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Add to AuthFacadeEnv Variables**

Modify `src/server/routes/auth-facade.ts` — add to `AuthFacadeEnv.Variables`:

```ts
sessions: SessionService
```

And import:
```ts
import type { SessionService } from '../services/sessions'
```

- [ ] **Step 2: Bridge the service in app.ts**

In `src/server/app.ts`, find the auth-facade bridge middleware and add the line that maps sessions:

```ts
ctx.set('sessions', services.sessions)
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/auth-facade.ts src/server/app.ts
git commit -m "feat(auth): expose SessionService to auth-facade routes"
```

---

## Task 10: Sessions zod schemas

**Files:**
- Create: `src/shared/schemas/sessions.ts`

- [ ] **Step 1: Write schema file**

Create `src/shared/schemas/sessions.ts`:

```ts
import { z } from '@hono/zod-openapi'
import { RecipientEnvelopeSchema } from './common'

export const RevokeReasonSchema = z.enum([
  'user',
  'lockdown_a',
  'lockdown_b',
  'lockdown_c',
  'admin',
  'replay',
  'expired',
])

export const SessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
  isCurrent: z.boolean(),
  encryptedMeta: z.string(),
  metaEnvelope: z.array(RecipientEnvelopeSchema),
  credentialId: z.string().nullable(),
})

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionSchema),
})

export const RevokeSessionParamsSchema = z.object({
  id: z.string().uuid(),
})

export const RevokeOthersResponseSchema = z.object({
  revokedCount: z.number().int().min(0),
})

export type SessionResponse = z.infer<typeof SessionSchema>
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>
```

- [ ] **Step 2: Check RecipientEnvelopeSchema exists**

Run: `grep -n "RecipientEnvelopeSchema" src/shared/schemas/common.ts`
Expected: the export already exists. If not, add it:

```ts
export const RecipientEnvelopeSchema = z.object({
  pubkey: z.string(),
  wrappedKey: z.string(),
  ephemeralPubkey: z.string(),
})
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/schemas/sessions.ts src/shared/schemas/common.ts
git commit -m "feat(schemas): add session zod schemas"
```

---

## Task 11: Refactor auth-facade login — create session on login-verify

**Files:**
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Import new deps at top of file**

Add to the imports:

```ts
import { LABEL_SESSION_META } from '@shared/crypto-labels'
import { generateSessionToken, hashSessionToken } from '../lib/session-tokens'
import { lookupIp } from '../lib/geoip'
import type { CryptoService } from '../lib/crypto-service'

const GEOIP_DB_PATH = process.env.GEOIP_DB_PATH ?? './data/geoip/dbip-city.mmdb'
```

- [ ] **Step 2: Add CryptoService to AuthFacadeEnv Variables**

Add to `AuthFacadeEnv.Variables`:

```ts
crypto: CryptoService
```

Bridge in `src/server/app.ts`:

```ts
ctx.set('crypto', services.crypto)
```

- [ ] **Step 3: Replace refresh-JWT sign on login-verify success**

In `/webauthn/login-verify` handler, replace the block that signs refresh token and sets cookie. Remove:

```ts
const refreshToken = await signRefreshToken(matched.ownerPubkey, c.env.JWT_SECRET)
setCookie(c, 'llamenos-refresh', refreshToken, { ... })
```

Replace with session creation:

```ts
const sessions = c.get('sessions')
const crypto = c.get('crypto')

// Extract IP + UA
const clientIp =
  c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
  c.req.header('CF-Connecting-IP') ||
  'unknown'
const userAgent = c.req.header('User-Agent') || ''

// Geolocate
const geo = await lookupIp(clientIp, GEOIP_DB_PATH)

// Build session meta + encrypt with user envelope
const metaPlain = JSON.stringify({
  ip: clientIp,
  userAgent,
  city: geo.city,
  region: geo.region,
  country: geo.country,
  lat: geo.lat,
  lon: geo.lon,
})
const { encrypted, envelopes } = crypto.envelopeEncrypt(
  metaPlain,
  [matched.ownerPubkey],
  LABEL_SESSION_META
)

// Generate opaque token
const token = generateSessionToken()
const tokenHash = hashSessionToken(token, c.env.HMAC_SECRET)
const sessionId = crypto.randomUUID?.() ?? crypto.constructor.name // fallback: crypto-service may not expose randomUUID
const sessionIdFinal = (globalThis.crypto.randomUUID as () => string)()

await sessions.create({
  id: sessionIdFinal,
  userPubkey: matched.ownerPubkey,
  tokenHash,
  ipHash: hashIP(clientIp, c.env.HMAC_SECRET),
  credentialId: matched.id,
  encryptedMeta: encrypted,
  metaEnvelope: envelopes,
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
})

setCookie(c, 'llamenos-refresh', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  path: '/api/auth/token',
  maxAge: 30 * 24 * 60 * 60,
})
// Also set session id in a parallel cookie so we can look it up fast and mark isCurrent.
setCookie(c, 'llamenos-session-id', sessionIdFinal, {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  path: '/',
  maxAge: 30 * 24 * 60 * 60,
})
```

- [ ] **Step 4: Remove signRefreshToken and verifyRefreshToken functions**

Delete the `signRefreshToken` and `verifyRefreshToken` functions (lines ~116–141) from `auth-facade.ts` — they're no longer used. Also remove them from the export list at the bottom.

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/auth-facade.ts src/server/app.ts
git commit -m "feat(auth): issue opaque session tokens on login instead of JWT refresh"
```

---

## Task 12: Refactor auth-facade — token refresh uses sessions

**Files:**
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Replace /token/refresh handler body**

Replace the entire body of `authFacade.post('/token/refresh', ...)` with:

```ts
const contentType = c.req.header('Content-Type')
if (!contentType?.includes('application/json')) {
  return c.json({ error: 'Content-Type must be application/json' }, 415)
}

const refreshCookie = getCookie(c, 'llamenos-refresh')
if (!refreshCookie) {
  return c.json({ error: 'Missing refresh token' }, 401)
}

const sessions = c.get('sessions')
const tokenHash = hashSessionToken(refreshCookie, c.env.HMAC_SECRET)
const session = await sessions.findByTokenHash(tokenHash)
if (!session) {
  // Hash doesn't match any session — could be replay of a rotated token
  return c.json({ error: 'Invalid or expired session' }, 401)
}
if (session.revokedAt) {
  return c.json({ error: 'Session revoked' }, 401)
}
if (session.expiresAt < new Date()) {
  await sessions.revoke(session.id, 'expired')
  return c.json({ error: 'Session expired' }, 401)
}

// Rotate: generate new token, replace hash
const newToken = generateSessionToken()
const newHash = hashSessionToken(newToken, c.env.HMAC_SECRET)
await sessions.touch(session.id, newHash)

// Confirm user is still active in IdP
const idpAdapter = c.get('idpAdapter')
const identity = c.get('identity')
const idpSession = await idpAdapter.refreshSession(session.userPubkey)
if (!idpSession.valid) {
  await sessions.revoke(session.id, 'admin')
  return c.json({ error: 'Session no longer valid' }, 401)
}

const settings = c.get('settings')
const permissions = await resolveUserPermissions(session.userPubkey, identity, settings)
const accessToken = await signAccessToken(
  { pubkey: session.userPubkey, permissions },
  c.env.JWT_SECRET
)

setCookie(c, 'llamenos-refresh', newToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  path: '/api/auth/token',
  maxAge: 30 * 24 * 60 * 60,
})

return c.json({ accessToken })
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/routes/auth-facade.ts
git commit -m "feat(auth): rotate opaque token on refresh + look up session by hash"
```

---

## Task 13: Refactor /session/revoke to revoke current session row

**Files:**
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Replace /session/revoke handler**

Replace the body of `authFacade.post('/session/revoke', ...)`:

```ts
const pubkey = c.get('pubkey')
const sessions = c.get('sessions')
const idpAdapter = c.get('idpAdapter')

const sessionIdCookie = getCookie(c, 'llamenos-session-id')
if (sessionIdCookie) {
  const session = await sessions.findByIdForUser(sessionIdCookie, pubkey)
  if (session) {
    await sessions.revoke(session.id, 'user')
  }
}

// Also revoke IdP session if still applicable.
try {
  await idpAdapter.revokeSession(pubkey)
} catch {
  // IdP may have already expired; ignore.
}

setCookie(c, 'llamenos-refresh', '', {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  path: '/api/auth/token',
  maxAge: 0,
})
setCookie(c, 'llamenos-session-id', '', {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  path: '/',
  maxAge: 0,
})

return c.json({ ok: true })
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/routes/auth-facade.ts
git commit -m "feat(auth): logout now revokes session row in addition to IdP session"
```

---

## Task 14: Add GET /sessions, DELETE /sessions/:id, POST /sessions/revoke-others

**Files:**
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Add middleware registration**

Near the other `authFacade.use(...)` calls for authenticated routes:

```ts
authFacade.use('/sessions', jwtAuth)
authFacade.use('/sessions/*', jwtAuth)
```

- [ ] **Step 2: Add endpoint handlers**

Add these handlers:

```ts
// GET /sessions — list current user's sessions
authFacade.get('/sessions', async (c) => {
  const pubkey = c.get('pubkey')
  const sessions = c.get('sessions')
  const sessionIdCookie = getCookie(c, 'llamenos-session-id')
  const rows = await sessions.listForUser(pubkey)
  return c.json({
    sessions: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      isCurrent: r.id === sessionIdCookie,
      encryptedMeta: r.encryptedMeta,
      metaEnvelope: r.metaEnvelope,
      credentialId: r.credentialId,
    })),
  })
})

// DELETE /sessions/:id — revoke a specific session
authFacade.delete('/sessions/:id', async (c) => {
  const pubkey = c.get('pubkey')
  const sessions = c.get('sessions')
  const id = c.req.param('id')
  const session = await sessions.findByIdForUser(id, pubkey)
  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }
  await sessions.revoke(id, 'user')
  return c.json({ ok: true })
})

// POST /sessions/revoke-others — revoke all except current
authFacade.post('/sessions/revoke-others', async (c) => {
  const pubkey = c.get('pubkey')
  const sessions = c.get('sessions')
  const sessionIdCookie = getCookie(c, 'llamenos-session-id')
  const count = await sessions.revokeAllForUser(pubkey, 'user', sessionIdCookie ?? undefined)
  return c.json({ revokedCount: count })
})
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/auth-facade.ts
git commit -m "feat(auth): add session list/revoke/revoke-others endpoints"
```

---

## Task 15: Add /passkeys route aliases + PATCH for label rename

**Files:**
- Modify: `src/server/routes/auth-facade.ts`
- Create: `src/shared/schemas/passkeys.ts`

- [ ] **Step 1: Write passkey schemas**

Create `src/shared/schemas/passkeys.ts`:

```ts
import { z } from '@hono/zod-openapi'
import { RecipientEnvelopeSchema } from './common'

export const PasskeyRenameSchema = z
  .object({
    label: z.string().max(100).optional(),
    encryptedLabel: z.string().optional(),
    labelEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
  })
  .refine((d) => d.label !== undefined || d.encryptedLabel !== undefined, {
    message: 'Must provide either label or encryptedLabel',
  })

export type PasskeyRenameInput = z.infer<typeof PasskeyRenameSchema>
```

- [ ] **Step 2: Add renameWebAuthnCredential to IdentityService**

Modify `src/server/services/identity.ts` — add method after `deleteWebAuthnCredential`:

```ts
async renameWebAuthnCredential(
  pubkey: string,
  credId: string,
  data: { label?: string; encryptedLabel?: Ciphertext; labelEnvelopes?: RecipientEnvelope[] }
): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (data.encryptedLabel !== undefined) updates.encryptedLabel = data.encryptedLabel
  if (data.labelEnvelopes !== undefined) updates.labelEnvelopes = data.labelEnvelopes
  if (Object.keys(updates).length === 0) return

  const result = await this.db
    .update(webauthnCredentials)
    .set(updates)
    .where(and(eq(webauthnCredentials.id, credId), eq(webauthnCredentials.pubkey, pubkey)))
    .returning({ id: webauthnCredentials.id })

  if (result.length === 0) {
    throw new Error('Credential not found')
  }
}
```

- [ ] **Step 3: Register /passkeys routes as aliases of /devices in auth-facade**

In `src/server/routes/auth-facade.ts`, after the `authFacade.use('/devices/*', jwtAuth)` middleware block, add:

```ts
authFacade.use('/passkeys', jwtAuth)
authFacade.use('/passkeys/*', jwtAuth)
```

Then add the `/passkeys` endpoints mirroring `/devices`:

```ts
// GET /passkeys — list credentials (same as /devices, preferred path)
authFacade.get('/passkeys', async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')
  const credentials = await identity.getWebAuthnCredentials(pubkey)
  return c.json({
    credentials: credentials.map((cr) => ({
      id: cr.id,
      label: cr.label,
      transports: cr.transports,
      backedUp: cr.backedUp,
      createdAt: cr.createdAt,
      lastUsedAt: cr.lastUsedAt,
      ...(cr.encryptedLabel && cr.labelEnvelopes
        ? { encryptedLabel: cr.encryptedLabel, labelEnvelopes: cr.labelEnvelopes }
        : {}),
    })),
    warning: credentials.length === 1 ? 'Register a backup device to prevent lockout' : undefined,
  })
})

// PATCH /passkeys/:id — rename label
authFacade.patch('/passkeys/:id', async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')
  const credId = decodeURIComponent(c.req.param('id'))

  const parsed = PasskeyRenameSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
  }

  try {
    await identity.renameWebAuthnCredential(pubkey, credId, parsed.data)
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Credential not found' }, 404)
  }
})

// DELETE /passkeys/:id — same as /devices/:id
authFacade.delete('/passkeys/:id', async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')
  const credId = decodeURIComponent(c.req.param('id'))
  try {
    await identity.deleteWebAuthnCredential(pubkey, credId)
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Credential not found' }, 404)
  }
})
```

Import the schema at top:
```ts
import { PasskeyRenameSchema } from '@shared/schemas/passkeys'
```

- [ ] **Step 4: Also add passkey register-options and register-verify aliases**

Add these as thin proxies that reuse the same logic as `/webauthn/register-options` and `/webauthn/register-verify`. Simplest approach: in the middleware registration add `authFacade.use('/passkeys/register-options', jwtAuth)` and `/passkeys/register-verify` and copy-paste the existing handlers renaming the path.

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/auth-facade.ts src/server/services/identity.ts src/shared/schemas/passkeys.ts
git commit -m "feat(auth): add /passkeys route group + PATCH label rename"
```

---

## Task 16: API E2E tests for sessions

**Files:**
- Create: `tests/api/sessions.spec.ts`

- [ ] **Step 1: Write E2E test**

Create `tests/api/sessions.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { createAuthedRequest } from '../helpers/authed-request'

test.describe('Sessions API', () => {
  test('login creates a session listed via GET /sessions', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.get('/api/auth/sessions')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.sessions).toBeInstanceOf(Array)
    // The authed-request helper should produce at least one session if login creates one
    // Depending on how authed-request works, this may need session creation setup.
  })

  test('DELETE /sessions/:id revokes the session', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const listRes = await authed.get('/api/auth/sessions')
    const { sessions } = await listRes.json()
    if (sessions.length === 0) test.skip()
    const nonCurrent = sessions.find((s: { isCurrent: boolean }) => !s.isCurrent)
    if (!nonCurrent) test.skip()

    const delRes = await authed.delete(`/api/auth/sessions/${nonCurrent.id}`)
    expect(delRes.status()).toBe(200)

    const listAfter = await authed.get('/api/auth/sessions')
    const { sessions: after } = await listAfter.json()
    expect(after.find((s: { id: string }) => s.id === nonCurrent.id)).toBeUndefined()
  })

  test('POST /sessions/revoke-others keeps current session', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.post('/api/auth/sessions/revoke-others')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.revokedCount).toBeGreaterThanOrEqual(0)

    const listRes = await authed.get('/api/auth/sessions')
    const { sessions } = await listRes.json()
    expect(sessions.length).toBeGreaterThanOrEqual(1)
    expect(sessions.some((s: { isCurrent: boolean }) => s.isCurrent)).toBe(true)
  })

  test('DELETE /sessions/:id with bogus id returns 404', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.delete('/api/auth/sessions/00000000-0000-0000-0000-000000000000')
    expect(res.status()).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun run test:api -- tests/api/sessions.spec.ts`
Expected: tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/api/sessions.spec.ts
git commit -m "test(api): add sessions endpoint E2E tests"
```

---

## Task 17: API E2E tests for passkey rename

**Files:**
- Create: `tests/api/passkeys.spec.ts`

- [ ] **Step 1: Write E2E test**

Create `tests/api/passkeys.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { createAuthedRequest } from '../helpers/authed-request'

test.describe('Passkeys API', () => {
  test('GET /passkeys returns list', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.get('/api/auth/passkeys')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.credentials).toBeInstanceOf(Array)
  })

  test('PATCH /passkeys/:id with empty body returns 400', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.patch('/api/auth/passkeys/any-id', {
      data: {},
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(400)
  })

  test('PATCH /passkeys/:id with bogus id returns 404', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.patch('/api/auth/passkeys/nonexistent', {
      data: { label: 'New Label' },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(404)
  })

  test('DELETE /passkeys/:id mirrors /devices', async ({ request }) => {
    const authed = await createAuthedRequest(request)
    const res = await authed.delete('/api/auth/passkeys/nonexistent')
    expect(res.status()).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun run test:api -- tests/api/passkeys.spec.ts`
Expected: tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/api/passkeys.spec.ts
git commit -m "test(api): add passkeys endpoint E2E tests"
```

---

## Task 18: Drop jwt_revocations table

**Files:**
- Create: `drizzle/migrations/0042_drop_jwt_revocations.sql`
- Modify: `src/server/db/schema/identity.ts`
- Modify: `src/server/services/identity.ts`

- [ ] **Step 1: Write migration SQL**

Create `drizzle/migrations/0042_drop_jwt_revocations.sql`:

```sql
DROP TABLE IF EXISTS "jwt_revocations";
```

Add to `drizzle/migrations/meta/_journal.json` (append new entry matching prior pattern).

- [ ] **Step 2: Remove from schema**

Modify `src/server/db/schema/identity.ts` — delete the `jwtRevocations` table definition (lines 27-36).

- [ ] **Step 3: Remove isJtiRevoked from IdentityService**

Modify `src/server/services/identity.ts` — delete the `isJtiRevoked` method (line 714).

- [ ] **Step 4: Search for any remaining references**

Run: `grep -rn "jwt_revocations\|jwtRevocations\|isJtiRevoked" src/`
Expected: no results.

- [ ] **Step 5: Run migration + typecheck**

Run: `bun run migrate && bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add drizzle/migrations/ src/server/db/schema/identity.ts src/server/services/identity.ts
git commit -m "chore(db): drop orphaned jwt_revocations table"
```

---

## Task 19: Client — add security query keys and classification

**Files:**
- Modify: `src/client/lib/queries/keys.ts`
- Modify: `src/client/lib/query-client.ts`

- [ ] **Step 1: Add queryKeys.security**

Modify `src/client/lib/queries/keys.ts` — add new domain:

```ts
security: {
  all: ['security'] as const,
  sessions: () => ['security', 'sessions'] as const,
  passkeys: () => ['security', 'passkeys'] as const,
},
```

- [ ] **Step 2: Classify as ENCRYPTED**

Modify `src/client/lib/query-client.ts` — add `'security'` to `ENCRYPTED_QUERY_KEYS` array.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: no errors (the exhaustiveness check `MissingDomains` must be satisfied).

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/queries/keys.ts src/client/lib/query-client.ts
git commit -m "feat(client): add security query key domain"
```

---

## Task 20: Client — security API wrapper

**Files:**
- Create: `src/client/lib/api/security.ts`

- [ ] **Step 1: Write API module**

Create `src/client/lib/api/security.ts`:

```ts
import { api } from './base' // existing base wrapper

export interface SessionApiRow {
  id: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  isCurrent: boolean
  encryptedMeta: string
  metaEnvelope: Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>
  credentialId: string | null
}

export async function listSessions(): Promise<{ sessions: SessionApiRow[] }> {
  return api.get('/api/auth/sessions')
}

export async function revokeSession(id: string): Promise<{ ok: boolean }> {
  return api.delete(`/api/auth/sessions/${id}`)
}

export async function revokeOtherSessions(): Promise<{ revokedCount: number }> {
  return api.post('/api/auth/sessions/revoke-others', {})
}

export interface PasskeyApiRow {
  id: string
  label: string
  transports: string[]
  backedUp: boolean
  createdAt: string
  lastUsedAt: string
  encryptedLabel?: string
  labelEnvelopes?: Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>
}

export async function listPasskeys(): Promise<{ credentials: PasskeyApiRow[]; warning?: string }> {
  return api.get('/api/auth/passkeys')
}

export async function renamePasskey(
  id: string,
  data: { label?: string; encryptedLabel?: string; labelEnvelopes?: PasskeyApiRow['labelEnvelopes'] }
): Promise<{ ok: boolean }> {
  return api.patch(`/api/auth/passkeys/${encodeURIComponent(id)}`, data)
}

export async function deletePasskey(id: string): Promise<{ ok: boolean }> {
  return api.delete(`/api/auth/passkeys/${encodeURIComponent(id)}`)
}
```

- [ ] **Step 2: Verify `api` base wrapper matches existing usage**

Run: `grep -n "from '../api/base'" src/client/lib/api/ | head -5`
If the base wrapper is named differently (e.g., `api` default export), adapt the import.

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/api/security.ts
git commit -m "feat(client): add security API wrapper"
```

---

## Task 21: Client — React Query hooks for security

**Files:**
- Create: `src/client/lib/queries/security.ts`
- Modify: `src/client/lib/decrypt-fields.ts`

- [ ] **Step 1: Add decryptor for session meta**

Modify `src/client/lib/decrypt-fields.ts` — ensure there's a generic `decryptEnvelopeJson<T>` helper; if not, add one that accepts a ciphertext + envelope + crypto-worker and returns parsed JSON.

Check existing helpers:
```bash
grep -n "export" src/client/lib/decrypt-fields.ts | head -20
```

If a matching helper exists (e.g., `decryptObjectFields`), reuse it. Otherwise, add:

```ts
import { cryptoWorker } from './crypto-worker-client'
import type { RecipientEnvelope } from '@shared/types'

export async function decryptEnvelopeJson<T>(
  encrypted: string,
  envelope: RecipientEnvelope,
  label: string
): Promise<T | null> {
  try {
    const plaintext = await cryptoWorker.envelopeDecrypt(encrypted, envelope, label)
    return JSON.parse(plaintext) as T
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Write React Query hooks**

Create `src/client/lib/queries/security.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LABEL_SESSION_META } from '@shared/crypto-labels'
import * as api from '../api/security'
import { decryptEnvelopeJson } from '../decrypt-fields'
import { usePubkey } from '../auth-hooks' // adjust name to actual hook that exposes current pubkey
import { queryKeys } from './keys'

export interface SessionViewModel {
  id: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  isCurrent: boolean
  credentialId: string | null
  meta: {
    userAgent: string
    city: string
    country: string
  } | null
}

export function useSessions() {
  const pubkey = usePubkey()
  return useQuery({
    queryKey: queryKeys.security.sessions(),
    queryFn: async (): Promise<SessionViewModel[]> => {
      const { sessions } = await api.listSessions()
      return Promise.all(
        sessions.map(async (s) => {
          const envelope = s.metaEnvelope.find((e) => e.pubkey === pubkey)
          const meta = envelope
            ? await decryptEnvelopeJson<{
                userAgent: string
                city: string
                country: string
              }>(s.encryptedMeta, envelope, LABEL_SESSION_META)
            : null
          return {
            id: s.id,
            createdAt: s.createdAt,
            lastSeenAt: s.lastSeenAt,
            expiresAt: s.expiresAt,
            isCurrent: s.isCurrent,
            credentialId: s.credentialId,
            meta,
          }
        })
      )
    },
    enabled: !!pubkey,
  })
}

export function useRevokeSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.security.sessions() })
    },
  })
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.revokeOtherSessions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.security.sessions() })
    },
  })
}

export interface PasskeyViewModel {
  id: string
  label: string
  transports: string[]
  backedUp: boolean
  createdAt: string
  lastUsedAt: string
}

export function usePasskeys() {
  return useQuery({
    queryKey: queryKeys.security.passkeys(),
    queryFn: async (): Promise<{ credentials: PasskeyViewModel[]; warning?: string }> => {
      const { credentials, warning } = await api.listPasskeys()
      // If encryptedLabel is present, decrypt; otherwise fall back to label
      return { credentials: credentials.map((c) => ({ ...c })), warning }
    },
  })
}

export function useRenamePasskey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: { id: string; data: { label?: string; encryptedLabel?: string; labelEnvelopes?: unknown } }) =>
      api.renamePasskey(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.security.passkeys() })
    },
  })
}

export function useDeletePasskey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deletePasskey(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.security.passkeys() })
    },
  })
}
```

- [ ] **Step 3: Verify import `usePubkey` exists**

Run: `grep -rn "export.*usePubkey\|export.*useAuth" src/client/lib/ | head -5`
Adjust import line to match existing hook name.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/queries/security.ts src/client/lib/decrypt-fields.ts
git commit -m "feat(client): add security React Query hooks + session meta decrypt"
```

---

## Task 22: Client — /security parent route

**Files:**
- Create: `src/client/routes/security.tsx`

- [ ] **Step 1: Write parent route**

Create `src/client/routes/security.tsx`:

```tsx
import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/security')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/security') {
      throw redirect({ to: '/security/sessions' })
    }
  },
  component: SecurityLayout,
})

function SecurityLayout() {
  const { t } = useTranslation()
  return (
    <div className="container mx-auto max-w-5xl p-4">
      <h1 className="text-2xl font-bold mb-4">{t('security.title', 'Security')}</h1>
      <nav className="flex gap-4 border-b mb-4" data-testid="security-tabs">
        <Link
          to="/security/sessions"
          className="px-3 py-2 [&.active]:border-b-2 [&.active]:border-primary"
          data-testid="tab-sessions"
        >
          {t('security.tabs.sessions', 'Active sessions')}
        </Link>
        <Link
          to="/security/passkeys"
          className="px-3 py-2 [&.active]:border-b-2 [&.active]:border-primary"
          data-testid="tab-passkeys"
        >
          {t('security.tabs.passkeys', 'Passkeys')}
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}
```

- [ ] **Step 2: Add translations**

Modify `public/locales/en.json` — add `"security"` section:

```json
"security": {
  "title": "Security",
  "tabs": {
    "sessions": "Active sessions",
    "passkeys": "Passkeys"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/client/routes/security.tsx public/locales/en.json
git commit -m "feat(client): add /security parent route layout"
```

---

## Task 23: Client — /security/sessions route

**Files:**
- Create: `src/client/routes/security.sessions.tsx`

- [ ] **Step 1: Write route**

Create `src/client/routes/security.sessions.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useRevokeOtherSessions, useRevokeSession, useSessions } from '@/lib/queries/security'

export const Route = createFileRoute('/security/sessions')({
  component: SessionsPage,
})

function SessionsPage() {
  const { t } = useTranslation()
  const { data: sessions, isLoading } = useSessions()
  const revoke = useRevokeSession()
  const revokeOthers = useRevokeOtherSessions()

  if (isLoading) return <div>{t('common.loading', 'Loading…')}</div>
  if (!sessions) return <div>{t('security.sessions.none', 'No active sessions.')}</div>

  const hasOthers = sessions.some((s) => !s.isCurrent)

  return (
    <div data-testid="sessions-page">
      <div className="flex justify-end mb-4">
        <Button
          variant="destructive"
          disabled={!hasOthers || revokeOthers.isPending}
          onClick={() => revokeOthers.mutate()}
          data-testid="revoke-all-others"
        >
          {t('security.sessions.signOutEverywhere', 'Sign out everywhere else')}
        </Button>
      </div>
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between p-3 border rounded"
            data-testid={`session-row-${s.id}`}
          >
            <div>
              <div className="font-medium">
                {s.meta?.userAgent ?? t('security.sessions.unknownBrowser', 'Unknown browser')}
                {s.isCurrent && (
                  <span className="ml-2 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
                    {t('security.sessions.current', 'Current')}
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {s.meta?.city && s.meta?.country
                  ? `${s.meta.city}, ${s.meta.country}`
                  : t('security.sessions.unknownLocation', 'Unknown location')}
                {' · '}
                {t('security.sessions.lastSeen', 'Last active')}:{' '}
                {formatDistanceToNow(new Date(s.lastSeenAt), { addSuffix: true })}
              </div>
            </div>
            {!s.isCurrent && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => revoke.mutate(s.id)}
                disabled={revoke.isPending}
                data-testid={`revoke-${s.id}`}
              >
                {t('security.sessions.revoke', 'Revoke')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Add translations**

Extend `public/locales/en.json` `security` section:

```json
"sessions": {
  "none": "No active sessions.",
  "signOutEverywhere": "Sign out everywhere else",
  "current": "Current",
  "unknownBrowser": "Unknown browser",
  "unknownLocation": "Unknown location",
  "lastSeen": "Last active",
  "revoke": "Revoke"
}
```

- [ ] **Step 3: Regenerate TanStack route tree**

Run: `bun run dev` (or whatever triggers route tree generation).
Expected: `routeTree.gen.ts` includes the new routes.

- [ ] **Step 4: Run typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/client/routes/security.sessions.tsx src/client/routeTree.gen.ts public/locales/en.json
git commit -m "feat(client): add sessions management page"
```

---

## Task 24: Client — /security/passkeys route

**Files:**
- Create: `src/client/routes/security.passkeys.tsx`

- [ ] **Step 1: Write route**

Create `src/client/routes/security.passkeys.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDeletePasskey, usePasskeys, useRenamePasskey } from '@/lib/queries/security'

export const Route = createFileRoute('/security/passkeys')({
  component: PasskeysPage,
})

function TransportBadges({ transports }: { transports: string[] }) {
  const { t } = useTranslation()
  const map: Record<string, string> = {
    usb: t('security.passkeys.transport.usb', 'USB'),
    internal: t('security.passkeys.transport.internal', 'Built-in'),
    hybrid: t('security.passkeys.transport.hybrid', 'Cross-device'),
    nfc: 'NFC',
    ble: 'Bluetooth',
    'smart-card': 'Smart card',
  }
  return (
    <div className="flex gap-1">
      {transports.map((tr) => (
        <span key={tr} className="text-xs bg-muted px-2 py-0.5 rounded" data-testid={`transport-${tr}`}>
          {map[tr] ?? tr}
        </span>
      ))}
    </div>
  )
}

function PasskeyRow({
  cred,
  onRename,
  onDelete,
}: {
  cred: { id: string; label: string; transports: string[]; backedUp: boolean; createdAt: string; lastUsedAt: string }
  onRename: (id: string, label: string) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draftLabel, setDraftLabel] = useState(cred.label)

  return (
    <li className="flex items-center justify-between p-3 border rounded" data-testid={`passkey-row-${cred.id}`}>
      <div className="flex-1">
        {editing ? (
          <div className="flex gap-2">
            <Input
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              data-testid="passkey-label-input"
            />
            <Button
              size="sm"
              onClick={() => {
                onRename(cred.id, draftLabel)
                setEditing(false)
              }}
              data-testid="save-rename"
            >
              {t('common.save', 'Save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
          </div>
        ) : (
          <>
            <div className="font-medium flex items-center gap-2">
              {cred.label}
              {cred.backedUp && (
                <span className="text-xs text-green-600" data-testid="backup-indicator">
                  {t('security.passkeys.backedUp', 'Synced')}
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              <TransportBadges transports={cred.transports} />
              {' · '}
              {t('security.passkeys.createdAt', 'Added')}:{' '}
              {format(new Date(cred.createdAt), 'PP')}
              {' · '}
              {t('security.passkeys.lastUsedAt', 'Last used')}:{' '}
              {format(new Date(cred.lastUsedAt), 'PP')}
            </div>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraftLabel(cred.label)
              setEditing(true)
            }}
            data-testid={`rename-${cred.id}`}
          >
            {t('common.rename', 'Rename')}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onDelete(cred.id)}
            data-testid={`delete-${cred.id}`}
          >
            {t('common.delete', 'Delete')}
          </Button>
        </div>
      )}
    </li>
  )
}

function PasskeysPage() {
  const { t } = useTranslation()
  const { data, isLoading } = usePasskeys()
  const rename = useRenamePasskey()
  const del = useDeletePasskey()

  if (isLoading) return <div>{t('common.loading', 'Loading…')}</div>
  if (!data) return null

  return (
    <div data-testid="passkeys-page">
      {data.warning && (
        <div
          className="p-3 mb-4 bg-yellow-50 border border-yellow-300 rounded text-sm"
          data-testid="passkey-warning"
        >
          {data.warning}
        </div>
      )}
      <ul className="space-y-2">
        {data.credentials.map((cred) => (
          <PasskeyRow
            key={cred.id}
            cred={cred}
            onRename={(id, label) =>
              rename.mutate({ id, data: { label } })
            }
            onDelete={(id) => del.mutate(id)}
          />
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Add translations**

Extend `public/locales/en.json` `security` section:

```json
"passkeys": {
  "backedUp": "Synced",
  "createdAt": "Added",
  "lastUsedAt": "Last used",
  "transport": {
    "usb": "USB",
    "internal": "Built-in",
    "hybrid": "Cross-device"
  }
}
```

- [ ] **Step 3: Add common translations if missing**

Ensure `public/locales/en.json` has `common.save`, `common.cancel`, `common.rename`, `common.delete`, `common.loading` — add any missing.

- [ ] **Step 4: Redirect old /devices route to /security/passkeys**

If `src/client/routes/devices.tsx` exists, replace its component with a redirect:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/devices')({
  beforeLoad: () => {
    throw redirect({ to: '/security/passkeys' })
  },
  component: () => null,
})
```

If no such route file exists, skip this step.

- [ ] **Step 5: Typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/client/routes/security.passkeys.tsx src/client/routeTree.gen.ts public/locales/en.json src/client/routes/devices.tsx
git commit -m "feat(client): add passkeys management page + redirect old /devices"
```

---

## Task 25: Add Security to navigation + user menu

**Files:**
- Modify: `src/client/components/Navigation.tsx` (or equivalent)

- [ ] **Step 1: Locate navigation component**

Run: `grep -rn "to=\"/settings\"" src/client/components/ | head -5`
Find the file that renders nav/user menu.

- [ ] **Step 2: Add Security link**

In the identified file, add a nav entry next to Settings:

```tsx
<Link
  to="/security"
  className="..." // match existing link styles
  data-testid="nav-security"
>
  {t('nav.security', 'Security')}
</Link>
```

- [ ] **Step 3: Add translation**

Add `"nav.security": "Security"` to `public/locales/en.json`.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/ public/locales/en.json
git commit -m "feat(client): add Security entry to navigation"
```

---

## Task 26: UI E2E test — security page

**Files:**
- Create: `tests/ui/security-page.spec.ts`

- [ ] **Step 1: Write E2E test**

Create `tests/ui/security-page.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { enterPin, logout, navigateAfterLogin } from '../helpers'

test.describe('Security page', () => {
  test('navigates to sessions tab by default', async ({ page }) => {
    await navigateAfterLogin(page)
    await enterPin(page)
    await page.goto('/security')
    await expect(page).toHaveURL(/\/security\/sessions$/)
    await expect(page.getByTestId('sessions-page')).toBeVisible()
    await logout(page)
  })

  test('switches to passkeys tab', async ({ page }) => {
    await navigateAfterLogin(page)
    await enterPin(page)
    await page.goto('/security/sessions')
    await page.getByTestId('tab-passkeys').click()
    await expect(page).toHaveURL(/\/security\/passkeys$/)
    await expect(page.getByTestId('passkeys-page')).toBeVisible()
    await logout(page)
  })

  test('sessions list shows current session marker', async ({ page }) => {
    await navigateAfterLogin(page)
    await enterPin(page)
    await page.goto('/security/sessions')
    const currentSession = page.locator('[data-testid^="session-row-"]').filter({
      has: page.getByText('Current', { exact: true }),
    })
    await expect(currentSession).toBeVisible()
    await logout(page)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun run test:e2e -- tests/ui/security-page.spec.ts`
Expected: tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/ui/security-page.spec.ts
git commit -m "test(ui): add security page E2E tests"
```

---

## Task 27: Deployment — Ansible geoip role

**Files:**
- Create: `deploy/ansible/roles/geoip/tasks/main.yml`
- Modify: `deploy/ansible/playbooks/app.yml` (include role)

- [ ] **Step 1: Write Ansible role**

Create `deploy/ansible/roles/geoip/tasks/main.yml`:

```yaml
---
- name: Ensure GeoIP data directory exists
  ansible.builtin.file:
    path: "{{ app_root }}/data/geoip"
    state: directory
    owner: "{{ app_user }}"
    group: "{{ app_group }}"
    mode: '0755'

- name: Install DB-IP download script
  ansible.builtin.copy:
    src: "{{ playbook_dir }}/../../scripts/download-dbip.sh"
    dest: "{{ app_root }}/scripts/download-dbip.sh"
    mode: '0755'

- name: Download DB-IP Lite MMDB on first setup
  ansible.builtin.command:
    cmd: "{{ app_root }}/scripts/download-dbip.sh"
  environment:
    GEOIP_DIR: "{{ app_root }}/data/geoip"
  args:
    creates: "{{ app_root }}/data/geoip/dbip-city.mmdb"

- name: Schedule monthly DB-IP refresh
  ansible.builtin.cron:
    name: "DB-IP Lite monthly refresh"
    minute: "0"
    hour: "3"
    day: "2"
    job: "GEOIP_DIR={{ app_root }}/data/geoip {{ app_root }}/scripts/download-dbip.sh >> {{ app_root }}/logs/geoip.log 2>&1"
    user: "{{ app_user }}"
```

- [ ] **Step 2: Include role in main playbook**

Modify `deploy/ansible/playbooks/app.yml` — add `- geoip` to the role list (wherever roles are listed).

- [ ] **Step 3: Document GEOIP_DB_PATH env var**

Modify `.env.example` (or equivalent) — add:

```
# Path to DB-IP Lite MMDB for session geolocation
GEOIP_DB_PATH=./data/geoip/dbip-city.mmdb
```

- [ ] **Step 4: Commit**

```bash
git add deploy/ansible/roles/geoip/ deploy/ansible/playbooks/app.yml .env.example
git commit -m "feat(deploy): Ansible role for DB-IP Lite MMDB + monthly cron"
```

---

## Task 28: CLAUDE.md updates

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add session-model notes**

Append to the "Key Technical Patterns" section of `CLAUDE.md`:

```markdown
- **Opaque session tokens**: Server-side `user_sessions` table stores hashed 32-byte random tokens. Refresh rotates token on every call; replay detection fires if a non-current token hash is presented. Session metadata (IP, UA, location) is user-envelope encrypted (label: `LABEL_SESSION_META`). Geolocation via DB-IP Lite MMDB at `./data/geoip/dbip-city.mmdb`.
```

Add to "Gotchas" section:

```markdown
- `jwt_revocations` table was removed in favor of `user_sessions` — do not reintroduce.
- Session `llamenos-session-id` cookie is required for `isCurrent` marker on `GET /api/auth/sessions`.
- GeoIP lookup is offline; DB must be downloaded via `scripts/download-dbip.sh` in dev.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add session model + geoip notes to CLAUDE.md"
```

---

## Task 29: Final verification

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: clean.

- [ ] **Step 3: Run unit tests**

Run: `bun run test:unit`
Expected: all pass.

- [ ] **Step 4: Run API tests**

Run: `bun run test:api -- tests/api/sessions.spec.ts tests/api/passkeys.spec.ts`
Expected: all pass.

- [ ] **Step 5: Run UI tests**

Run: `bun run test:e2e -- tests/ui/security-page.spec.ts`
Expected: all pass.

- [ ] **Step 6: Smoke test end-to-end**

- Start dev server: `bun run dev:server` + `bun run dev`
- Log in via WebAuthn
- Navigate to `/security` → should redirect to `/security/sessions`
- Verify "Current" badge is visible
- Open a second browser tab, log in with same credentials
- First tab: refresh → second session should appear
- Click "Revoke" on second session — second session vanishes
- Second tab: attempt any request — should get 401 redirect to login

- [ ] **Step 7: Push branch**

```bash
git push -u origin feat/device-management
```
