#!/usr/bin/env bun
/**
 * Verify a detached Ed25519 signature over the Llámenos warrant canary.
 *
 * This script is the runtime of the friendly `scripts/verify-canary.sh`
 * wrapper. It imports the same `verifyWarrantCanary` used by the client
 * bundle, ensuring the CLI and in-browser verification paths cannot
 * disagree about what constitutes a valid canary.
 *
 * Usage:
 *   bun run scripts/verify-warrant-canary.ts \
 *     --in  docs/security/WARRANT_CANARY.md \
 *     --sig docs/security/WARRANT_CANARY.md.sig \
 *     --pub <base64 pubkey>        # or set WARRANT_CANARY_PUBKEY
 *
 * Exit codes:
 *   0 — signature is valid
 *   1 — signature is invalid OR the inputs are malformed
 *   2 — no public key provided (verification unavailable)
 *   3 — argument error / IO error
 */

import { readFile } from 'node:fs/promises'
import { __test_setPubkey, verifyWarrantCanary } from '../src/shared/warrant-canary'

interface Args {
  inPath: string | null
  sigPath: string | null
  pub: string | null
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { inPath: null, sigPath: null, pub: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    switch (a) {
      case '--in':
        args.inPath = argv[++i] ?? null
        break
      case '--sig':
        args.sigPath = argv[++i] ?? null
        break
      case '--pub':
        args.pub = argv[++i] ?? null
        break
      case '--help':
      case '-h':
        process.stdout.write('verify-warrant-canary --in <file> --sig <file.sig> --pub <base64>\n')
        process.exit(0)
        break
      default:
        process.stderr.write(`Unknown argument: ${a}\n`)
        process.exit(3)
    }
  }
  return args
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.inPath === null || args.sigPath === null) {
    process.stderr.write('verify-warrant-canary: --in and --sig are required\n')
    process.exit(3)
  }

  const pubB64 = args.pub ?? process.env.WARRANT_CANARY_PUBKEY ?? null
  // The client bundle picks up its pubkey from `import.meta.env.VITE_*`
  // at build time; in a bun CLI context there is no Vite env, so we
  // inject via the module's test-only override. This is still
  // verification — the signature check itself runs in the same code
  // path that the browser bundle uses.
  __test_setPubkey(pubB64 ?? null)

  let content: string
  let sigB64: string
  try {
    content = await readFile(args.inPath, 'utf8')
    sigB64 = (await readFile(args.sigPath, 'utf8')).trim()
  } catch (err) {
    process.stderr.write(
      `verify-warrant-canary: ${err instanceof Error ? err.message : String(err)}\n`
    )
    process.exit(3)
  }

  const status = await verifyWarrantCanary(content, sigB64)
  switch (status) {
    case 'valid':
      process.stdout.write(`warrant canary OK: ${args.inPath}\n`)
      process.exit(0)
      break
    case 'invalid':
      process.stderr.write(
        `warrant canary FAILED verification: ${args.inPath}\n  The signature does not match the pinned public key. Treat this\n  as a red-alert condition: tampering, wrong key, or stale sig.\n`
      )
      process.exit(1)
      break
    case 'unavailable':
      process.stderr.write(
        'warrant canary verification UNAVAILABLE: no public key provided.\n  Pass --pub <base64> or set WARRANT_CANARY_PUBKEY to verify.\n'
      )
      process.exit(2)
      break
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(3)
})
