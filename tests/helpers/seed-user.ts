/**
 * Helper to seed a minimal user row in the DB for API tests.
 *
 * API tests using createAuthedRequest with a fresh secret key bypass the
 * normal user-creation flow (invite → bootstrap), so endpoints that query
 * the users table (kek-proof, pin/change, lockdown, recovery/rotate) need
 * the row to exist.
 */
import postgres from 'postgres'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'

export function openTestDb(): ReturnType<typeof postgres> {
  return postgres(TEST_DATABASE_URL, { max: 2 })
}

export async function seedUser(sql: ReturnType<typeof postgres>, pubkey: string): Promise<void> {
  await sql`
    INSERT INTO users (pubkey, encrypted_name, encrypted_phone)
    VALUES (${pubkey}, '', '')
    ON CONFLICT (pubkey) DO NOTHING
  `
}

export async function cleanupUser(sql: ReturnType<typeof postgres>, pubkey: string): Promise<void> {
  await sql`DELETE FROM users WHERE pubkey = ${pubkey}`
}
