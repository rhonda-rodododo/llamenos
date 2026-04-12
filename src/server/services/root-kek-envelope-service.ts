import {
  type RootKekEnvelope,
  type RootKekEnvelopeBundle,
  RootKekEnvelopeBundleSchema,
} from '@shared/schemas/root-kek-envelope'
import { eq } from 'drizzle-orm'
/**
 * Server-side CRUD for the per-user root KEK envelope bundle.
 *
 * Enforces:
 *   - bundle shape via RootKekEnvelopeBundleSchema (which includes min-2)
 *   - rootKeyId change on rotate
 */
import type { Database } from '../db'
import { userRootKekEnvelopes } from '../db/schema/opaque'

export class RootKekEnvelopeService {
  constructor(private readonly db: Database) {}

  async getBundle(userPubkey: string): Promise<RootKekEnvelopeBundle | null> {
    const rows = await this.db
      .select()
      .from(userRootKekEnvelopes)
      .where(eq(userRootKekEnvelopes.userPubkey, userPubkey))
    if (!rows.length) return null
    return RootKekEnvelopeBundleSchema.parse(rows[0]!.bundle)
  }

  async putBundle(bundle: RootKekEnvelopeBundle): Promise<void> {
    const parsed = RootKekEnvelopeBundleSchema.parse(bundle)
    await this.db
      .insert(userRootKekEnvelopes)
      .values({
        userPubkey: parsed.userId,
        bundle: parsed,
        rootKeyId: parsed.rootKeyId,
      })
      .onConflictDoUpdate({
        target: userRootKekEnvelopes.userPubkey,
        set: {
          bundle: parsed,
          rootKeyId: parsed.rootKeyId,
          updatedAt: new Date(),
        },
      })
  }

  async appendEnvelope(
    userPubkey: string,
    envelope: RootKekEnvelope
  ): Promise<RootKekEnvelopeBundle> {
    const bundle = await this.getBundle(userPubkey)
    if (!bundle) throw new Error('bundle missing')
    const envelopes = [
      ...bundle.envelopes.filter(
        (e) => !(e.factorType === envelope.factorType && e.factorId === envelope.factorId)
      ),
      envelope,
    ]
    const next: RootKekEnvelopeBundle = { ...bundle, envelopes }
    await this.putBundle(next)
    return next
  }

  async removeEnvelope(
    userPubkey: string,
    target: { factorType: RootKekEnvelope['factorType']; factorId: string }
  ): Promise<RootKekEnvelopeBundle> {
    const bundle = await this.getBundle(userPubkey)
    if (!bundle) throw new Error('bundle missing')
    const envelopes = bundle.envelopes.filter(
      (e) => !(e.factorType === target.factorType && e.factorId === target.factorId)
    )
    if (envelopes.length < 2) {
      throw new Error('min factor invariant: cannot drop below 2 envelopes')
    }
    const next: RootKekEnvelopeBundle = { ...bundle, envelopes }
    await this.putBundle(next)
    return next
  }

  async rotateBundle(rotated: RootKekEnvelopeBundle): Promise<void> {
    const existing = await this.getBundle(rotated.userId)
    if (existing && existing.rootKeyId === rotated.rootKeyId) {
      throw new Error('rotateBundle requires a new rootKeyId')
    }
    await this.putBundle(rotated)
  }
}
