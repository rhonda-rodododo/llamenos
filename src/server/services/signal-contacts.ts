import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { eq } from 'drizzle-orm'
import type { Ciphertext } from '../../shared/crypto-types'
import type { RecipientEnvelope } from '../../shared/types'
import type { Database } from '../db'
import { type UserSignalContactRow, userSignalContacts } from '../db/schema/signal-contacts'

export { normalizeSignalIdentifier } from '../../shared/signal-identifier-normalize'

export function hashSignalIdentifier(normalized: string, secret: string): string {
  const mac = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(normalized))
  return bytesToHex(mac)
}

export function derivePerUserHmacKey(serverHmacSecret: string, userPubkey: string): string {
  const userKey = hmac(
    sha256,
    utf8ToBytes(serverHmacSecret),
    utf8ToBytes(`signal-contact:${userPubkey}`)
  )
  return bytesToHex(userKey)
}

export interface UpsertSignalContactInput {
  userPubkey: string
  identifierHash: string
  identifierCiphertext: Ciphertext
  identifierEnvelope: RecipientEnvelope[]
  identifierType: 'phone' | 'username'
}

export class SignalContactsService {
  constructor(
    private db: Database,
    private hmacSecret: string
  ) {}

  async upsert(input: UpsertSignalContactInput): Promise<UserSignalContactRow> {
    const now = new Date()
    const rows = await this.db
      .insert(userSignalContacts)
      .values({
        userPubkey: input.userPubkey,
        identifierHash: input.identifierHash,
        identifierCiphertext: input.identifierCiphertext,
        identifierEnvelope: input.identifierEnvelope,
        identifierType: input.identifierType,
        verifiedAt: now,
      })
      .onConflictDoUpdate({
        target: userSignalContacts.userPubkey,
        set: {
          identifierHash: input.identifierHash,
          identifierCiphertext: input.identifierCiphertext,
          identifierEnvelope: input.identifierEnvelope,
          identifierType: input.identifierType,
          updatedAt: now,
          verifiedAt: now,
        },
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('Failed to upsert signal contact')
    return row
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

  getPerUserHmacKey(userPubkey: string): string {
    return derivePerUserHmacKey(this.hmacSecret, userPubkey)
  }

  hashIdentifierForUser(normalized: string, userPubkey: string): string {
    const userKey = this.getPerUserHmacKey(userPubkey)
    return hashSignalIdentifier(normalized, userKey)
  }
}
