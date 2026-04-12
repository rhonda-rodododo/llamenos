/**
 * Client-side IndexedDB schema for Tier 1 key-store-v3.
 *
 * One database, one store: `keyMaterial`. Only one blob lives here — the
 * current user's wrapped identity + hub keys. A second entry would mean
 * we've confused multi-device with multi-account; devices get their own
 * IDB (per origin) and accounts rotate by wiping this store.
 *
 * Schema version is bumped only when the blob shape changes. The KEK
 * algorithm (PBKDF2 iteration count, AES params) is stored inside each
 * blob so older blobs can still be decrypted with the same DB schema.
 */

import { type IDBPDatabase, openDB } from 'idb'
import type { StoredKeyBlob } from './key-store-v3-types.js'

export const IDB_NAME = 'llamenos-keystore-v3'
export const IDB_VERSION = 1
export const STORE_NAME = 'keyMaterial'
export const BLOB_KEY = 'current'

export interface KeyStoreSchema {
  [STORE_NAME]: {
    key: string
    value: StoredKeyBlob
  }
}

export async function openKeyStoreDb(): Promise<IDBPDatabase<KeyStoreSchema>> {
  return openDB<KeyStoreSchema>(IDB_NAME, IDB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    },
  })
}
