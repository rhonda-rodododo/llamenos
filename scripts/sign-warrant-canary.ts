#!/usr/bin/env bun
/**
 * Sign the Llámenos warrant canary with an offline Ed25519 key.
 *
 * This script is run MANUALLY by the publisher, not by CI. The private
 * key lives on an offline signing workstation and NEVER in the repo.
 *
 * Two modes:
 *
 *   1. Generate a fresh offline keypair (do this once):
 *
 *      bun run scripts/sign-warrant-canary.ts \
 *        --generate \
 *        --key-out /path/to/canary.priv \
 *        --pub-out /path/to/canary.pub
 *
 *      Writes the 32-byte Ed25519 secret key as hex to `--key-out`
 *      and the 32-byte public key as base64 to `--pub-out`. The base64
 *      pubkey is what the publisher sets as `VITE_WARRANT_CANARY_PUBKEY`
 *      at client build time. Protect the private file: `chmod 600`.
 *
 *   2. Sign the canary (do this on every refresh):
 *
 *      bun run scripts/sign-warrant-canary.ts \
 *        --key /path/to/canary.priv \
 *        --in  docs/security/WARRANT_CANARY.md \
 *        --out docs/security/WARRANT_CANARY.md.sig
 *
 *      Reads the private key hex file, signs the UTF-8 bytes of the
 *      input verbatim, writes a base64 signature to `--out`, and prints
 *      the corresponding public key (base64) so the operator can verify
 *      it still matches what is pinned in the client bundle.
 *
 * The signature is detached — the canary markdown is not modified. The
 * `.sig` file ships alongside the `.md` file in the repository and in
 * any published tarballs / release artifacts.
 *
 * Private key format: 64 hex chars (32 bytes), optionally followed by a
 * trailing newline. Nothing else. The file MUST NOT be committed.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { ed25519 } from '@noble/curves/ed25519.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

interface Args {
  generate: boolean
  keyIn: string | null
  keyOut: string | null
  pubOut: string | null
  inPath: string | null
  outPath: string | null
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    generate: false,
    keyIn: null,
    keyOut: null,
    pubOut: null,
    inPath: null,
    outPath: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    switch (a) {
      case '--generate':
        args.generate = true
        break
      case '--key':
        args.keyIn = argv[++i] ?? null
        break
      case '--key-out':
        args.keyOut = argv[++i] ?? null
        break
      case '--pub-out':
        args.pubOut = argv[++i] ?? null
        break
      case '--in':
        args.inPath = argv[++i] ?? null
        break
      case '--out':
        args.outPath = argv[++i] ?? null
        break
      case '--help':
      case '-h':
        printUsageAndExit(0)
        break
      default:
        console.error(`Unknown argument: ${a}`)
        printUsageAndExit(2)
    }
  }
  return args
}

function printUsageAndExit(code: number): never {
  const msg = `sign-warrant-canary — Ed25519 sign the warrant canary

Generate an offline keypair:
  bun run scripts/sign-warrant-canary.ts --generate \\
      --key-out <priv.hex> --pub-out <pub.b64>

Sign the canary:
  bun run scripts/sign-warrant-canary.ts \\
      --key <priv.hex> --in <canary.md> --out <canary.md.sig>
`
  const stream = code === 0 ? process.stdout : process.stderr
  stream.write(msg)
  process.exit(code)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0)
  return btoa(binary)
}

async function generateKeypair(keyOut: string, pubOut: string): Promise<void> {
  const sk = ed25519.utils.randomSecretKey()
  const pk = ed25519.getPublicKey(sk)

  await writeFile(keyOut, `${bytesToHex(sk)}\n`, { mode: 0o600 })
  const pubB64 = bytesToBase64(pk)
  await writeFile(pubOut, `${pubB64}\n`)

  console.log('Generated Ed25519 warrant canary keypair.')
  console.log(`  Private key (hex):   ${keyOut}  (chmod 600)`)
  console.log(`  Public key  (b64):   ${pubOut}`)
  console.log('')
  console.log('Pin this public key at client build time:')
  console.log(`  VITE_WARRANT_CANARY_PUBKEY=${pubB64}`)
  console.log('')
  console.log('Store the private file on your offline signing workstation.')
  console.log('It MUST NOT be committed to this repository.')
}

async function readPrivateKey(path: string): Promise<Uint8Array> {
  const raw = (await readFile(path, 'utf8')).trim()
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`private key file ${path} must contain exactly 64 hex chars (32 bytes)`)
  }
  return hexToBytes(raw)
}

async function signCanary(keyIn: string, inPath: string, outPath: string): Promise<void> {
  const sk = await readPrivateKey(keyIn)
  const pk = ed25519.getPublicKey(sk)
  const content = await readFile(inPath)
  const sig = ed25519.sign(content, sk)
  const sigB64 = bytesToBase64(sig)

  await writeFile(outPath, `${sigB64}\n`)

  console.log(`Signed ${inPath}`)
  console.log(`  Signature written to: ${outPath}`)
  console.log(`  Public key (base64):  ${bytesToBase64(pk)}`)
  console.log('')
  console.log('Publishers: confirm this base64 pubkey matches the value')
  console.log('currently pinned as VITE_WARRANT_CANARY_PUBKEY in the shipping')
  console.log('client bundle. If it does not, clients will report the canary')
  console.log('as "invalid" until you rebuild with the new pubkey.')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.generate) {
    if (args.keyOut === null || args.pubOut === null) {
      console.error('--generate requires --key-out and --pub-out')
      printUsageAndExit(2)
    }
    await generateKeypair(args.keyOut, args.pubOut)
    return
  }

  if (args.keyIn === null || args.inPath === null || args.outPath === null) {
    console.error('signing mode requires --key, --in, and --out')
    printUsageAndExit(2)
  }
  await signCanary(args.keyIn, args.inPath, args.outPath)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
