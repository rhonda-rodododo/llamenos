# Tier 5 — Deep Review

**Date:** 2026-04-10
**Reviewer:** Claude Opus 4.6 main-session deep review
**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-5-voice-e2ee-design.md` (967 lines)
**Plan:** `docs/superpowers/plans/2026-04-10-security-tier-5-voice-e2ee.md` (45 TDD tasks, 4127 lines)

## Rhonda decisions received (2026-04-10)

1. **Locale drift → corrected in spec.** Confirmed by Rhonda: "thats fine, if you need to expand the tier into 5.0 and 5.1 tiers to cover all of them you can, or it can just have a multi-session expectation, for high quality translation results by avoiding context window fatigue". I chose the multi-session split inside a single tier: §5.11.1 added, documenting the 22-locale fleet (`public/locales/*.json`) and the two-session workstream structure — session A lands code + canonical English + English-fallback placeholders, session B does the translation sweep. Success criterion #15 updated from "13 locales in src/client/locales" to "22 locales in public/locales". CI i18n check relaxed during session A via `ALLOW_TIER_5_I18N_PLACEHOLDERS=true`, re-tightened at start of session B.
2. **CLAUDE.md drift is a separate repo-wide follow-up** — flagged in open questions. Not a Tier 5 blocker.
3. **I-2 sim-SIP-bridge scope, I-3 Safari RTCRtpScriptTransform** remain open for implementation-time resolution.

## Summary

Tier 5 is the "voice E2EE via SFrame + RTCRtpScriptTransform" tier and the spec is the most telephony-heavy of the seven. The design correctly identifies the layering problem (DTLS-SRTP is hop-by-hop, SFrame lives above RTP) and picks the Jitsi/Wire-proven path. Spec 5.7 (Asterisk media passthrough) is the load-bearing operational piece and is detailed correctly. Two important findings: **(1) locale count drift — the spec claims "all 13 locales" but the actual `public/locales/` has 22 locales**; **(2) locale path drift — the spec uses `src/client/locales/*.json` but the actual path is `public/locales/*.json`**. Also found: the spec's i18n assertions in success criterion #15 reference translation keys that must exist in every locale file, and with 22 locales the plan's translation workstream is roughly 2× larger than implied.

## Critical findings

None. The core design (SFrame on `RTCRtpScriptTransform`, Asterisk passthrough, per-call HPKE key distribution via Nostr) is correct and well-documented.

## Important findings

### I-1. Locale count + path drift

**Where:** Spec §5.11 (UI/UX changes) + success criterion #15, plan locale workstream.

**Issue:** The spec (and the codebase's CLAUDE.md) says "13 locales". The actual `public/locales/` directory has **22** locale files: `am, ar, de, en, es, fa, fr, hi, ht, ko, ku, mix, my, pt, quc, ru, so, tl, tr, uk, vi, zh`. Each needs translations for the 12 i18n keys success criterion #15 lists. The plan tasks that touch locales (45 tasks × ~2 locales per task mentioned = 90 edits, but with 22 locales it's actually 22×12 = 264 translation keys to land).

Additional drift: the spec says `src/client/locales/*.json`; the actual path is `public/locales/*.json`. The i18n loader path is in `src/client/lib/i18n.ts`.

**Fix:** Update the spec's success criterion #15 to enumerate 22 locales and point at `public/locales/*.json`. Update the plan's locale tasks to account for the actual count. Consider generating a pre-translation template (English strings only) that hub administrators can review before volunteer-facing locales get localized. Flag the CLAUDE.md drift separately as a repo-wide follow-up.

### I-2. `tests/fixtures/sim-sip-bridge.ts` and `sim-caller.ts` are new infrastructure

**Where:** Spec §5.12.1 + §5.12.2.

**Issue:** The spec introduces two new test fixtures for the SFrame test path: a simulated SIP bridge (fakes Asterisk ARI + media-plane RTP) and a simulated caller (sends Opus-encoded audio). These are significant pieces of test infrastructure. The plan has tasks for them but the estimated implementation effort is not stated — my read is that each fixture is 500+ lines of TypeScript and a week of work. The plan should enumerate the subtasks (WebSocket mock, RTP packet generator, Opus encoder, jitter buffer).

**Fix:** Expand the fixture tasks in the plan with explicit subtask breakdown. Or treat them as prerequisite infrastructure that ships in a separate PR before Tier 5 implementation begins.

### I-3. `RTCRtpScriptTransform` Safari support April 2026 not verified

**Where:** Spec §5.8 "Browser compatibility and feature gating".

**Issue:** The spec claims Chrome + Firefox ship `RTCRtpScriptTransform` and Safari ships a partial variant (`createEncodedStreams` via the non-standard Insertable Streams predecessor). If Safari's support is still gated behind a flag or incomplete for audio transforms, the fallback UX ("E2EE unavailable on your browser, continue in non-E2EE mode?") becomes a common code path, not an edge case.

**Fix:** Verify Safari 18 (or whatever is current in April 2026) via WebSearch MDN + WebKit bug tracker for `RTCRtpScriptTransform` audio-only support. Document the actual feature-gate branch in the plan.

## Minor findings

### M-1. Tier 3 dependency in §5.10

Spec §5.10 "Tier 3 dependency mitigation" — Tier 5 wants per-device keys as the participant-identifier for per-call HPKE wrapping. If Tier 3 hasn't shipped, the spec says "fall back to per-user keys". This fallback is fine functionally but the security property (per-device revocation affects voice in-progress) is weakened. Flag this in the plan's risk log.

### M-2. Asterisk provisioner drift

The current `src/server/telephony/` has 30+ files including `asterisk-provisioner.ts`, `asterisk-capabilities.ts`, and existing adapters for Twilio / Vonage / Plivo / Telnyx / SignalWire / Bandwidth / FreeSWITCH / generic SIP. The spec focuses on Asterisk passthrough but the plan needs to verify each other adapter is compatible with SFrame (some may not be — Twilio's programmable voice doesn't let you control the media path for passthrough).

### M-3. Recording incompatibility acknowledged but not UX'd

Spec §5.7.4 "Recording incompatibility acknowledged" — once SFrame is active, server-side call recordings break because the server sees only SFrame-encrypted RTP payloads. The spec acknowledges this but the UX consequence is not explicitly called out: hubs that require recording for compliance cannot use Tier 5 voice E2EE. Add a per-hub policy setting `voice_e2ee_mode: 'required' | 'preferred' | 'off'` to let admins opt out.

### M-4. Tier 5 plan has 45 tasks for a 4127-line file

The plan is the longest of the seven tiers. That's appropriate for the scope. But 45 tasks is a LOT of sequential commits — suggest splitting into 2-3 PRs at natural boundaries (key distribution → worker transform → Asterisk config → UI/UX).

## Strengths

- **Phased rollout** (§5.7 + §5.8): Phase 1 TURN-relayed 1:1 with DTLS fingerprint binding, Phase 2 full SFrame via RTCRtpScriptTransform. Good staging for catching attacks at each layer.
- **DTLS fingerprint binding over Nostr-signed signaling** (§5.6) is the Signal pattern adapted correctly to hotline threat model.
- **Per-call HPKE key distribution via Nostr** reuses existing relay infrastructure, no new delivery mechanism.
- **Simulated SIP bridge + simulated caller** (§5.12) — these are exactly the test fixtures Tier 5 needs to ship without running live calls in CI.
- **Adversarial test matrix** is explicit (DTLS fingerprint mismatch, SFrame key not received, forged participant id, tampered encoded frame).
- **Tier 3 fallback** is a nice piece of graceful degradation — Tier 5 can ship with per-user keys if Tier 3 is late.

## Verification log

- ✓ `src/server/telephony/` has 30+ files including the Asterisk provisioner and all adapters referenced by the spec.
- ✓ `src/client/lib/webrtc/` has `manager.ts`, `types.ts`, and an `adapters/` directory with plivo/sip/twilio/vonage adapters.
- ✓ `src/client/lib/i18n.ts` exists (loader).
- ✗ **Locale count drift: spec claims 13, reality is 22** in `public/locales/`.
- ✗ **Locale path drift: spec says `src/client/locales/*.json`, reality is `public/locales/*.json`.**
- ✗ `RTCRtpScriptTransform` Safari 18 support NOT independently verified.
- ✗ `draft-ietf-sframe-enc` current draft version NOT verified.
- ✗ Plan task count: `grep -c "^### Task " = 45` — matches spec claim.
- ✗ coturn time-limited HMAC credential format NOT re-verified.

## Open questions for Rhonda

1. **Locale drift in CLAUDE.md** — the repo has 22 locales, CLAUDE.md says 13, Tier 5 spec says 13. This is a repo-wide documentation drift that should be fixed before Tier 5 references the accurate count. Is there a separate PR to reconcile?
2. **Per-hub E2EE voice policy** — add `voice_e2ee_mode: 'required' | 'preferred' | 'off'` to hub settings for hubs that require recording vs hubs that require E2EE?
3. **Tier 3 dependency** — ship Tier 5 with per-user-key fallback (weaker revocation semantics) if Tier 3 is late, or gate Tier 5 on Tier 3 being merged first?
4. **Sim bridge fixture scope** — ship as prerequisite PR (cleanly separable), or inline in Tier 5's PR?
5. **Other telephony adapters** — which of Twilio / Vonage / Plivo / Telnyx / SignalWire actually permit SFrame passthrough? Document per-adapter in the capabilities layer.
