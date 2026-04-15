import type { DeviceKeypair } from '@shared/types'

const DB_NAME = 'llamenos-device'
const DB_VERSION = 1
const STORE_NAME = 'device-keypair'

export class MultipleDeviceKeypairsError extends Error {
  constructor(count: number) {
    super(`Expected 0 or 1 device keypair, found ${count}`)
    this.name = 'MultipleDeviceKeypairsError'
  }
}

// --- Storage backend interface ---

interface DeviceKeypairStorage {
  put(keypair: DeviceKeypair): Promise<void>
  getAll(): Promise<DeviceKeypair[]>
  clear(): Promise<void>
  /** Insert without clearing — test-only for corruption simulation */
  forceInsert(keypair: DeviceKeypair): Promise<void>
}

// --- IDB backend (production) ---

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'deviceId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

class IdbDeviceKeypairStorage implements DeviceKeypairStorage {
  async put(keypair: DeviceKeypair): Promise<void> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.clear()
      store.put(keypair)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    })
  }

  async getAll(): Promise<DeviceKeypair[]> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).getAll()
      req.onsuccess = () => {
        db.close()
        resolve(req.result as DeviceKeypair[])
      }
      req.onerror = () => {
        db.close()
        reject(req.error)
      }
    })
  }

  async clear(): Promise<void> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    })
  }

  async forceInsert(keypair: DeviceKeypair): Promise<void> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(keypair)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    })
  }
}

// --- In-memory backend (tests) ---

export class InMemoryDeviceKeypairStorage implements DeviceKeypairStorage {
  private store = new Map<string, DeviceKeypair>()

  async put(keypair: DeviceKeypair): Promise<void> {
    this.store.clear()
    this.store.set(keypair.deviceId, keypair)
  }

  async getAll(): Promise<DeviceKeypair[]> {
    return Array.from(this.store.values())
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  async forceInsert(keypair: DeviceKeypair): Promise<void> {
    this.store.set(keypair.deviceId, keypair)
  }
}

// --- High-level API ---

let storage: DeviceKeypairStorage = new IdbDeviceKeypairStorage()

/** Override the storage backend (for tests) */
export function setDeviceKeypairStorage(s: DeviceKeypairStorage): void {
  storage = s
}

/**
 * Store a device keypair. CryptoKey objects are preserved via structured
 * clone in IDB — they remain non-extractable after round-trip.
 */
export async function putDeviceKeypair(keypair: DeviceKeypair): Promise<void> {
  await storage.put(keypair)
}

/**
 * Load the device keypair. Returns null if no keypair exists.
 * Throws MultipleDeviceKeypairsError if the store is corrupted.
 */
export async function getDeviceKeypair(): Promise<DeviceKeypair | null> {
  const rows = await storage.getAll()
  if (rows.length === 0) return null
  if (rows.length > 1) throw new MultipleDeviceKeypairsError(rows.length)
  return rows[0]
}

/** Delete all keypairs from the store. */
export async function clearDeviceKeypairStore(): Promise<void> {
  await storage.clear()
}

/** Force-insert bypassing clear — test-only for corruption simulation. */
export async function forceInsertRawDeviceKeypair(keypair: DeviceKeypair): Promise<void> {
  await storage.forceInsert(keypair)
}
