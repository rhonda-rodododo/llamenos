import { LABEL_IVR_AUDIO } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { and, eq } from 'drizzle-orm'
import { IVR_LANGUAGES } from '../../../shared/languages'
import type { Database } from '../../db'
import { ivrAudio, ivrLanguages } from '../../db/schema'
import type { CryptoService } from '../../lib/crypto-service'
import { AppError } from '../../lib/errors'
import type { IvrAudioEntry, IvrAudioMeta } from '../../types'

export async function getIvrLanguages(db: Database, hubId?: string): Promise<string[]> {
  const hId = hubId ?? 'global'
  const rows = await db.select().from(ivrLanguages).where(eq(ivrLanguages.hubId, hId)).limit(1)
  return (rows[0]?.languages as string[]) ?? [...IVR_LANGUAGES]
}

export async function updateIvrLanguages(
  db: Database,
  langs: string[],
  hubId?: string
): Promise<string[]> {
  const hId = hubId ?? 'global'
  const valid = langs.filter((code) => IVR_LANGUAGES.includes(code))
  if (valid.length === 0) throw new AppError(400, 'No valid IVR language codes provided')
  await db
    .insert(ivrLanguages)
    .values({ hubId: hId, languages: valid })
    .onConflictDoUpdate({
      target: ivrLanguages.hubId,
      set: { languages: valid },
    })
  return valid
}

export async function getIvrAudioList(db: Database, hubId?: string): Promise<IvrAudioMeta[]> {
  const hId = hubId ?? 'global'
  const rows = await db
    .select({
      promptType: ivrAudio.promptType,
      language: ivrAudio.language,
      mimeType: ivrAudio.mimeType,
    })
    .from(ivrAudio)
    .where(eq(ivrAudio.hubId, hId))
  return rows
}

export async function getIvrAudio(
  db: Database,
  cryptoService: CryptoService,
  promptType: string,
  language: string,
  hubId?: string
): Promise<IvrAudioEntry | null> {
  const hId = hubId ?? 'global'
  const rows = await db
    .select()
    .from(ivrAudio)
    .where(
      and(
        eq(ivrAudio.hubId, hId),
        eq(ivrAudio.promptType, promptType),
        eq(ivrAudio.language, language)
      )
    )
    .limit(1)
  if (!rows[0]) return null
  const audioData = await cryptoService.serverDecrypt(
    rows[0].encryptedAudioData as Ciphertext,
    LABEL_IVR_AUDIO
  )
  return {
    hubId: rows[0].hubId,
    promptType: rows[0].promptType,
    language: rows[0].language,
    audioData,
    mimeType: rows[0].mimeType,
  }
}

export async function upsertIvrAudio(
  db: Database,
  cryptoService: CryptoService,
  entry: IvrAudioEntry
): Promise<void> {
  const encryptedAudioData = await cryptoService.serverEncrypt(entry.audioData, LABEL_IVR_AUDIO)

  await db
    .insert(ivrAudio)
    .values({
      hubId: entry.hubId,
      promptType: entry.promptType,
      language: entry.language,
      mimeType: entry.mimeType,
      encryptedAudioData,
    })
    .onConflictDoUpdate({
      target: [ivrAudio.hubId, ivrAudio.promptType, ivrAudio.language],
      set: {
        encryptedAudioData,
        mimeType: entry.mimeType,
        createdAt: new Date(),
      },
    })
}

export async function deleteIvrAudio(
  db: Database,
  promptType: string,
  language: string,
  hubId?: string
): Promise<void> {
  const hId = hubId ?? 'global'
  await db
    .delete(ivrAudio)
    .where(
      and(
        eq(ivrAudio.hubId, hId),
        eq(ivrAudio.promptType, promptType),
        eq(ivrAudio.language, language)
      )
    )
}
