# Intentional Test Skips

This doc catalogs the `test.skip(...)` calls that are expected to remain in the
test suite. Everything listed here gates on **infrastructure the standard CI
pipeline does not provide** — not on feature flags, not on feature-pending
gaps, and not on defensive "maybe the server is down" probes. If you add a
new skip, it belongs here (with a reason) or it is a bug — no exceptions.

Defensive skip patterns we have **already purged** and do not want reintroduced:

- `if (!res.ok()) test.skip('Server not reachable')` in API `beforeAll` —
  CI always has the server up; a failed probe is a real failure worth
  surfacing. (PRs #134, #139.)
- `try { ... } catch { test.skip(...) }` swallowing any errors from crypto,
  telephony, or relay bootstrap. If the step is expected to work in CI, make
  it fail loudly.
- `if (!ringEvent) test.skip('no event received')` on Nostr — always assert
  with `expect().toBeDefined()` instead. (PR #135.)
- Fixture-state skips like "all checklist items done, nothing to test" — if
  the fixture can reach a state where the test is meaningless, reset the
  fixture. (PR #137.)

## Infrastructure categories

Each category lists the required infra, the env flag that opts in, and the
files involved.

### 1. SIP WebRTC bridge (`TEST_SIP_WEBRTC=1`)

Requires a running Asterisk + coturn + browser-trusted TLS (dev-certs via
`scripts/dev-certs.sh`). Standard CI does not bring these up — the dev infra
is deliberately heavyweight (see `feedback_asterisk_bridge` memory) and is
covered by a separate manual validation run.

- `tests/ui/voice-e2ee-badge.spec.ts`
- `tests/ui/voice-e2ee-fallback.spec.ts`
- `tests/ui/voice-e2ee-dtls-mismatch.spec.ts`
- `tests/ui/voice-e2ee-rotation.spec.ts`
- `tests/ui/voice-e2ee-misc.spec.ts`
- `tests/ui/sip-browser-calling.spec.ts`

Each suite skips at the top of `test.describe` when `TEST_SIP_WEBRTC !== '1'`.

### 2. Asterisk ARI bridge (`TEST_ASTERISK_BRIDGE=1`)

Requires `asterisk-bridge` running against a real Asterisk ARI. Running
`asterisk-bridge` without Asterisk crashes the host (memory constraints —
see `feedback_asterisk_bridge`). Keep gated and run in a dedicated job.

- `tests/api/sip-webrtc.spec.ts` (token, provisioning, integration groups)
- `tests/api/simulation-asterisk.spec.ts` (Asterisk simulation harness)

### 3. Asterisk auto-config (`isAsteriskAvailable()` runtime probe)

`tests/asterisk-auto-config.spec.ts` probes the real Asterisk instance in a
`beforeEach`. The probe exists because the test file validates configuration
round-trips against a live ARI endpoint — there is no synthetic fixture. Safe
to leave as-is for the same reason as category 2: never run without Asterisk.

### 4. Live Twilio (`TWILIO_ACCOUNT_SID` + staging creds)

`tests/live/telephony.spec.ts` hits the real Twilio API and costs money per
run. It is deliberately excluded from CI and only runs on demand via the
`test:live` target. The in-file `!hasLiveCreds` skip is the opt-in gate.

### 5. Screenshot capture (`!CI`)

`tests/ui/capture-screenshots.spec.ts` skips **inside** CI. Its job is to
produce marketing/site screenshots on a developer's machine — the opposite
of a conditional-in-CI skip. Leave as-is.

### 6. WebAuthn runtime gaps (context-level)

Two cases remain in `tests/ui/webauthn-passkeys.spec.ts`:

- Line 38: non-Chromium project skip. This file was written to be portable
  across browsers; unlike `webauthn.spec.ts` (which hard-fails because CI
  only runs Chrome — see PR #138), this file exists as a cross-browser
  sanity check for future multi-browser runs.
- Lines 285, 346: Playwright's virtual-authenticator context occasionally
  reports "unavailable in this context" mid-flow when the CDP session is
  torn down by navigation. These two tests guard against that specific CDP
  bug, not environment absence.

If the multi-browser project is never enabled, the first skip can be deleted.
Revisit when browser matrix expands.

## Follow-up candidates

Skips we **considered** but left alone (with the reason):

None at the moment — after PRs #133–#139 everything that looked like a
defensive skip has been triaged. If you find one, add it to this section
before you commit the skip.

## Rule

> A `test.skip(...)` that is not covered by a category above is a bug.

If you need to gate a test on infrastructure, add it to this doc in the same
commit as the skip. If you need to gate a test on feature readiness, delete
the test and open an issue for the feature instead.
