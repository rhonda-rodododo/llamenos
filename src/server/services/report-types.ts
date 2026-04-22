import type { Ciphertext } from '@shared/crypto-types'
import { and, eq, isNull } from 'drizzle-orm'
import type { CreateReportTypeInput, ReportType, UpdateReportTypeInput } from '../../shared/types'
import type { Database } from '../db'
import { reportTypes } from '../db/schema'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'
import type { SettingsService } from './settings'

export class ReportTypeService {
  constructor(
    private readonly db: Database,
    readonly _crypto: CryptoService,
    settings: SettingsService
  ) {
    this.#settings = settings
  }

  async listReportTypes(hubId: string): Promise<ReportType[]> {
    const rows = await this.db
      .select()
      .from(reportTypes)
      .where(eq(reportTypes.hubId, hubId))
      .orderBy(reportTypes.createdAt)
    // Client decrypts encryptedName/encryptedDescription with hub key
    return rows.map((r) => this.#rowToReportType(r))
  }

  async getReportType(hubId: string, id: string): Promise<ReportType | null> {
    const rows = await this.db
      .select()
      .from(reportTypes)
      .where(and(eq(reportTypes.id, id), eq(reportTypes.hubId, hubId)))
      .limit(1)
    if (!rows[0]) return null
    return this.#rowToReportType(rows[0])
  }

  async createReportType(hubId: string, data: CreateReportTypeInput): Promise<ReportType> {
    // Client-provided id is required for AAD binding: the client seals the
    // ciphertext with buildAad(label, id, fieldName) before POST. Accept it
    // verbatim so decrypt on refetch matches. Legacy callers that omit id
    // fall back to a server-generated UUID.
    const id = data.id ?? crypto.randomUUID()
    const now = new Date()

    // Client provides hub-key encrypted name/description
    const encryptedName = (data.encryptedName ?? data.name) as Ciphertext
    const encryptedDescription = (data.encryptedDescription ??
      data.description ??
      null) as Ciphertext | null

    // Wrap clear-default + insert in a transaction to prevent race where two
    // concurrent creates both set isDefault: true
    const row = await this.db.transaction(async (tx) => {
      if (data.isDefault) {
        await tx
          .update(reportTypes)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(
              eq(reportTypes.hubId, hubId),
              eq(reportTypes.isDefault, true),
              isNull(reportTypes.archivedAt)
            )
          )
      }

      const [inserted] = await tx
        .insert(reportTypes)
        .values({
          id,
          hubId,
          encryptedName,
          encryptedDescription,
          isDefault: data.isDefault ?? false,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      return inserted
    })

    return this.#rowToReportType(row)
  }

  async updateReportType(
    hubId: string,
    id: string,
    data: UpdateReportTypeInput
  ): Promise<ReportType> {
    const existing = await this.getReportType(hubId, id)
    if (!existing) throw new AppError(404, 'Report type not found')

    const now = new Date()

    // If setting as default, clear other defaults
    if (data.isDefault) {
      await this.db
        .update(reportTypes)
        .set({ isDefault: false, updatedAt: now })
        .where(
          and(
            eq(reportTypes.hubId, hubId),
            eq(reportTypes.isDefault, true),
            isNull(reportTypes.archivedAt)
          )
        )
    }

    // Client provides hub-key encrypted name/description; fall back to plaintext
    const encFields: Record<string, unknown> = {}
    if (data.encryptedName !== undefined) {
      encFields.encryptedName = data.encryptedName
    } else if (data.name !== undefined) {
      encFields.encryptedName = data.name as Ciphertext
    }
    if (data.encryptedDescription !== undefined) {
      encFields.encryptedDescription = data.encryptedDescription ?? null
    } else if (data.description !== undefined) {
      encFields.encryptedDescription = (data.description as Ciphertext) ?? null
    }

    const [row] = await this.db
      .update(reportTypes)
      .set({
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        ...encFields,
        updatedAt: now,
      })
      .where(and(eq(reportTypes.id, id), eq(reportTypes.hubId, hubId)))
      .returning()

    return this.#rowToReportType(row)
  }

  async archiveReportType(hubId: string, id: string): Promise<void> {
    const existing = await this.getReportType(hubId, id)
    if (!existing) throw new AppError(404, 'Report type not found')

    const now = new Date()
    await this.db
      .update(reportTypes)
      .set({
        archivedAt: now,
        // Can't be default if archived
        isDefault: false,
        updatedAt: now,
      })
      .where(and(eq(reportTypes.id, id), eq(reportTypes.hubId, hubId)))
  }

  async unarchiveReportType(hubId: string, id: string): Promise<ReportType> {
    const existing = await this.getReportType(hubId, id)
    if (!existing) throw new AppError(404, 'Report type not found')

    const now = new Date()
    const [row] = await this.db
      .update(reportTypes)
      .set({ archivedAt: null, updatedAt: now })
      .where(and(eq(reportTypes.id, id), eq(reportTypes.hubId, hubId)))
      .returning()

    return this.#rowToReportType(row)
  }

  async setDefaultReportType(hubId: string, id: string): Promise<ReportType> {
    const existing = await this.getReportType(hubId, id)
    if (!existing) throw new AppError(404, 'Report type not found')
    if (existing.archivedAt)
      throw new AppError(400, 'Cannot set an archived report type as default')

    const now = new Date()

    // Clear existing defaults for hub
    await this.db
      .update(reportTypes)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(reportTypes.hubId, hubId), eq(reportTypes.isDefault, true)))

    // Set this one as default
    const [row] = await this.db
      .update(reportTypes)
      .set({ isDefault: true, updatedAt: now })
      .where(and(eq(reportTypes.id, id), eq(reportTypes.hubId, hubId)))
      .returning()

    return this.#rowToReportType(row)
  }

  #rowToReportType(r: typeof reportTypes.$inferSelect): ReportType {
    return {
      id: r.id,
      hubId: r.hubId,
      name: '', // Client decrypts encryptedName with hub key
      description: undefined, // Client decrypts encryptedDescription with hub key
      encryptedName: r.encryptedName ?? undefined,
      encryptedDescription: r.encryptedDescription ?? undefined,
      isDefault: r.isDefault,
      archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }
  }

  async resetForTest(): Promise<void> {
    await this.db.delete(reportTypes)
  }
}
