import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
/**
 * Integration test for migration 0050_repair_user_security_prefs_column.sql.
 *
 * This migration is a no-op on fresh/CI DBs (the `IF EXISTS` guard hits and
 * nothing runs). The only environment where it does work is a drifted dev
 * DB that applied the pre-edit 0048 schema with `lock_delay_ms` before
 * PR #46 landed. CI therefore never exercises the real branch of the
 * migration — so without this test the repair could rot silently.
 *
 * We simulate the drifted state by creating a temp schema, running the
 * pre-drift DDL manually, executing the 0050 SQL against that schema,
 * and asserting the rename + default change took effect. Then we run it a
 * second time to pin idempotency.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import postgres from 'postgres'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'

const TEMP_SCHEMA = `test_migration_0050_${crypto.randomUUID().slice(0, 8).replace(/-/g, '')}`

let sql: ReturnType<typeof postgres>
let migrationSql: string

beforeAll(async () => {
  sql = postgres(TEST_DB_URL, { max: 1, prepare: false })
  migrationSql = await fs.readFile(
    path.resolve(import.meta.dir, '0050_repair_user_security_prefs_column.sql'),
    'utf-8'
  )
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${TEMP_SCHEMA}`)
})

afterAll(async () => {
  try {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${TEMP_SCHEMA} CASCADE`)
  } finally {
    await sql.end()
  }
})

async function createPreDriftTable(): Promise<void> {
  await sql.unsafe(`DROP TABLE IF EXISTS ${TEMP_SCHEMA}.user_security_prefs`)
  await sql.unsafe(`
    CREATE TABLE ${TEMP_SCHEMA}.user_security_prefs (
      user_pubkey TEXT PRIMARY KEY,
      lock_delay_ms INTEGER NOT NULL DEFAULT 30000,
      disappearing_timer_days INTEGER NOT NULL DEFAULT 1,
      digest_cadence TEXT NOT NULL DEFAULT 'weekly',
      alert_on_new_device BOOLEAN NOT NULL DEFAULT TRUE,
      alert_on_passkey_change BOOLEAN NOT NULL DEFAULT TRUE,
      alert_on_pin_change BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function createPostDriftTable(): Promise<void> {
  await sql.unsafe(`DROP TABLE IF EXISTS ${TEMP_SCHEMA}.user_security_prefs`)
  await sql.unsafe(`
    CREATE TABLE ${TEMP_SCHEMA}.user_security_prefs (
      user_pubkey TEXT PRIMARY KEY,
      auto_lock_ms INTEGER NOT NULL DEFAULT 900000,
      disappearing_timer_days INTEGER NOT NULL DEFAULT 1,
      digest_cadence TEXT NOT NULL DEFAULT 'weekly',
      alert_on_new_device BOOLEAN NOT NULL DEFAULT TRUE,
      alert_on_passkey_change BOOLEAN NOT NULL DEFAULT TRUE,
      alert_on_pin_change BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function getColumn(
  column: 'lock_delay_ms' | 'auto_lock_ms'
): Promise<{ exists: boolean; default: string | null }> {
  const rows = await sql<Array<{ column_default: string | null }>>`
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = ${TEMP_SCHEMA}
      AND table_name = 'user_security_prefs'
      AND column_name = ${column}
  `
  if (rows.length === 0) return { exists: false, default: null }
  return { exists: true, default: rows[0]?.column_default ?? null }
}

/**
 * Run the 0050 migration against the test schema. The file is written as
 * unqualified SQL (`user_security_prefs`) so we temporarily set
 * `search_path` on the session to point at the temp schema before running.
 */
async function runMigration(): Promise<void> {
  await sql.unsafe(`SET search_path TO ${TEMP_SCHEMA}`)
  try {
    await sql.unsafe(migrationSql)
  } finally {
    await sql.unsafe('RESET search_path')
  }
}

describe('migration 0050_repair_user_security_prefs_column', () => {
  test('renames lock_delay_ms → auto_lock_ms and updates default when column drift exists', async () => {
    await createPreDriftTable()

    const before = await getColumn('lock_delay_ms')
    expect(before.exists).toBe(true)
    expect(before.default).toContain('30000')

    await runMigration()

    const oldColumn = await getColumn('lock_delay_ms')
    const newColumn = await getColumn('auto_lock_ms')
    expect(oldColumn.exists).toBe(false)
    expect(newColumn.exists).toBe(true)
    expect(newColumn.default).toContain('900000')
  })

  test('is a no-op when the column has already been renamed (fresh/CI DB)', async () => {
    await createPostDriftTable()

    const before = await getColumn('auto_lock_ms')
    expect(before.exists).toBe(true)
    expect(before.default).toContain('900000')

    await runMigration()

    const stillNew = await getColumn('auto_lock_ms')
    const oldGone = await getColumn('lock_delay_ms')
    expect(stillNew.exists).toBe(true)
    expect(stillNew.default).toContain('900000')
    expect(oldGone.exists).toBe(false)
  })

  test('is idempotent — running twice on a drifted DB still lands on auto_lock_ms', async () => {
    await createPreDriftTable()
    await runMigration()
    await runMigration() // should no-op

    const oldColumn = await getColumn('lock_delay_ms')
    const newColumn = await getColumn('auto_lock_ms')
    expect(oldColumn.exists).toBe(false)
    expect(newColumn.exists).toBe(true)
    expect(newColumn.default).toContain('900000')
  })
})
