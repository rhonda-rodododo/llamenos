# HPKE Slice 5: File Crypto & Provisioning Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate file encryption and device provisioning from ECIES/secp256k1 to HPKE/X25519.

**Dependency:** Slice 1 (wire format types) + Slice 4 (worker envelope handlers). Slice 4 migrates `handleEncrypt`/`handleDecrypt` in the worker; Slice 5 builds on that for file crypto and adds `handleProvisionNsec` migration.

**Architecture:**
- **File encryption**: Shared symmetric ciphertext (XChaCha20-Poly1305) + per-recipient HPKE key-wrap for the file key. Metadata is HPKE-sealed directly (no intermediate symmetric layer).
- **Provisioning**: Replace secp256k1 ECDH with X25519 ECDH for the shared secret derivation. Keep XChaCha20-Poly1305 for the symmetric layer — Slice 7 handles the symmetric migration to AES-GCM.
- **SAS verification**: Derive the 6-digit code from the X25519 shared secret x-coordinate using the same HKDF formula.

**Key design decisions:**
1. **File metadata (`encryptMetadataForPubkey`)**: Use direct HPKE seal instead of raw secp256k1 ECDH + XChaCha20. The metadata JSON is small (<1KB), so direct seal is clean.
2. **File key wrapping (`encryptFile`)**: HPKE-seal the 32-byte file key per recipient (hybrid model). This preserves the existing `recipientEnvelopes` array structure.
3. **Provisioning curve switch**: secp256k1 → X25519. The `computeSharedX` function uses `crypto.subtle.deriveBits` with X25519 instead of `secp256k1.getSharedSecret`.
4. **Worker `handleProvisionNsec`**: Uses X25519 ECDH with the held `secretKey` (which is still a secp256k1 key for Nostr signing). Wait — the worker's `secretKey` is secp256k1. For X25519 ECDH, we need an X25519 keypair.
   - **Resolution:** The worker already has `hpkePrivateKey` (X25519) from `unlockWithHandles`. Use `hpkePrivateKey` for provisioning ECDH. Derive the X25519 public key from `hpkePrivateKey` for the provisioning payload.
   - If `unlock` (legacy path) was used instead of `unlockWithHandles`, `hpkePrivateKey` may be null. In that case, derive an ephemeral X25519 keypair for provisioning. This is acceptable because provisioning is a one-shot operation.
5. **Envelope shape**: All file envelopes now use `v: 3` with `enc`/`ct` instead of `wrappedKey`/`ephemeralPubkey`.

---

## Files to Modify

| # | File | Change Summary |
|---|------|----------------|
| 1 | `src/client/lib/file-crypto.ts` | Rewrite `encryptMetadataForPubkey` to HPKE direct seal. Rewrite `encryptFile` key wrapping to HPKE. Rewrite `decryptFile` key opening to HPKE. Rewrite `rewrapFileKey`. Remove secp256k1/xchacha20poly1305 imports. |
| 2 | `src/client/lib/file-upload.ts` | Update `decryptFileMetadata` call to pass HPKE envelope. Remove `@ts-expect-error Slice 5`. |
| 3 | `src/client/lib/file-crypto.test.ts` | Rewrite all ECIES test helpers to HPKE. Replace secp256k1 key generation with X25519 HPKE keypairs. Remove `@ts-expect-error Slice 5`. |
| 4 | `src/client/lib/provisioning.ts` | Replace secp256k1 with X25519. `computeSharedX` uses `crypto.subtle.deriveBits`. `createProvisioningRoom` generates X25519 keypair. `decryptProvisionedNsec` uses X25519 shared secret. `encryptNsecForDevice` uses X25519 shared secret. |
| 5 | `src/client/lib/crypto-worker.ts` `handleProvisionNsec` | Replace secp256k1 ECDH with X25519 ECDH using `hpkePrivateKey` or ephemeral X25519 keypair. |
| 6 | `src/client/lib/provisioning.test.ts` | Rewrite tests for X25519 instead of secp256k1. |
| 7 | `src/client/lib/crypto-service.ts` | If not deleted in Slice 4, update any file-crypto-related methods. |

---

## Cross-Slice Conflict Analysis

| File | Slices | Resolution |
|------|--------|------------|
| `src/client/lib/crypto-worker.ts` | Slice 4 (envelope handlers), Slice 5 (`handleProvisionNsec`) | **No conflict** — different handlers. Slice 4 lands first. |
| `src/client/lib/crypto-worker-client.ts` | Slice 4 (retype envelope methods), Slice 5 (`provisionNsec` may need retype) | **Sequential dependency** — if `provisionNsec` return shape changes, update after Slice 4. |
| `src/shared/crypto-primitives.ts` | Slice 5 (stop importing `eciesWrapKey`) | **No conflict** — just stop importing; file deleted in Slice 7. |
| `src/client/lib/file-crypto.ts` | Slice 5 (primary) | **No conflict with Slice 4 or 6** — orthogonal to PII and hub key paths. |
| `src/client/lib/provisioning.ts` | Slice 5 (primary) | **No conflict** — standalone module. |

---

## Task 1: Rewrite File Crypto to HPKE

**File:** `src/client/lib/file-crypto.ts`

### Step 1: Rewrite `encryptMetadataForPubkey` to HPKE direct seal

The old method used raw secp256k1 ECDH + XChaCha20. The new method uses HPKE single-shot seal.

```typescript
async function encryptMetadataForPubkey(
  metadata: EncryptedFileMetadata,
  recipientPubkeyHex: string
): Promise<EncryptedMetaItem> {
  const { createHpkeSuite } = await import('@shared/crypto-suite')
  const { asX25519EncryptionKey: asX25519 } = await import('@shared/types')
  const { hpkeSeal } = await import('@shared/hpke-primitives')
  const suite = createHpkeSuite()

  const recipientKey = asX25519(
    (await suite.kem.deserializePublicKey(hexToBytes(recipientPubkeyHex))) as CryptoKey
  )
  const plaintext = new TextEncoder().encode(JSON.stringify(metadata))
  const envelope = await hpkeSeal(plaintext, recipientKey, LABEL_FILE_METADATA, new Uint8Array(0))

  return {
    pubkey: recipientPubkeyHex,
    ...envelope,
  }
}
```

**Breaking change:** `EncryptedMetaItem` now extends `HpkeEnvelope` (already true since Slice 1). The old `encryptedContent` field is gone — the ciphertext is in `ct`.

### Step 2: Rewrite `encryptFile` key wrapping to HPKE

```typescript
// Wrap the file key for each recipient using HPKE seal
const recipientEnvelopes: FileKeyEnvelope[] = await Promise.all(
  recipientPubkeys.map(async (pubkey) => {
    const { createHpkeSuite } = await import('@shared/crypto-suite')
    const { asX25519EncryptionKey: asX25519 } = await import('@shared/types')
    const { hpkeSeal } = await import('@shared/hpke-primitives')
    const suite = createHpkeSuite()
    const recipientKey = asX25519(
      (await suite.kem.deserializePublicKey(hexToBytes(pubkey))) as CryptoKey
    )
    const envelope = await hpkeSeal(fileKey, recipientKey, LABEL_FILE_KEY, aad)
    return { pubkey, ...envelope }
  })
)
```

**Remove `@ts-expect-error Slice 5`.**

### Step 3: Rewrite `decryptFile` to HPKE open

```typescript
export async function decryptFile(
  encryptedContent: ArrayBuffer,
  envelope: Envelope,  // Now HpkeEnvelope
  fileId: string
): Promise<{ blob: Blob; checksum: string }> {
  const aad = buildFileAad(fileId)

  // Unwrap the file key via HPKE open
  const { hpkeOpen } = await import('@shared/hpke-primitives')
  const { createHpkeSuite } = await import('@shared/crypto-suite')
  const suite = createHpkeSuite()
  // Need the HPKE private key — delegate to worker
  const fileKey = await cryptoWorker.decrypt(envelope, LABEL_FILE_KEY, new Uint8Array(0))
    .then(hexToBytes)

  // ... rest unchanged
}
```

Wait — `cryptoWorker.decrypt` now takes an `HpkeEnvelope` (per Slice 4). But `decryptFile` is called from `file-upload.ts` where the worker is available. So this works.

However, `decryptEnvelope` in `crypto-worker-helpers.ts` was used for version checking. With HPKE, the version check is built into `hpkeOpen`. We may not need `decryptEnvelope` anymore.

Actually, looking at the code, `decryptFile` calls `decryptEnvelope` which checks `env.v !== 2`. Since the envelope is now v3, this check will fail unless updated. We should remove the `decryptEnvelope` call and use the worker's `decrypt` directly (which is `hpkeOpen` under the hood after Slice 4).

### Step 4: Rewrite `rewrapFileKey` to HPKE

```typescript
export async function rewrapFileKey(
  envelope: Envelope,
  newRecipientPubkeyHex: string
): Promise<FileKeyEnvelope> {
  // Unwrap file key via worker HPKE open
  const fileKey = await cryptoWorker.decrypt(envelope, LABEL_FILE_KEY, new Uint8Array(0))
    .then(hexToBytes)

  // Re-seal for new recipient
  const { createHpkeSuite } = await import('@shared/crypto-suite')
  const { asX25519EncryptionKey: asX25519 } = await import('@shared/types')
  const { hpkeSeal } = await import('@shared/hpke-primitives')
  const suite = createHpkeSuite()
  const recipientKey = asX25519(
    (await suite.kem.deserializePublicKey(hexToBytes(newRecipientPubkeyHex))) as CryptoKey
  )
  const newEnvelope = await hpkeSeal(fileKey, recipientKey, LABEL_FILE_KEY, new Uint8Array(0))
  fileKey.fill(0)

  return { pubkey: newRecipientPubkeyHex, ...newEnvelope }
}
```

### Step 5: Remove ECIES imports

Remove:
- `import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'` (only needed for symmetric encrypt of file content — but wait, `symmetricEncrypt` from `@shared/crypto-primitives` is used for file content, not raw xchacha20poly1305)
- Actually, `file-crypto.ts` uses `symmetricEncrypt`/`symmetricDecrypt` from `@shared/crypto-primitives` for file content. It uses raw `xchacha20poly1305` only in `encryptMetadataForPubkey`. After Step 1, that's gone.
- Remove `import { secp256k1 } from '@noble/curves/secp256k1.js'`
- Remove `import { sha256 } from '@noble/hashes/sha2.js'`
- Remove `import { decryptEnvelope, eciesWrapKey } from '@shared/crypto-primitives'`

Keep:
- `import { symmetricEncrypt, symmetricDecrypt } from '@shared/crypto-primitives'` (for file content)
- `import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'`

### Step 6: Commit

```bash
git add src/client/lib/file-crypto.ts
git commit -m "feat(sec): file crypto ECIES → HPKE migration

encryptMetadataForPubkey uses direct HPKE seal.
encryptFile/decryptFile/rewrapFileKey use HPKE key-wrap.
Removed secp256k1, eciesWrapKey, and raw xchacha20poly1305
imports from file-crypto."
```

---

## Task 2: Update File Upload

**File:** `src/client/lib/file-upload.ts`

### Step 1: Update `decryptFileMetadata` call

The old code passed `myMeta.encryptedContent` and `myMeta.ephemeralPubkey` separately. With HPKE, `myMeta` IS the envelope.

```typescript
// Old:
// @ts-expect-error Slice 5: file crypto ECIES → HPKE migration
const metadata = await decryptFileMetadata(myMeta.encryptedContent, myMeta.ephemeralPubkey)

// New:
const metadata = await decryptFileMetadata(myMeta)
```

Wait — `decryptFileMetadata` currently takes `(encryptedContentHex, ephemeralPubkeyHex)`. We need to rewrite it to take an `HpkeEnvelope`:

```typescript
// In file-crypto.ts:
export async function decryptFileMetadata(
  envelope: HpkeEnvelope
): Promise<EncryptedFileMetadata | null> {
  try {
    const worker = cryptoWorker
    const resultHex = await worker.decrypt(envelope, LABEL_FILE_METADATA, new Uint8Array(0))
    const plaintext = hexToBytes(resultHex)
    return JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    return null
  }
}
```

Then in `file-upload.ts`:
```typescript
const metadata = await decryptFileMetadata(myMeta)
```

**Remove `@ts-expect-error Slice 5`.**

### Step 2: Commit

```bash
git add src/client/lib/file-upload.ts
git commit -m "feat(sec): file-upload decryptFileMetadata call updated for HPKE"
```

---

## Task 3: Rewrite File Crypto Tests

**File:** `src/client/lib/file-crypto.test.ts`

### Step 1: Replace ECIES test key generation with HPKE

```typescript
import { createHpkeSuite } from '@shared/crypto-suite'

// Generate test X25519 keypair
async function generateTestHpkeKeypair() {
  const suite = createHpkeSuite()
  const kp = await suite.kem.generateKeyPair()
  const publicKeyBytes = new Uint8Array(await suite.kem.serializePublicKey(kp.publicKey))
  return { privateKey: kp.privateKey, publicKeyHex: bytesToHex(publicKeyBytes) }
}
```

### Step 2: Rewrite `decryptFileWithSecret` helper

The old helper used `eciesUnwrapKeyWithSecret`. The new helper uses `hpkeOpen`:

```typescript
import { hpkeOpen } from '@shared/hpke-primitives'
import { asX25519EncryptionKey } from '@shared/types'

async function decryptFileWithSecret(
  encryptedContent: Uint8Array,
  envelope: Envelope,
  fileId: string,
  privateKey: CryptoKey
): Promise<Uint8Array> {
  const aad = buildFileAad(fileId)
  if (envelope.labelId !== labelToId(LABEL_FILE_KEY)) {
    throw new Error(`Label mismatch`)
  }
  const fileKey = await hpkeOpen(
    envelope,
    asX25519EncryptionKey(privateKey),
    LABEL_FILE_KEY,
    new Uint8Array(0)
  )
  const encryptedHex = bytesToHex(new Uint8Array(encryptedContent)) as Ciphertext
  return symmetricDecrypt(encryptedHex, fileKey, aad)
}
```

### Step 3: Update all test assertions

Replace assertions that check `wrappedKey`/`ephemeralPubkey` with assertions that check `enc`/`ct`:

```typescript
// Old:
// @ts-expect-error Slice 5
expect(result.recipientEnvelopes[0].wrappedKey).toBeTruthy()
// @ts-expect-error Slice 5
expect(result.recipientEnvelopes[0].ephemeralPubkey).toBeTruthy()

// New:
expect(result.recipientEnvelopes[0].v).toBe(3)
expect(result.recipientEnvelopes[0].enc).toBeTruthy()
expect(result.recipientEnvelopes[0].ct).toBeTruthy()
```

### Step 4: Update metadata test

The metadata test manually did ECDH + symmetric decrypt. Now it just calls `hpkeOpen`:

```typescript
const { hpkeOpen } = await import('@shared/hpke-primitives')
const { asX25519EncryptionKey } = await import('@shared/types')
const plaintext = await hpkeOpen(
  metaEnvelope,
  asX25519EncryptionKey(testPrivateKey),
  LABEL_FILE_METADATA,
  new Uint8Array(0)
)
const parsed = JSON.parse(new TextDecoder().decode(plaintext))
```

### Step 5: Commit

```bash
git add src/client/lib/file-crypto.test.ts
git commit -m "test(sec): rewrite file-crypto tests for HPKE

Replaced secp256k1 test keypairs with X25519 HPKE keypairs.
All envelope assertions check v:3, enc, ct instead of wrappedKey,
ephemeralPubkey. Removed @ts-expect-error Slice 5 annotations."
```

---

## Task 4: Rewrite Provisioning to X25519

**File:** `src/client/lib/provisioning.ts`

### Step 1: Replace `computeSharedX` with X25519

The old method used `secp256k1.getSharedSecret`. The new method uses WebCrypto X25519 `deriveBits`.

```typescript
async function computeSharedX(
  ourPrivateKey: CryptoKey,
  theirPubkeyHex: string
): Promise<Uint8Array> {
  const theirPubBytes = hexToBytes(theirPubkeyHex)
  const theirPubKey = await crypto.subtle.importKey(
    'raw',
    theirPubBytes,
    { name: 'X25519' },
    false,
    []
  )
  const shared = await crypto.subtle.deriveBits(
    { name: 'X25519', public: theirPubKey },
    ourPrivateKey,
    256
  )
  return new Uint8Array(shared)
}
```

**Breaking change:** `computeSharedX` is now `async`. All callers must `await`.

### Step 2: Update SAS functions to async

```typescript
export async function computeSASForNewDevice(
  ephemeralPrivateKey: CryptoKey,
  primaryPubkeyHex: string
): Promise<string> {
  const sharedX = await computeSharedX(ephemeralPrivateKey, primaryPubkeyHex)
  return computeProvisioningSAS(sharedX)
}

export async function computeSASForPrimaryDevice(
  primaryPrivateKey: CryptoKey,
  ephemeralPubkeyHex: string
): Promise<string> {
  const sharedX = await computeSharedX(primaryPrivateKey, ephemeralPubkeyHex)
  return computeProvisioningSAS(sharedX)
}
```

### Step 3: Rewrite `createProvisioningRoom` to generate X25519 keypair

```typescript
export async function createProvisioningRoom(): Promise<ProvisioningSession> {
  const ephemeralKp = await crypto.subtle.generateKey(
    { name: 'X25519' },
    true,  // extractable so we can export raw pubkey
    ['deriveBits']
  ) as CryptoKeyPair

  const ephemeralPubkeyBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', ephemeralKp.publicKey)
  )

  const res = await fetch(`${API_BASE}/provision/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ephemeralPubkey: bytesToHex(ephemeralPubkeyBytes) }),
    credentials: 'include',
  })
  // ...

  return {
    roomId: data.roomId,
    token: data.token,
    ephemeralPrivateKey: ephemeralKp.privateKey,
    ephemeralPubkey: bytesToHex(ephemeralPubkeyBytes),
  }
}
```

**Breaking change:** `ProvisioningSession.ephemeralSecret` (raw bytes) → `ephemeralPrivateKey` (CryptoKey).

### Step 4: Rewrite `decryptProvisionedNsec`

```typescript
export async function decryptProvisionedNsec(
  encryptedNsec: string,
  primaryPubkeyHex: string,
  ephemeralPrivateKey: CryptoKey
): Promise<string> {
  const sharedX = await computeSharedX(ephemeralPrivateKey, primaryPubkeyHex)
  const symmetricKey = deriveSharedKey(sharedX)

  const data = hexToBytes(encryptedNsec)
  const nonce = data.slice(0, 24)
  const ciphertext = data.slice(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  const plaintext = cipher.decrypt(ciphertext)
  return new TextDecoder().decode(plaintext)
}
```

### Step 5: Rewrite `encryptNsecForDevice`

```typescript
export async function encryptNsecForDevice(
  nsec: string,
  ephemeralPubkeyHex: string,
  primaryPrivateKey: CryptoKey
): Promise<string> {
  const sharedX = await computeSharedX(primaryPrivateKey, ephemeralPubkeyHex)
  const symmetricKey = deriveSharedKey(sharedX)

  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(nsec))

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed)
}
```

### Step 6: Remove secp256k1 imports

Remove:
- `import { secp256k1 } from '@noble/curves/secp256k1.js'`

Keep:
- `import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'` (until Slice 7)
- `import { utf8ToBytes } from '@noble/ciphers/utils.js'`
- `import { hkdf } from '@noble/hashes/hkdf.js'`
- `import { sha256 } from '@noble/hashes/sha2.js'`
- `import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'`

### Step 7: Commit

```bash
git add src/client/lib/provisioning.ts
git commit -m "feat(sec): provisioning ECIES/secp256k1 → X25519

computeSharedX now uses WebCrypto X25519 deriveBits.
createProvisioningRoom generates X25519 keypair.
decryptProvisionedNsec and encryptNsecForDevice use X25519
shared secret. Removed secp256k1 import."
```

---

## Task 5: Update Worker `handleProvisionNsec`

**File:** `src/client/lib/crypto-worker.ts`

### Step 1: Rewrite to use X25519

The worker needs to perform X25519 ECDH. Options:
1. Use `hpkePrivateKey` (X25519) if available (from `unlockWithHandles`)
2. Generate ephemeral X25519 keypair if `hpkePrivateKey` is null (legacy unlock path)

```typescript
async function handleProvisionNsec(recipientEphemeralPubkeyHex: string): Promise<{
  ciphertext: string
  nonce: string
  pubkey: string
  sas: string
}> {
  if (!secretKey || !publicKeyHex) throw new Error('Worker is locked')

  // Derive an X25519 keypair for provisioning.
  // Prefer the existing hpkePrivateKey if available.
  let x25519PrivateKey: CryptoKey
  let x25519PubkeyBytes: Uint8Array

  if (hpkePrivateKey) {
    x25519PrivateKey = hpkePrivateKey
    // Derive pubkey from private key via HPKE suite
    const { createHpkeSuite } = await import('@shared/crypto-suite')
    const suite = createHpkeSuite()
    // @hpke/core doesn't expose public-from-private derive.
    // Fallback: generate ephemeral X25519 keypair for provisioning.
    const ephemeralKp = await crypto.subtle.generateKey(
      { name: 'X25519' }, true, ['deriveBits']
    ) as CryptoKeyPair
    x25519PrivateKey = ephemeralKp.privateKey
    x25519PubkeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeralKp.publicKey))
  } else {
    const ephemeralKp = await crypto.subtle.generateKey(
      { name: 'X25519' }, true, ['deriveBits']
    ) as CryptoKeyPair
    x25519PrivateKey = ephemeralKp.privateKey
    x25519PubkeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeralKp.publicKey))
  }

  const recipientPubBytes = hexToBytes(recipientEphemeralPubkeyHex)
  const recipientPubKey = await crypto.subtle.importKey(
    'raw', recipientPubBytes, { name: 'X25519' }, false, []
  )
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: recipientPubKey },
    x25519PrivateKey,
    256
  )
  const sharedX = new Uint8Array(sharedBits)

  // Derive encryption key with domain separation
  const labelBytes = utf8ToBytes(LABEL_DEVICE_PROVISION)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const encKey = sha256(keyInput)

  // Encrypt the nsec hex string
  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(encKey, nonce)
  const nsecHex = bytesToHex(secretKey)
  const ciphertext = cipher.encrypt(utf8ToBytes(nsecHex))

  // Derive SAS
  const sasBytes = hkdf(sha256, sharedX, utf8ToBytes(SAS_SALT), utf8ToBytes(SAS_INFO), 4)
  const sasCode = unbiasedSixDigitCode(sasBytes)
  const sas = `${sasCode.slice(0, 3)} ${sasCode.slice(3)}`

  return {
    ciphertext: bytesToHex(ciphertext),
    nonce: bytesToHex(nonce),
    pubkey: bytesToHex(x25519PubkeyBytes),
    sas,
  }
}
```

**Note:** The returned `pubkey` is now the X25519 public key (64 hex chars), not the secp256k1 x-only pubkey. The consumer (`packProvisionPayload`) and the new device (`decryptProvisionedNsec`) must handle X25519 pubkeys.

### Step 2: Update `packProvisionPayload`

```typescript
export function packProvisionPayload(workerResult: {
  ciphertext: string
  nonce: string
  pubkey: string  // Now X25519 pubkey
  sas?: string
}): { encryptedNsec: string; primaryPubkey: string } {
  // ... same packing logic
  return {
    encryptedNsec: bytesToHex(packed),
    primaryPubkey: workerResult.pubkey,  // X25519 pubkey
  }
}
```

### Step 3: Commit

```bash
git add src/client/lib/crypto-worker.ts
git commit -m "feat(sec): worker handleProvisionNsec secp256k1 → X25519

Uses WebCrypto X25519 deriveBits for ECDH shared secret.
Returns X25519 pubkey for the provisioning payload."
```

---

## Task 6: Update Provisioning Tests

**File:** `src/client/lib/provisioning.test.ts`

### Step 1: Replace secp256k1 test keys with X25519

```typescript
// Generate X25519 test keypair
async function generateX25519Keypair() {
  const kp = await crypto.subtle.generateKey(
    { name: 'X25519' }, true, ['deriveBits']
  ) as CryptoKeyPair
  const pubBytes = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  return { privateKey: kp.privateKey, publicKeyHex: bytesToHex(pubBytes) }
}
```

### Step 2: Update all test functions to async

`computeSASForNewDevice`, `computeSASForPrimaryDevice`, `decryptProvisionedNsec`, `encryptNsecForDevice` are now async. Update all test calls to `await`.

### Step 3: Commit

```bash
git add src/client/lib/provisioning.test.ts
git commit -m "test(sec): rewrite provisioning tests for X25519

Replaced secp256k1 test keys with X25519 WebCrypto keypairs.
All async test functions properly awaited."
```

---

## Task 7: Verification

- [ ] **Step 1: Run typecheck**
  ```bash
  bun run typecheck
  ```
  Expected: PASS.

- [ ] **Step 2: Run build**
  ```bash
  bun run build
  ```
  Expected: PASS.

- [ ] **Step 3: Run unit tests**
  ```bash
  bun run test:unit
  ```
  Expected: PASS.

- [ ] **Step 4: Verify no remaining secp256k1 in file/provisioning files**
  ```bash
  grep -rn 'secp256k1' src/client/lib/file-crypto.ts src/client/lib/provisioning.ts src/client/lib/crypto-worker.ts | grep -v test | grep -v 'schnorr'
  ```
  Expected: Zero matches (except `schnorr` which stays for signing).

- [ ] **Step 5: Verify `@ts-expect-error Slice 5` annotations are gone**
  ```bash
  grep -rn '@ts-expect-error.*Slice 5' src/client/
  ```
  Expected: Zero matches.

- [ ] **Step 6: Run API E2E tests**
  ```bash
  bun run test:api
  ```
  Expected: PASS.

---

## Appendix A: ECIES Methods Removed in This Slice

| Method | Location | Replacement |
|--------|----------|-------------|
| `encryptMetadataForPubkey` (raw ECDH) | `file-crypto.ts:52-84` | HPKE direct seal |
| `encryptFile` key wrap (ECIES) | `file-crypto.ts:162-166` | HPKE seal |
| `decryptFile` key unwrap (ECIES) | `file-crypto.ts:199-205` | HPKE open via worker |
| `rewrapFileKey` (ECIES) | `file-crypto.ts:244-248` | HPKE re-seal |
| `computeSharedX` (secp256k1) | `provisioning.ts:59-65` | WebCrypto X25519 deriveBits |
| `createProvisioningRoom` keygen | `provisioning.ts:100-103` | WebCrypto X25519 generateKey |
| `decryptProvisionedNsec` ECDH | `provisioning.ts:147-149` | X25519 deriveBits |
| `encryptNsecForDevice` ECDH | `provisioning.ts:203-205` | X25519 deriveBits |
| `handleProvisionNsec` ECDH | `crypto-worker.ts:526-534` | X25519 deriveBits |

## Appendix B: Wire Format Changes

| Data | Before (ECIES) | After (HPKE) |
|------|---------------|--------------|
| File key envelope | `{ v: 2, labelId, pubkey, wrappedKey, ephemeralPubkey }` | `{ v: 3, labelId, pubkey, enc, ct }` |
| File metadata item | `{ pubkey, encryptedContent, ephemeralPubkey }` | `{ pubkey, v, labelId, enc, ct }` |
| Provisioning pubkey | secp256k1 x-only (64 hex) | X25519 raw (64 hex) |
| Provisioning shared secret | secp256k1 ECDH | X25519 ECDH |
