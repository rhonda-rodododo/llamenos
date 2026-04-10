# Tier 3 — Deep Review

**Date:** 2026-04-10
**Reviewer:** Claude Opus 4.6 main-session deep review
**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-3-per-device-keys-design.md` (1432 lines)
**Plan:** `docs/superpowers/plans/2026-04-10-security-tier-3-per-device-keys.md` (48 TDD tasks)

## Summary

Tier 3 is the biggest architectural pivot in the roadmap and the spec handles it with the most detail of any tier — 11 design subsections covering device identity, PUK, sigchain, enrollment, hub-key-per-device, cross-signing, CLKR, paper keys, client state, server notes, and worker changes. The successful subagent that authored this tier did genuinely read the existing codebase (confirmed by the accurate `provisioning.ts` reference and the Tier 0 sigchain integration). Two important findings: **(1) the DAG claim in §3.3.3 "the chain is a DAG, conceptually" is not fully reconciled with Tier 0's linear-chain `prevEntryHash` design**, and **(2) CLKR is described at the right level but the "atomic rotation across multiple hubs" case for multi-hub volunteers leaves room for interpretation**.

## Critical findings

None. The device / PUK / sigchain triad is the well-known Keybase design and the spec reproduces it accurately.

## Important findings

### I-1. "Chain is a DAG, conceptually" vs Tier 0's linear chain

**Where:** Spec §3.3.3 "The chain is a DAG, conceptually".

**Issue:** Tier 0's `SignedAuditEntry` has a single `prevEntryHash` field and a strictly linear chain with server-side ordering checks. Tier 3's DAG framing — multiple devices writing concurrently to the chain and the verifier reconciling branches — is a meaningful departure. If the implementation preserves the linear chain, concurrent device writes require a server-arbitrated serialization (first write wins, others retry). If the implementation extends `prevEntryHash` to `prevEntryHashes: string[]`, the verification rules change.

**Fix:** Commit to one of the two options in the spec, not both. Recommended: keep the linear chain, serialize concurrent writes server-side with optimistic retry on the client. This preserves Tier 0's verification invariants and the DAG framing collapses to "the logical graph of device adds, but serialized on-wire".

### I-2. CLKR atomicity across multihub volunteers

**Where:** Spec §3.7.3 "Atomic rotation across multiple hubs for a device-remove".

**Issue:** A volunteer belonging to Hubs A, B, and C loses a device. The user sigchain records a single `device_revoke` entry. Every hub that has the revoked device as a key-envelope recipient must rotate its hub key. If the server crashes after rotating A but before rotating B and C, the fleet is in a split state where the revoked device still has A's old hub key (via its cached copy) and can decrypt until B and C rotate.

**Fix:** The spec acknowledges this requires atomicity. Either (a) enforce a transactional rotation across all affected hubs (implies a global lock and serialized writes — scales poorly for large multihub users), or (b) accept bounded-time inconsistency and document the window (recommended; "up to X seconds between `device_revoke` observation and all hubs rotated"). Add a subsection stating the chosen trade-off and the recovery procedure if a rotation stalls mid-flight.

### I-3. Master key in Recovery Group is Tier 2 ↔ Tier 3 coupling

**Where:** Spec §3.6.3 "Recovery Group integration".

**Issue:** Tier 3 stores the master cross-signing key in the Tier 2 Recovery Group. This means Tier 3 has a hard dependency on Tier 2 having landed first with the Recovery Group design. If Tier 2 ships without the Recovery Group (e.g. ship OPAQUE + PRF + Diceware first, Recovery Group later), Tier 3 cannot ship in its current form.

**Fix:** Confirm the tier ordering: Tier 2 ships with Recovery Group as a prerequisite for Tier 3. Or decouple: Tier 3 stores the master cross-signing key under the Diceware recovery phrase instead, and the Recovery Group is an optional upgrade.

## Minor findings

### M-1. Provisioning rooms deletion blast radius

Spec §3.4.3 "Why this beats ephemeral-ECDH-provisioning rooms" argues for replacing `src/client/lib/provisioning.ts` (256 lines, confirmed). The plan should explicitly list every caller of the old provisioning flow — there are likely React UI components (provisioning dialog), server endpoints (`/api/provision/*`), and test fixtures that all need updating in lockstep.

### M-2. Paper key vs Tier 2 recovery phrase

Spec §3.8.3 distinguishes "paper key = device" from Tier 2's "recovery phrase = KEK unwrapper". Good — they serve different purposes. But the user-facing copy needs to make this clear, otherwise a volunteer will print both and lose track. Add a UX copy deck to the Tier 3 plan that differentiates them in the onboarding flow.

### M-3. Plan task 48 is the "biggest tier" count

The spec says ~48 tasks is within the target (40–60). Confirmed. The plan does include a clear PR-boundary suggestion where tasks 1–15 ship without live per-device keys, tasks 16–48 ship the full pivot. If this PR strategy changes during implementation, the plan should be updated to reflect new boundaries.

### M-4. Tier 2 coupling risk on `provisioning.ts`

If Tier 2 ships Recovery Group first (needed for Tier 3), and Tier 2's Recovery Group implementation touches `provisioning.ts`, Tier 3's deletion of `provisioning.ts` becomes a merge conflict. Flag as a rebase concern.

## Strengths

- **Spec actually reads the current codebase** — the `provisioning.ts` reference is specific and accurate, the hub-key-manager rewrite is cited against the current 118-line file, the master doc section references are correct.
- **11 subsections under §Design** give the implementer a structured map, not a wall of text.
- **Adversarial test matrix** is explicit about the attack classes (device enrollment MITM, sigchain fork, revoke-during-rewrap race, stale cached-envelope post-rotate).
- **48 tasks with PR boundary suggestion** makes the biggest tier approachable.
- **CLKR framed as "lazy vs eager"** is the right design choice for scale; spec explains the trade-off clearly.
- **Master key recovery via Recovery Group** reuses Tier 2's design — no new recovery primitives introduced here, reducing audit surface.

## Verification log

- ✓ `src/client/lib/provisioning.ts` is 256 lines (spec's reference to replacing it is grounded).
- ✓ `src/client/lib/key-store-v2.ts` is 302 lines (same as Tier 2's reference).
- ✓ `src/client/lib/hub-key-manager.ts` is 118 lines (small; confirming spec's rewrite-in-place strategy is feasible).
- ✓ `src/server/db/schema/` contains `identity.ts` (where device tables would be added).
- ✓ Plan task count: `grep -c "^### Task " = 48` — matches spec claim.
- ✗ Keybase protocol documentation not independently re-verified (book.keybase.io is still accessible but site content may have drifted since 2020).
- ✗ Matrix cross-signing spec (spec.matrix.org/latest/client-server-api/#cross-signing) not re-verified.
- ✗ `@scure/bip39` currency not verified via context7.

## Open questions for Rhonda

1. **Linear chain vs DAG** — Tier 0 is linear. Should Tier 3 remain linear (recommended; serialize device concurrent writes via server) or extend `prevEntryHash` to an array?
2. **CLKR atomicity trade-off** — transactional all-or-nothing across hubs (complex, slow) vs bounded-time inconsistency (simple, documented)?
3. **Tier ordering** — does Tier 2 ship Recovery Group first, or can Tier 3 proceed with only PRF + OPAQUE + Diceware from Tier 2 and a Diceware-wrapped master cross-signing key as a simpler alternative?
4. **Device pubkey collision / reuse policy** — what happens if a user tries to enroll a new device whose X25519 pubkey matches a previously-revoked device's? Accept (same key, different epoch) vs reject?
5. **Paper key UX copy** — how do we make "paper key for device recovery" vs "Tier 2 recovery phrase for KEK unwrap" clear to non-technical volunteers?
