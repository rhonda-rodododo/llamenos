import { beforeAll, describe, expect, test } from 'bun:test'
import { generateKeyPair } from '@shared/crypto-primitives'
import type { BackupFile } from './backup'
import {
  createBackup,
  generateRecoveryKey,
  readBackupFile,
  restoreFromBackupWithPin,
  restoreFromBackupWithRecoveryKey,
} from './backup'

// PBKDF2 at 600k iterations is slow — create ONE backup and reuse across all tests
const TEST_PIN = '123456'
let testNsec: string
let testPubkey: string
let testRecoveryKey: string
let sharedBackup: BackupFile
let secondBackup: BackupFile

beforeAll(async () => {
  const kp = generateKeyPair()
  // Use the bech32 nsec as the backup plaintext (that's what key-manager stores)
  testNsec = kp.nsec
  testPubkey = kp.publicKey
  testRecoveryKey = generateRecoveryKey()

  sharedBackup = await createBackup(testNsec, TEST_PIN, testPubkey, testRecoveryKey)
  // Second backup for salt uniqueness test
  secondBackup = await createBackup(testNsec, TEST_PIN, testPubkey, testRecoveryKey)
}, 30000)

// ---------------------------------------------------------------------------
// B1: generateRecoveryKey
// ---------------------------------------------------------------------------
// Implementation encodes 16 bytes (128 bits) as Base32 = ceil(128/5) = 26 chars
// grouped into 4-char chunks: 6 full groups + 1 partial = 7 groups, 6 dashes
// Total chars: 26 chars + 6 dashes = 32 chars
describe('generateRecoveryKey', () => {
  test('format: groups of up to 4 Base32 chars separated by dashes', () => {
    const key = generateRecoveryKey()
    // Each group is 1–4 uppercase Base32 chars, separated by dashes
    expect(key).toMatch(/^[A-Z2-7]{1,4}(-[A-Z2-7]{1,4})*$/)
  })

  test('string length = 32 chars (26 Base32 + 6 dashes for 128-bit key)', () => {
    const key = generateRecoveryKey()
    // 16 bytes → 26 Base32 chars → 7 groups of 4 (last has 2) + 6 dashes = 32
    expect(key.length).toBe(32)
  })

  test('two calls produce different strings', () => {
    const key1 = generateRecoveryKey()
    const key2 = generateRecoveryKey()
    expect(key1).not.toBe(key2)
  })

  test('only valid Base32 chars (A-Z, 2-7) plus dashes', () => {
    const key = generateRecoveryKey()
    // Remove dashes, every char should be in Base32 alphabet
    const withoutDashes = key.replace(/-/g, '')
    expect(withoutDashes).toMatch(/^[A-Z2-7]+$/)
  })
})

// ---------------------------------------------------------------------------
// B2: createBackup structure
// ---------------------------------------------------------------------------
describe('createBackup structure', () => {
  test('backup.v === 1', () => {
    expect(sharedBackup.v).toBe(1)
  })

  test('both d and r blocks present', () => {
    expect(sharedBackup.d).toBeDefined()
    expect(sharedBackup.r).toBeDefined()
  })

  test('PIN block iterations = 600000', () => {
    expect(sharedBackup.d.i).toBe(600_000)
  })

  test('recovery block iterations = 100000', () => {
    expect(sharedBackup.r?.i).toBe(100_000)
  })

  test('backup.id is 6 hex chars', () => {
    expect(sharedBackup.id).toMatch(/^[0-9a-f]{6}$/)
  })

  test('backup.t % 3600 === 0 (rounded to hour)', () => {
    expect(sharedBackup.t % 3600).toBe(0)
  })

  test('two calls produce different salts', () => {
    expect(sharedBackup.d.s).not.toBe(secondBackup.d.s)
  })
})

// ---------------------------------------------------------------------------
// B3: restoreFromBackupWithPin
// ---------------------------------------------------------------------------
describe('restoreFromBackupWithPin', () => {
  test('correct PIN → original nsec', async () => {
    const result = await restoreFromBackupWithPin(sharedBackup, TEST_PIN)
    expect(result).toBe(testNsec)
  }, 10000)

  test('wrong PIN → null', async () => {
    const result = await restoreFromBackupWithPin(sharedBackup, '999999')
    expect(result).toBeNull()
  }, 10000)

  test('corrupted ciphertext → null', async () => {
    const corrupted: BackupFile = {
      ...sharedBackup,
      d: {
        ...sharedBackup.d,
        c: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      },
    }
    const result = await restoreFromBackupWithPin(corrupted, TEST_PIN)
    expect(result).toBeNull()
  }, 10000)
})

// ---------------------------------------------------------------------------
// B4: restoreFromBackupWithRecoveryKey
// ---------------------------------------------------------------------------
describe('restoreFromBackupWithRecoveryKey', () => {
  test('correct recovery key → original nsec', async () => {
    const result = await restoreFromBackupWithRecoveryKey(sharedBackup, testRecoveryKey)
    expect(result).toBe(testNsec)
  }, 10000)

  test('wrong recovery key → null', async () => {
    const wrongKey = generateRecoveryKey()
    const result = await restoreFromBackupWithRecoveryKey(sharedBackup, wrongKey)
    expect(result).toBeNull()
  }, 10000)

  test('missing r block → null', async () => {
    const noRecovery: BackupFile = {
      v: sharedBackup.v,
      id: sharedBackup.id,
      t: sharedBackup.t,
      d: sharedBackup.d,
      // r omitted intentionally
    }
    const result = await restoreFromBackupWithRecoveryKey(noRecovery, testRecoveryKey)
    expect(result).toBeNull()
  }, 10000)
})

// ---------------------------------------------------------------------------
// B5: readBackupFile
// ---------------------------------------------------------------------------
describe('readBackupFile', () => {
  function makeFile(content: string): File {
    return new File([content], 'backup.json', { type: 'application/json' })
  }

  test('valid backup JSON → BackupFile', async () => {
    const content = JSON.stringify(sharedBackup)
    const file = makeFile(content)
    const result = await readBackupFile(file)
    expect(result).not.toBeNull()
    expect(result?.v).toBe(1)
    expect(result?.d).toBeDefined()
  })

  test('missing v → null', async () => {
    const { v: _v, ...noV } = sharedBackup
    const content = JSON.stringify(noV)
    const file = makeFile(content)
    const result = await readBackupFile(file)
    expect(result).toBeNull()
  })

  test('missing d → null', async () => {
    const { d: _d, ...noD } = sharedBackup
    const content = JSON.stringify(noD)
    const file = makeFile(content)
    const result = await readBackupFile(file)
    expect(result).toBeNull()
  })

  test('malformed JSON → null', async () => {
    const file = makeFile('{ this is not valid json }}}')
    const result = await readBackupFile(file)
    expect(result).toBeNull()
  })
})
