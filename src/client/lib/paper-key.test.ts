import { describe, expect, test } from 'bun:test'
import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { pubkeyToHex } from './device-identity'
import {
  derivePaperKeyFromMnemonic,
  generatePaperRecoveryKey,
  recoverFromPaperKey,
} from './paper-key'

// Known-good 24-word mnemonic for deterministic tests
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'

describe('paper-key', () => {
  describe('generatePaperRecoveryKey', () => {
    test('produces a valid 24-word BIP39 mnemonic', async () => {
      const result = await generatePaperRecoveryKey()
      const words = result.mnemonic.split(' ')
      expect(words).toHaveLength(24)
      expect(validateMnemonic(result.mnemonic, wordlist)).toBe(true)
    })

    test('returns deviceId, signingPubkey, and encryptionPubkey', async () => {
      const result = await generatePaperRecoveryKey()
      expect(result.deviceId).toBeString()
      expect(result.deviceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
      expect(result.signingPubkey).toBeInstanceOf(Uint8Array)
      expect(result.signingPubkey).toHaveLength(32)
      expect(result.encryptionPubkey).toBeInstanceOf(Uint8Array)
      expect(result.encryptionPubkey).toHaveLength(32)
    })

    test('generated paper key and derived paper key produce matching pubkeys', async () => {
      const generated = await generatePaperRecoveryKey()
      const derived = await derivePaperKeyFromMnemonic(generated.mnemonic)

      expect(pubkeyToHex(derived.signing.publicKey)).toBe(pubkeyToHex(generated.signingPubkey))
      expect(pubkeyToHex(derived.encryption.publicKey)).toBe(
        pubkeyToHex(generated.encryptionPubkey)
      )
      expect(derived.deviceId).toBe(generated.deviceId)
    })
  })

  describe('derivePaperKeyFromMnemonic', () => {
    test('is deterministic — same mnemonic produces same pubkeys', async () => {
      const first = await derivePaperKeyFromMnemonic(TEST_MNEMONIC)
      const second = await derivePaperKeyFromMnemonic(TEST_MNEMONIC)

      expect(pubkeyToHex(first.signing.publicKey)).toBe(pubkeyToHex(second.signing.publicKey))
      expect(pubkeyToHex(first.encryption.publicKey)).toBe(pubkeyToHex(second.encryption.publicKey))
      expect(first.deviceId).toBe(second.deviceId)
    })

    test('produces deterministic deviceId from signing pubkey', async () => {
      const derived = await derivePaperKeyFromMnemonic(TEST_MNEMONIC)
      // deviceId should be a UUID-like hex string derived from sha256(signingPub)
      expect(derived.deviceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
      // Verify determinism: re-derive and check it matches
      const rederived = await derivePaperKeyFromMnemonic(TEST_MNEMONIC)
      expect(rederived.deviceId).toBe(derived.deviceId)
    })

    test('rejects invalid mnemonic', async () => {
      await expect(derivePaperKeyFromMnemonic('not a valid mnemonic phrase')).rejects.toThrow(
        'Invalid BIP39 mnemonic'
      )
    })

    test('returns non-extractable private keys', async () => {
      const derived = await derivePaperKeyFromMnemonic(TEST_MNEMONIC)
      expect(derived.signing.privateKey.extractable).toBe(false)
      expect(derived.encryption.privateKey.extractable).toBe(false)
    })

    test('signing key can sign and verify', async () => {
      const derived = await derivePaperKeyFromMnemonic(TEST_MNEMONIC)
      const message = new TextEncoder().encode('test message')

      const signature = await crypto.subtle.sign('Ed25519', derived.signing.privateKey, message)

      // Import public key for verification
      const verifyKey = await crypto.subtle.importKey(
        'raw',
        derived.signing.publicKey as BufferSource,
        { name: 'Ed25519' },
        true,
        ['verify']
      )
      const valid = await crypto.subtle.verify('Ed25519', verifyKey, signature, message)
      expect(valid).toBe(true)
    })
  })

  describe('recoverFromPaperKey', () => {
    test('creates new device and retire entries', async () => {
      const userId = '550e8400-e29b-41d4-a716-446655440000'
      const pukGeneration = 3

      const result = await recoverFromPaperKey({
        mnemonic: TEST_MNEMONIC,
        userId,
        pukGeneration,
      })

      // New device should not be a paper key
      expect(result.newDevice.isPaperKey).toBe(false)
      expect(result.newDevice.deviceId).toBeString()
      expect(result.newDevice.signing.publicKey).toHaveLength(32)
      expect(result.newDevice.encryption.publicKey).toHaveLength(32)

      // Paper key device ID should be deterministic
      const paperKey = await derivePaperKeyFromMnemonic(TEST_MNEMONIC)
      expect(result.paperKeyDeviceId).toBe(paperKey.deviceId)

      // Add entry
      expect(result.addEntry.type).toBe('tier3_device_add')
      expect(result.addEntry.userId).toBe(userId)
      expect(result.addEntry.newDeviceId).toBe(result.newDevice.deviceId)
      expect(result.addEntry.newDeviceSigningPubkey).toBe(
        pubkeyToHex(result.newDevice.signing.publicKey)
      )
      expect(result.addEntry.newDeviceEncryptionPubkey).toBe(
        pubkeyToHex(result.newDevice.encryption.publicKey)
      )
      expect(result.addEntry.signedByDeviceId).toBe(result.paperKeyDeviceId)
      expect(result.addEntry.pukGeneration).toBe(pukGeneration)

      // Remove entry
      expect(result.removeEntry.type).toBe('tier3_device_remove')
      expect(result.removeEntry.userId).toBe(userId)
      expect(result.removeEntry.removedDeviceId).toBe(result.paperKeyDeviceId)
      expect(result.removeEntry.removedSigningPubkey).toBe(pubkeyToHex(paperKey.signing.publicKey))
      expect(result.removeEntry.signedByDeviceId).toBe(result.newDevice.deviceId)
      expect(result.removeEntry.reason).toBe('user_revoked')
      expect(result.removeEntry.pukGeneration).toBe(pukGeneration)
    })

    test('new device is different from paper key device', async () => {
      const result = await recoverFromPaperKey({
        mnemonic: TEST_MNEMONIC,
        userId: '550e8400-e29b-41d4-a716-446655440000',
        pukGeneration: 1,
      })

      expect(result.newDevice.deviceId).not.toBe(result.paperKeyDeviceId)
      expect(pubkeyToHex(result.newDevice.signing.publicKey)).not.toBe(
        result.removeEntry.removedSigningPubkey
      )
    })
  })
})
