# The Llámenos Security Whitepaper

**Version 1.0 — 2026-04-11**
**Authors:** Llámenos security working group
**Status:** Public release. Canonical copy lives at
`docs/security/WHITEPAPER.md` in the Llámenos source repository. Any copy
served from a third-party mirror should be checked against the
hash-chained releases listed in §10.

---

## 0. Abstract

Llámenos is a crisis-response hotline platform for volunteer-staffed
support lines facing well-resourced adversaries — nation states, private
intelligence firms, and organized harassment campaigns. Llámenos is
designed, built, and operated so that no single party — not the hosting
organization, not a compromised administrator, not the upstream provider
of our telephony or messaging, and not the code-delivery CDN — can
passively read or retroactively reconstruct a caller's notes, identity,
or contact graph.

This whitepaper describes how Llámenos achieves that goal, what residual
risks remain even under ideal operation, and how you, as a caller,
volunteer, admin, journalist, or independent researcher, can verify for
yourself that the version of Llámenos you are running is the version the
source repository claims to ship.

We describe what Llámenos **does** protect against. Equally importantly,
we describe what it **cannot** protect against: an endpoint compromised
with an OS-level keylogger, a browser extension capable of reading page
contents, or a volunteer being compelled to disclose notes they have
already read. These residual risks are documented in §7 and are the
motivation for the delivery-integrity stack described in §6.

Llámenos is open-source (AGPL-3.0 for server components,
Apache-2.0 for client libraries, GPL-3.0 for vendored MLS dependencies).
All source, all build scripts, all deployment automation, all CI
workflows, and this whitepaper live in a single public repository that
ships reproducible builds verified by at least two independent
organizations.

---

## 1. Executive summary

Llámenos' security model has six load-bearing properties. Every section
of this document ultimately maps back to one of them.

| # | Property | How we get it |
|---|---|---|
| 1 | Callers are anonymous by construction. | PSTN arrival → routing by opaque call-id → no caller-id storage beyond the minimum needed for duplicate-call dedup and ban enforcement. |
| 2 | Volunteer identity is visible only to admins. | Volunteer PII is envelope-encrypted per-user; only admins hold the keys needed to decrypt it. Other volunteers see only opaque display handles. |
| 3 | Note contents never reach the server in plaintext. | Per-note forward-secret keys, wrapped via HPKE to the note author and to each admin envelope. The server stores ciphertext + envelope metadata only. |
| 4 | Audit events are tamper-evident. | SHA-256 hash chain + schnorr-signed sigchain; a single rewritten entry breaks the chain and is detectable by any reader. |
| 5 | The code running in your browser matches the code the repo shipped. | Reproducible builds, cosign-signed checksums, third-party verifiers, and a client-side binary verifier that fails closed on mismatch. |
| 6 | Targeted delivery attacks are publicly visible within minutes. | Every running client gossips the SHA-256 of the bundle it loaded; peers raise an alarm when they see a hash they cannot match. |

Properties 1–4 are the "at rest" security model — handled by the
cryptographic architecture described in §4 and §5. Properties 5 and 6
are the "in flight" security model — the Tier 4 delivery-hardening work
described in §6. Both are required for Llámenos' threat model to hold.

---

## 2. How to read this document

This whitepaper is written to be useful to three audiences:

- **Volunteers and admins** who want a plain-language answer to "is it
  safe to use this?" Read §1 (exec summary), §3 (threat model) and §7
  (residual risks). Skip everything else unless you want the receipts.
- **Journalists and human-rights workers** who want to understand
  Llámenos' guarantees before recommending it to a source or partner
  organization. Read §1, §3, §6 and §7.
- **Independent security researchers** who want enough detail to audit
  the source code themselves. Read §4 through §9 end-to-end; the
  relevant source paths are inlined in each subsection.

There is a companion document, `THREAT_MODEL.md`, that enumerates the
specific adversaries Llámenos defends against and the specific
capabilities they are assumed to have. If you are evaluating Llámenos
for production use you should read both.

---

## 3. Threat model

Llámenos' adversaries fall into four categories. We describe each, what
they can and cannot do, and which Llámenos sub-system is designed to
contain them.

### 3.1 External network adversary

An attacker with unrestricted visibility into traffic between clients
and the Llámenos server — for example, a nation-state traffic
interception capability.

- **Can do:** observe TLS metadata (SNI, timing, volume), block or
  delay connections, attempt TLS interception via a controlled CA.
- **Cannot do (under our model):** read content inside the TLS tunnel,
  read ciphertext payloads without also compromising a key-holder.
- **Mitigated by:** HTTPS everywhere, HSTS preload, certificate pinning
  where feasible, public-key pinning of the release signing key inside
  the SPA bundle, and Tier 4 origin-split + CSP `script-src 'none'` on
  the API origin.

### 3.2 Compromised server infrastructure

An attacker who has obtained root on the Llámenos host or on one of the
backing services (Postgres, strfry, RustFS, Caddy, Authentik).

- **Can do:** read all ciphertext at rest, read database metadata
  (who called whom, when, for how long), attempt to impersonate
  volunteers by resetting their PIN at the IdP, delete or corrupt
  audit logs.
- **Cannot do (under our model):** read note contents, read volunteer
  PII, forge signed audit entries, unwrap user envelopes without also
  compromising a user's device.
- **Mitigated by:** envelope encryption with keys held only on client
  devices, hash-chained + signed audit log that tolerates retroactive
  deletion (the chain breaks and becomes obvious), multi-party
  session-revocation on server restart, and Tier 4 third-party
  verifiers so the server cannot silently swap the bundle it serves.

### 3.3 Malicious volunteer or admin

A volunteer or admin acting in bad faith against their own
organization.

- **Can do:** see what they are entitled to see under the role-based
  access model — a volunteer sees their own notes during shifts; an
  admin sees all notes and the audit log.
- **Cannot do:** read notes outside their own organizational scope,
  silently delete audit entries, exfiltrate raw ciphertext in a form
  usable by a third party.
- **Mitigated by:** narrow role scopes, admin actions audit-logged
  into the signed hash chain, dual-envelope encryption so removing
  an admin's decryption key via CLKR (cross-signing log key rotation)
  actually cuts off their ability to decrypt future data.

### 3.4 Endpoint compromise

The hardest adversary: malware, a rogue browser extension, or a
physical attacker who has compromised a volunteer's laptop or phone.

- **Can do:** read everything the volunteer can see, log keystrokes
  including PINs, exfiltrate session tokens, capture screenshots.
- **Cannot do:** retroactively read notes from past shifts on devices
  they don't control; impersonate the volunteer beyond the lifetime
  of their current session once the volunteer's device has been
  quarantined.
- **Mitigated by:** per-note forward secrecy (§4.1), short-lived
  refresh tokens, server-side session revocation (Tier 0), the
  multi-factor KEK (§5.3), and — most importantly — the honest
  residual-risk disclosure in §7 so volunteers can make informed
  decisions about what to enter on untrusted endpoints.

### 3.5 Out-of-scope adversaries

Llámenos explicitly does **not** defend against:

- A caller who chooses to say their name and phone number aloud.
  Llámenos does not do voice anonymization or voice-keyword redaction.
- A volunteer who screenshots their shift view and leaks the
  screenshots elsewhere. Forward secrecy protects *past* data from
  *future* compromise; it cannot protect data that has already been
  voluntarily re-exposed.
- A legal adversary compelling an admin to disclose notes under
  lawful process. The warrant canary (§8) is our best attempt to
  signal this condition in jurisdictions where direct disclosure is
  forbidden by a gag order.
- Supply-chain compromise of our upstream dependencies where the
  compromise is indistinguishable from a normal upstream release.
  This is partially mitigated by SBOM diffing, cosign-verified
  dependencies, and the third-party verifiers in §6.

---

## 4. Cryptographic architecture

### 4.1 Per-note forward secrecy

Every note written in Llámenos is encrypted under a fresh
`ChaCha20-Poly1305` content key. The content key is randomly generated
at note creation time, used to encrypt the note body, and then wrapped
separately for each reader of the note — the volunteer who wrote it,
and every current admin in the hub.

Wrapping is done via HPKE (RFC 9180) using the
`DHKEM(P-256, HKDF-SHA256)` kem, `HKDF-SHA256` kdf, and
`ChaCha20-Poly1305` aead. The wrapped keys are stored in the database
as individual envelopes. The note's ciphertext is stored once.

This means:

- The server never sees the content key.
- A note can be read by any current member of the envelope set
  without re-encrypting the note body.
- When an admin leaves the organization, future notes no longer
  wrap their key; they cannot read anything written after their
  removal, even though the ciphertext is still in the database.
- Recovering a single lost note requires recovering exactly one
  wrapped key, not re-deriving the entire database.

Forward secrecy over time is achieved via Cross-signing Log Key
Rotation (CLKR), described in Tier 3 of the security roadmap. After
CLKR lands, an admin who loses their device can be revoked via a
signed event on the Nostr relay; clients hold-back any notes written
after the revocation event from that admin's envelope set within the
bounded-consistency window CLKR provides.

**Source:** `src/client/lib/crypto-worker.ts`,
`src/server/services/notes-service.ts`, `src/shared/hpke.ts`.

### 4.2 Hub key + rotation

A "hub" is Llámenos' unit of organizational scoping — one hotline
organization's notes, volunteers, shifts, and settings are all scoped
to a single hub. Every hub has a symmetric 32-byte **hub key** used
to encrypt organizational metadata that every hub member needs to
read (role names, shift names, report type labels, custom field
definitions, team names).

The hub key is generated via `crypto.getRandomValues(new Uint8Array(32))`
at hub creation. It is **not** derived from any identity key — that
decoupling is deliberate, so that rotating the hub key after a
personnel change does not force every member to rotate their personal
identity keys.

Hub key distribution uses HPKE with the label
`LABEL_HUB_KEY_WRAP`: each current member gets an individually-wrapped
copy published to the Nostr relay. Hub key rotation on member
departure is mandatory — the new hub key is wrapped only to the
remaining members, and the old key is treated as compromised.

**Source:** `src/client/lib/hub-key-manager.ts`,
`src/shared/crypto-labels.ts`.

### 4.3 Multi-factor KEK (key store v2)

A volunteer's long-lived identity key (the `nsec` used to sign audit
entries and Nostr events) is held in memory only. At rest, it is
encrypted under a **multi-factor Key Encryption Key** derived from:

- A **PIN** the user chooses at onboarding, stretched with Argon2id
  (memory=64 MiB, time=3, parallelism=4).
- An optional **recovery key** generated at onboarding and written
  down offline.
- An optional **WebAuthn credential** bound to a hardware
  authenticator (YubiKey, platform TPM, etc.).

The KEK format is a symmetric split: each factor wraps a *share* of
the KEK via HPKE, and unlock requires presenting any *one* factor.
The encrypted identity key is then wrapped by the reassembled KEK.
This means:

- Losing your device does not require losing your account — you can
  re-provision with the recovery key.
- Rotating any single factor (changing your PIN, for example) does
  not require re-encrypting everything at rest — only the KEK
  wrapping is re-generated.
- WebAuthn is a **primary** factor, not a "second factor", which
  means an attacker who obtains your PIN still cannot unlock your
  identity key without the physical device.

The in-memory `nsec` is zeroed on lock (tab blur, explicit lock,
inactivity timeout) and wiped on logout. The key store's lifecycle
tests verify this via a `fill(0)` check on the secret buffer after
every lock event.

**Source:** `src/client/lib/key-store-v2.ts`,
`src/client/lib/crypto-worker-client.ts`.

### 4.4 Signed, hash-chained audit log

Every admin action (volunteer added, volunteer removed, role changed,
hub key rotated, residual-risk acknowledged, warrant canary refreshed)
is recorded as an audit entry with the following shape:

```
{
  "type":          <enum>,
  "payload":       <JSON>,
  "actorPubkey":   <hex-x-only-pubkey>,
  "timestamp":     <epoch-seconds>,
  "previousEntryHash": <hex-sha256>,
  "entryHash":     <hex-sha256>,
  "signature":     <hex-schnorr>
}
```

`entryHash` is SHA-256 over the canonical serialization of
`{type, payload, actorPubkey, timestamp, previousEntryHash}`.
`signature` is a schnorr signature over `entryHash` using the actor's
nsec.

Any reader with the current hub key set can verify:

1. Each `entryHash` matches the recomputed hash.
2. Each entry's `previousEntryHash` matches the prior entry's
   `entryHash`.
3. Each signature verifies against the claimed actor's pubkey.

A single rewritten entry breaks the chain at that entry and at every
subsequent entry, and every reader sees it as an invariant failure.
The verifier is implemented in `src/client/lib/audit-chain-verifier.ts`
and is exercised by the boot sequence on every unlock — if the chain
is broken, the UI refuses to show admin data and surfaces a "chain
broken" error state.

**Source:** `src/client/lib/audit-chain-verifier.ts`,
`src/server/services/audit-service.ts`,
`docs/security/KEY_REVOCATION_RUNBOOK.md` for the out-of-band recovery
procedure when a chain break is detected.

### 4.5 Messaging envelope

SMS, WhatsApp, and Signal messages that arrive via webhooks are
encrypted at the webhook boundary before any plaintext touches
persistent storage. The webhook handler:

1. Validates the provider's signature on the incoming payload.
2. Generates a per-message random symmetric key.
3. Encrypts the plaintext under that key with ChaCha20-Poly1305.
4. Wraps the per-message key via HPKE for every reader (assigned
   volunteer + each current admin) and for the hub.
5. Writes the ciphertext, wrapped keys, and metadata to the database
   in a single transaction.
6. Discards the plaintext before returning.

The server never writes the plaintext to disk — not even to a log.
The hot-path test suite grep-checks the messaging service for
`console.log` on plaintext variables at CI time.

**Source:** `src/server/services/conversation-service.ts`,
`src/server/middleware/webhook-signature.ts`.

---

## 5. Delivery integrity — the Tier 4 problem

The cryptographic architecture above assumes that the JavaScript
running in your browser is the JavaScript we published. That
assumption is the single largest attack surface for an adversary
capable of compelling the hosting organization. Tier 4 is the set of
measures that make the assumption verifiable rather than trusted.

### 5.1 Origin split

Llámenos serves from three origins that are cryptographically
disjoint:

- `app.llamenos.example` — the SPA. CSP
  `script-src 'self' 'nonce-…'`, no third-party scripts, no eval,
  no remote fonts. Published as static files on a Caddy host with
  no backend access.
- `api.llamenos.example` — the Hono API + the strfry Nostr relay +
  RustFS blob storage. CSP `script-src 'none'`. No HTML served at
  all; the API speaks only JSON + WebSocket.
- `crypto.llamenos.example` — a dedicated origin that serves nothing
  but the cryptographic sandbox iframe. See §5.2.

A compromise of the API origin cannot deliver new code to the app
origin; the app origin has no way to execute code delivered from the
API origin; the crypto origin is sandboxed against both. This is
the "code-execution compartment" design borrowed from Signal Desktop
and 1Password's web clients.

### 5.2 Sandboxed crypto iframe

All cryptographic primitives — HPKE, ChaCha20, schnorr, SHA-256,
Argon2id, the hub key manager, the multi-factor KEK, the audit-chain
verifier, and the envelope decrypt pipeline — run inside an iframe
served from `crypto.llamenos.example`. The iframe has:

- CSP `connect-src 'none'` (it does no network I/O on its own —
  the main frame shuttles all ciphertext/plaintext through
  postMessage)
- Trusted Types enforced, with a single throwing policy
- `require-trusted-types-for 'script'`
- An explicit origin check at the top of every incoming message
  handler, with wrong-origin messages silently dropped (no reply
  leak)
- A zod-validated RPC schema for every operation — any
  schema-violating message is rejected and increments an anomaly
  counter visible to the main frame

If a non-crypto subsystem is compromised (a React component bug, a
router XSS, a CSS injection in a preview pane), it is contained to
the main frame. It cannot read identity keys, decrypted notes, or
the PIN, because the iframe never hands those back — only the
concrete results of the RPC operations.

**Source:** `crypto-sandbox/` Vite subproject, `src/shared/schemas/crypto-rpc.ts`,
`src/client/lib/crypto-iframe-client.ts`.

### 5.3 Reproducible builds

The release pipeline (`.github/workflows/release.yml`) builds the SPA
inside a pinned Debian container with `SOURCE_DATE_EPOCH` set from
the git tag. Every tool version — Bun, Vite, Biome, node, the pnpm
lockfile — is pinned by content hash. The output is a deterministic
set of content-hashed files: rebuilding the same tag twice yields
byte-identical artifacts.

The pipeline then generates `CHECKSUMS.txt` (a SHA-256 manifest of
every built file) and signs it with **cosign** in keyless mode,
producing `CHECKSUMS.txt.cosign-bundle`. The cosign bundle embeds
the SLSA provenance — which GitHub Actions workflow, which commit,
which runner image — and is verifiable against the public sigstore
transparency log (Rekor) by any third party.

A `bundle-manifest.json` is also attached to the GitHub release. It
is a JSON object mapping relative paths to SHA-256 hashes, signed
with a pinned Ed25519 **release signing key** whose public key is
compiled into the SPA at build time. This is the manifest the
client-side binary verifier reads.

### 5.4 Third-party verifiers

An allied organization — not part of Llámenos' hosting footprint,
ideally in a different jurisdiction — runs the
`verify-llamenos.yml` GitHub Action every 15 minutes. The verifier:

1. Fetches the HTML served at `app.llamenos.example`,
   `crypto.llamenos.example/sandbox.html`, and every script + style
   they reference.
2. Downloads the latest release's `CHECKSUMS.txt` and
   `CHECKSUMS.txt.cosign-bundle` from GitHub Releases.
3. Runs `cosign verify-blob` against the bundle with the GitHub
   Actions OIDC issuer pinned.
4. Compares the live-served file hashes to `CHECKSUMS.txt` line by
   line. Any mismatch is fatal.
5. Publishes a signed verdict event to the Llámenos Nostr relay.
6. On mismatch, opens a public GitHub issue tagged `bundle-mismatch`.

At least two independent verifiers run concurrently, ideally in two
different jurisdictions. Their verifier keys are signed by their
hosting organization and published in
`docs/security/VERIFIER_MOU.md`. If a verifier goes silent for more
than 1 hour, clients treat the fleet as "verification stale" and
surface a banner.

### 5.5 Client-side binary verifier

In parallel with the server-side third-party verifiers, every
running client runs its own bundle integrity check. On unlock:

1. The client fetches the signed release manifest from
   `api.llamenos.example/api/releases/latest/manifest`.
2. It verifies the manifest's Ed25519 signature against the release
   signing key pinned in the bundle at build time.
3. It enumerates every script and stylesheet referenced by the
   running document, fetches each resource fresh
   (`cache: 'no-store'`), and hashes the contents with SHA-256.
4. It compares each hash to the manifest.

On mismatch, the client **fails closed** — it raises a
`VerifierFailure` that the boot orchestrator MUST treat as a refusal
to run. The UI shows a "bundle verification failed" screen with
instructions for the user to contact security. It does **not**
proceed to unlock the identity key, enter the PIN prompt, or
download any further code.

"Fail closed, never fall back" is an explicit design rule for this
subsystem. A silent fallback to "run anyway with a warning" would
let a determined attacker trigger the fallback condition to
downgrade the client out of its own protection. Every error
condition in `binary-verifier.ts` is an explicit enum value, and
`verifyOrThrow` is the only correct entry point for boot-time use.

**Source:** `src/client/lib/binary-verifier.ts`.

### 5.6 Gossip attestation of loaded hashes

Signed release manifests and third-party verifiers protect against
the case where the SPA is silently swapped for every user at once.
They do **not** protect against the case where the SPA is swapped
for a *single user* — the server can serve signed, verified release
X to 9,999 clients and a different-but-also-signed release Y to a
single client whose cookie matches a targeting rule.

To detect targeted attacks, every running client publishes a
**bundle attestation** to the Nostr relay once per unlock. The
attestation is a signed Nostr event (kind 20002, the ephemeral
range) containing:

```
{
  "version": 1,
  "bundleHash": "<sha256 of every loaded script + style + index.html>",
  "bundleVersion": "<semver>",
  "releaseTag": "<git tag>",
  "timestamp": <epoch-seconds>,
  "userAgent": "<first 256 chars of navigator.userAgent>"
}
```

The event is signed with an **ephemeral schnorr keypair**, freshly
generated per loader instance and never linked to the user's
identity key. This is the privacy-critical piece: if the bundle
attestation were signed with the user's identity key, the gossip
channel would become a de-anonymization vector. Every
`GossipVersionClient` in `src/client/lib/gossip-version.ts` zeroes
its secret key in `destroy()`.

On subscribe, the client also reads every other kind-20002 event
within its observation window. For every peer event whose bundle
hash does **not** match its own hash, the client raises a
"fleet divergence detected" alert. An attacker performing a
targeted attack must either:

- Swap the bundle for every client simultaneously (which the
  third-party verifiers will catch within 15 minutes), OR
- Accept that at least one non-target client will see a gossip
  attestation that contradicts its own, raising an alert publicly
  within seconds.

The alert is visible to volunteers, admins, and — via a public
mirror of the Nostr relay — to external observers. In effect, the
gossip channel turns targeted delivery attacks into a public
integrity failure.

**Source:** `src/client/lib/gossip-version.ts`,
`src/shared/schemas/gossip-version.ts`.

### 5.7 Compositional guarantee

Properties 5.1 through 5.6 are not redundant — each is designed to
catch a different failure mode of the others:

- The **origin split** catches code-path confusion within a single
  compromised origin.
- The **sandboxed iframe** catches crypto-primitive compromise
  originating from a compromised main-frame component.
- **Reproducible builds** catch tampering during the release
  pipeline itself.
- **Third-party verifiers** catch a post-release swap of the served
  bundle for the entire fleet.
- The **client-side binary verifier** catches a live-serve mismatch
  for the specific client running it, even if the third-party
  verifiers have not yet caught up.
- **Gossip attestation** catches a targeted swap that fools both the
  third-party verifiers and the individual client-side verifier.

An attacker needs to defeat **all six** to silently serve modified
code. Any one of them failing — in the right direction — is enough
to raise the alarm.

---

## 6. How to verify this release yourself

### 6.1 Verify the cosign bundle

```bash
gh release download v1.0.0 --repo llamenos/llamenos-hotline \
  --pattern 'CHECKSUMS.txt' --pattern 'CHECKSUMS.txt.cosign-bundle'

cosign verify-blob \
  --bundle CHECKSUMS.txt.cosign-bundle \
  --certificate-identity-regexp '^https://github\.com/llamenos/llamenos-hotline/\.github/workflows/release\.yml@refs/tags/' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  CHECKSUMS.txt
```

This confirms that `CHECKSUMS.txt` was produced by a Llámenos
release workflow run triggered by a git tag push, signed through
sigstore's keyless flow, and recorded in the public Rekor
transparency log.

### 6.2 Reproduce the build

```bash
./scripts/verify-build.sh v1.0.0
```

The script pulls the pinned build container, rebuilds the SPA
inside it with `SOURCE_DATE_EPOCH` set from the tag's commit date,
and diffs the produced artifacts against `CHECKSUMS.txt`.

Expected output: `all 48 files matched`. A single mismatch means
one of three things: (a) a nondeterminism has crept into the build,
(b) the upstream release was tampered with post-publish, or (c)
your environment is not quite the pinned container (check your
container runtime). Report any failure to `security@llamenos.example`.

### 6.3 Verify the running SPA

In your browser, open the Llámenos app and run the one-click
"Verify bundle" command from the security menu. This runs
`binary-verifier.ts` against the currently-loaded document. It
should report `all <N> files match release <tag>`.

You can also run the verifier manually:

```js
// In the browser devtools console:
const { runBinaryVerifier } = await import('/src/client/lib/binary-verifier.ts')
const result = await runBinaryVerifier()
console.log(result)
```

### 6.4 Watch the gossip channel

Subscribe to the public mirror of the Llámenos Nostr relay
(`wss://nostr.llamenos.example` → anonymous read is permitted for
kind-20002 events) and watch for `bundleHash` values that do not
match the current release. Any divergence is an alert condition.

```bash
nak req -k 20002 wss://nostr.llamenos.example | jq '.content'
```

### 6.5 Check the warrant canary

The canary lives at `docs/security/WARRANT_CANARY.md` in the repo
and is mirrored at `https://llamenos.example/security/warrant-canary`.
Its staleness is exposed to the UI — the security menu shows a
"canary last refreshed N days ago" field. A canary that is more
than its declared refresh interval past due is a signal condition
(see §8 for the interpretation rules).

---

## 7. Residual risks

Llámenos is **not** a magic wand. This section lists every
significant threat class we know about that the system does not, or
cannot, defend against.

### 7.1 Compromised endpoint

If your laptop, phone, or browser has been compromised by an
attacker with local code execution — a keylogger, a malicious
extension, a kernel rootkit — Llámenos cannot protect you from
that attacker while you are using it. The attacker can read your
PIN as you type it, the plaintext notes as they render, and the
session token as it is set. Per-note forward secrecy protects your
future notes once the attacker is evicted; it does not protect the
current session.

Mitigation:

- Use Llámenos from an endpoint you trust. For high-risk
  engagements, consider a dedicated Tails / Qubes workstation.
- Keep your browser and OS patched.
- Do not install browser extensions on the profile you use for
  Llámenos.
- Use WebAuthn with a hardware token as your primary unlock factor.

### 7.2 Coercion

An admin compelled by law, force, or social engineering to
disclose notes or revoke volunteer access can do so. Cryptography
does not prevent a human from obeying a court order. The warrant
canary (§8) is our best attempt at a signaling mechanism for this
scenario.

### 7.3 Traffic analysis

Even though Llámenos' content is end-to-end encrypted, metadata
(who connected, when, from where, for how long) is visible to the
network operator and to the Llámenos server. For threat models
that include traffic analysis by a state-level adversary, clients
should connect via Tor, a per-call VPN, or a dedicated mobile
hotspot that is not linked to the volunteer's identity.

### 7.4 Client-side delivery attacks the verifier cannot catch

The binary verifier (§5.5) catches only what it can see. If an
attacker injects code *between* the binary verifier's fetch and
the browser's execution — for example, via a browser-level
man-in-the-middle tool that rewrites `<script>` tags on the fly —
the verifier cannot observe that. This is why the verifier alone
is not sufficient: the gossip channel (§5.6) is the backstop,
because peers will see the difference between what they loaded and
what you loaded.

### 7.5 Quantum-adversary deferral

HPKE-P256 is not post-quantum secure. A sufficiently-capable
quantum adversary collecting ciphertext today can decrypt it
later. The Tier 6 roadmap vendors `@wireapp/core-crypto` and
layers MLS on top of the note envelope, providing a post-quantum
ciphersuite (XWing or P-384 fallback) for new notes. Llámenos v1
is not post-quantum secure; Llámenos v2 will be.

### 7.6 Out-of-band leakage

A volunteer copy-pasting a note into Slack, printing a transcript
on a networked printer, or dictating a note into Siri gives that
note to an entirely different service Llámenos has no visibility
into. The only defense is training: `docs/security/VOLUNTEER_BRIEFING.md`
covers this explicitly and must be read before a volunteer is
given note-taking permissions.

### 7.7 Silent key-compromise followed by session replay

If an attacker obtains a long-lived session refresh token — for
example, via a backup that was not encrypted, or a browser profile
exfiltration — they can impersonate the volunteer until the token
is rotated. Tier 0 rotated refresh tokens on every use and
introduced a server-side `user_sessions` table so admins can revoke
specific sessions on demand. This reduces the window but does not
eliminate it. Watch the sessions page in the settings UI and
revoke anything unfamiliar immediately.

---

## 8. Warrant canary

### 8.1 What it is

A warrant canary is a public statement — signed and timestamped —
asserting that the Llámenos operators have not, as of a given
date, received any legal process they are forbidden from
disclosing. The canary is **not** a cryptographic primitive. It
is a legal/procedural artifact whose security relies on the
existence of legal regimes that forbid lying about the content of
a gag order but permit refusing to update a pre-existing
statement.

### 8.2 How it works in practice

The canary is refreshed monthly. Each refresh is signed with the
Llámenos release signing key (the same key that signs the binary
manifest in §5.3) and committed to the public repository. The
canary commit is itself GPG-signed by a human operator identified
in `docs/security/SECURITY_TEAM.md`. The signing flow requires
the human to authenticate via WebAuthn; the canary cannot be
refreshed programmatically.

Clients display the canary's age in the settings UI. When the
canary is more than **45 days** past its declared refresh interval,
the UI surfaces a red banner titled "Canary stale — treat hosting
with elevated caution" and links to the current canary document.

### 8.3 Limits — read carefully

A warrant canary is a **weak signal, not a guarantee**. Specific
limits:

- A canary can only signal conditions the operator is aware of.
  A compromise that the operator does not know about cannot be
  canary-signaled.
- In some jurisdictions, courts have the power to compel **false
  negative** assertions, i.e., to compel the operator to publish
  a fresh canary anyway. The canary is of no use against this
  class of order. Llámenos hosts in the European Union
  specifically to reduce this exposure.
- A canary that stops being updated is ambiguous: it might mean
  the operator has been gagged, or it might mean the operator
  got busy. Llámenos commits to publishing a "canary paused —
  reason unrelated" note in the public repo at least once per
  refresh cycle if the non-legal reason is applicable.
- An attacker who controls the operator can forge a canary
  refresh as long as they also control the release signing key
  and the WebAuthn credential. The canary is therefore only as
  strong as the key custody model for the release key. See
  `docs/security/KEY_REVOCATION_RUNBOOK.md`.

### 8.4 What to do on a canary stall

If the canary is stale for more than 45 days past its declared
refresh, the recommended response is:

1. Cross-check with the public Nostr relay mirror for any
   third-party verifier verdict changes.
2. Check if the third-party verifier jobs are still green.
3. Reach out to the security team via the non-Llámenos contact
   listed in `docs/security/SECURITY_TEAM.md` to confirm.
4. Pause note-taking on the instance until a human
   acknowledgement is received. Callers can still be received —
   note contents are the sensitive asset, and skipping note
   writes until the ambiguity is resolved is safer than
   continuing.

---

## 9. Audit history

| Date | Scope | Outcome |
|---|---|---|
| 2026-02 | External pentest, Tier 0 baseline (cosign, CSP L3, signed sigchain, SBOM, audit chain verifier). | Findings R1–R6 — all closed before Tier 0 merge. `TIER_0_REVIEW.md` + `TIER_0_POST_REVIEW.md`. |
| 2026-03 | Internal code audit, Tier 1 (HPKE + crypto-worker rewrite). | One high finding (H-1: label mismatch in hub rotation) — fixed in PR #41. `TIER_1_REVIEW.md`. |
| 2026-03 | Field encryption audit, Tier 1.B. | Clean. `TIER_2_REVIEW.md`. |
| 2026-03 | OPAQUE + key-store-v3 review. | One medium (M-2: PIN stretching parameter too low on mobile). Fixed before merge. |
| 2026-04 | AEAD audit (`docs/security/AEAD_AUDIT_2026-04-10.md`). | Clean. |
| 2026-04 | Tier 4 delivery hardening review (`TIER_4_REVIEW.md`). | Two mediums (M-1: split-origin cookie scope; M-3: iframe RPC schema strict mode). Both fixed in PR-A and PR-B respectively. |
| Scheduled | Tier 5 voice E2EE external pentest. | Planned — 2026-06. |
| Scheduled | Tier 6 MLS pilot external audit. | Planned — after MLS rollout reaches stage 3. |

Every review document is public and lives under `docs/security/`.
Any subsequent audit with public publication rights is added here
at release time.

---

## 10. Contact + reporting vulnerabilities

### 10.1 Reporting a security issue

Security issues should be reported to `security@llamenos.example`
with subject line `[SECURITY]`. We accept PGP-encrypted mail; the
current key is published at `https://llamenos.example/security.asc`
and fingerprinted on the security team page.

We commit to:

- Acknowledging within **48 hours**.
- Providing an initial severity triage within **5 business days**.
- Publishing a fix + post-mortem within **60 days** for
  high-severity issues, or a decision to treat the issue as
  accepted risk with public justification.
- Crediting the reporter by name (or pseudonym at their request)
  unless they prefer not.

We do **not** offer a monetary bug bounty. We do offer public
credit, an optional in-release acknowledgement, and — for
substantive findings — a donation to a volunteer-nominated
crisis-response charity.

### 10.2 Responsible disclosure

We ask reporters to:

- Not access, modify, or delete data that does not belong to them.
- Not target real users of any hosted Llámenos instance.
- Wait until a fix has shipped before public disclosure (we aim
  for within 60 days; longer by mutual agreement for complex
  issues).
- Test against the public `demo.llamenos.example` instance or
  against a self-hosted local build when possible.

### 10.3 Non-security contact

For press inquiries or general questions: `info@llamenos.example`.

---

## 11. Change log

### 1.0 — 2026-04-11

- Initial public publication.
- Covers Tier 0 (Albrecht hardening) + Tier 1.A (HPKE + crypto-worker
  rewrite) + Tier 4.A + 4.B + 4.C (delivery hardening) + partial
  Tier 2 (OPAQUE + KEKv3).
- Defers Tier 5 (voice E2EE) and Tier 6 (MLS) to a future edition
  of this document — those features are under active development
  and will be documented when they ship to stable.
- Warrant canary first issued alongside this publication.

### Planned: 1.1 — after Tier 2.C merges

- Shamir recovery group documentation.
- Updated KEK factor list once the Recovery Group UX lands.

### Planned: 1.2 — after Tier 5 merges

- Voice E2EE via SFrame + `RTCRtpScriptTransform`.
- DTLS fingerprint binding to Nostr-signed signaling.
- Fallback consent modal.

### Planned: 2.0 — after Tier 6 MLS reaches stage 3

- Full rewrite of §4 to describe the MLS-based envelope.
- Post-quantum ciphersuite.
- Retirement of HPKE-P256 from the documented architecture.

---

*End of document. `docs/security/WHITEPAPER.md` is the canonical copy;
served copies must hash-match the release manifest they reference.*
