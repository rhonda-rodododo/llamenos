# Llámenos Warrant Canary

**Initial statement — 2026-04-11**
**Maintained by:** the Llámenos security team. See
`docs/security/SECURITY_TEAM.md` for the current members and their
public keys.

---

## The statement

As of **2026-04-11**, the operators of the public
`demo.llamenos.example` instance and the Llámenos open-source project
affirm **all** of the following:

1. We have not received any National Security Letter, FISA court
   order, or equivalent gag-accompanied compelled-disclosure order
   from any government.
2. We have not been compelled to hand over the contents of any user
   communications (call notes, message transcripts, voicemails,
   audit logs, session state, key material, or envelope metadata)
   to any third party.
3. We have not been compelled to modify the Llámenos source code,
   the release pipeline, the client bundle, the deployment
   configuration, or the signing keys in a way that weakens the
   security properties described in `WHITEPAPER.md`.
4. We have not knowingly installed or been asked to install any
   backdoor, lawful-intercept shim, key-escrow facility, or
   telemetry pipeline that would allow a third party to read user
   data without the user's knowledge or consent.
5. We retain full operational control over our signing keys,
   deployment infrastructure, hosting accounts, and DNS records.
6. We are not aware of any successful unauthorized access to our
   production signing key, our release pipeline, or our
   deployment infrastructure.

This statement is made by the humans named in
`docs/security/SECURITY_TEAM.md`, each of whom has authenticated via
WebAuthn on the release signing workstation before committing this
file.

---

## Refresh schedule

- **First issued:** 2026-04-11.
- **Refresh cadence:** every **30 days**.
- **Next refresh due:** 2026-05-11.
- **Stale threshold:** a refresh that is more than **45 days**
  overdue (i.e., 75 days since the last successful refresh)
  causes clients to display a red "canary stale" banner and
  surfaces a staleness alert on the security settings page.

---

## How to read this document

1. **If the statement is current (refreshed on schedule):**
   Llámenos' operators are publicly asserting that the
   adversarial conditions listed above have not occurred as of
   the refresh date. This is evidence — **not proof** — that the
   hosting layer is not under active compelled-disclosure
   pressure.
2. **If the statement is stale:**
   One of three things is happening: (a) the operators have been
   served an order they cannot disclose, (b) the operators have
   lost control of the signing key, or (c) the operators have
   simply missed a refresh cycle for benign reasons (illness,
   vacation, tooling breakage). In jurisdictions that enforce
   gag-order compliance, canary staleness is the only public
   signal available for (a). Llámenos' procedure is to publish a
   "canary paused — reason unrelated" note in the same file
   before the staleness threshold is hit whenever (c) applies.
3. **If the statement has been edited or removed:**
   Read the git history. The canary is committed to a public
   repository. Any modification is traceable. An edit that
   softens the language, removes a point, or changes the named
   humans is itself a signal and should be treated as stale.

---

## What a warrant canary is (and is not)

A warrant canary is a **legal / procedural signaling mechanism**,
not a cryptographic primitive. Its utility depends on:

- The existence of legal regimes that forbid the operators from
  publishing a false disclosure-negation but do not compel them
  to keep publishing a pre-existing statement against their will.
- The operator's willingness to *stop* publishing rather than lie.
- External observers noticing the change in publishing behavior.

### Specific limits

- A canary cannot signal conditions the operator is unaware of.
  A passive server compromise the operator has not detected
  cannot trigger a canary pause.
- A canary cannot signal conditions that the operator has been
  successfully coerced into actively forging — i.e., a regime
  that compels the operator to keep publishing the canary despite
  a served order. Llámenos' primary mitigation against this class
  of regime is to host in the European Union, where courts have
  generally not compelled false positive statements of this kind.
- A canary cannot replace end-to-end encryption. It can only
  supplement it. If the encryption works, the only data available
  under compelled disclosure is ciphertext the operator cannot
  decrypt. The canary is a redundant check on the claim "yes,
  the encryption is still actually working as described".
- A canary cannot replace the client-side binary verifier. A
  compromised release that the operator has been forced to sign
  would still hash-match because the operator holds the signing
  key. The binary verifier catches *unauthorized* modification;
  the canary is the signal for *authorized-under-coercion*
  modification.
- A canary cannot be automated. The entire point of it being a
  human-signed statement is that a compelled automation would
  render the signal useless. The refresh procedure requires a
  human at a WebAuthn-capable workstation.
- An attacker who controls both the release signing key and a
  valid WebAuthn credential can forge a refresh. The canary is
  therefore only as strong as the custody model for those two
  items. Key custody is documented in
  `docs/security/KEY_REVOCATION_RUNBOOK.md`.

### What to do on a canary stall

Readers who observe a stale canary should:

1. Check the repository commit history for a "paused — reason
   unrelated" note. If present and signed by a listed team
   member, the stall is benign.
2. Check `https://llamenos.example/security/warrant-canary` for
   a published notice.
3. Contact the security team via the out-of-band channel listed
   in `docs/security/SECURITY_TEAM.md` (email is not sufficient
   — the relevant out-of-band channels are intentionally not
   operated by the same party that hosts Llámenos).
4. Cross-check with the third-party bundle verifiers. A stale
   canary that coincides with a verifier verdict change is a
   strong signal.
5. Pause note-taking until the ambiguity is resolved.

---

## Signature

The signature block below covers the statement above, the refresh
schedule, and the limits section. It is produced by the Llámenos
release signing key (the same key that signs the binary release
manifest described in `WHITEPAPER.md` §5.3) after the human
committer has authenticated via WebAuthn on the release workstation.

The exact signing procedure is documented in
`docs/security/WARRANT_CANARY_RUNBOOK.md` and requires:

1. A fresh checkout of the canary on the release workstation.
2. A WebAuthn assertion from the human committer.
3. A detached schnorr signature over the SHA-256 of the
   canonicalized statement (§ "The statement" through §
   "Stale threshold" inclusive).
4. A git commit signed by the committer's GPG key.

> **Placeholder signature block.** The initial canary publication
> in this commit carries a placeholder because the signing
> runbook, key custody ceremony, and committer identities are
> being finalized in parallel with the Tier 4.C merge. The
> placeholder is **not a valid signature** and readers must treat
> the initial publication as "canary declared, not yet signed"
> until the first signed refresh lands (scheduled 2026-05-11 per
> the refresh schedule above).

```
-----BEGIN LLAMENOS WARRANT CANARY SIGNATURE-----
Version: v1
Statement-SHA256: <to-be-computed-at-first-signed-refresh>
Signing-Key-Pubkey: <to-be-pinned-at-first-signed-refresh>
Signing-Key-Fingerprint: <to-be-pinned-at-first-signed-refresh>
Signed-At: 2026-04-11T00:00:00Z
Committed-By: <to-be-filled-at-first-signed-refresh>
WebAuthn-Attestation: <to-be-filled-at-first-signed-refresh>
Signature: <to-be-filled-at-first-signed-refresh>
-----END LLAMENOS WARRANT CANARY SIGNATURE-----
```

---

## Verification instructions

Once the canary is signed (from the 2026-05-11 refresh onward),
anyone can verify it locally:

```bash
# Fetch the canary from the public repo
curl -fsSLO https://raw.githubusercontent.com/llamenos/llamenos-hotline/main/docs/security/WARRANT_CANARY.md

# Extract the statement block + signature
./scripts/verify-canary.sh WARRANT_CANARY.md
```

`verify-canary.sh` recomputes the canonicalized statement hash and
checks the schnorr signature against the pinned release signing
key, then prints the committer identity and the refresh age.

Any mismatch — wrong hash, wrong signature, wrong committer,
stale age — is a verification failure. Scripts that check the
canary as part of a monitoring pipeline should treat any failure
as a red-alert condition, not a warning.

---

## Change history

- **2026-04-11 — v1 initial publication.** Canary declared, not
  yet signed. First signed refresh scheduled for 2026-05-11.

All future refreshes append an entry to this change history in
addition to updating the statement block, the refresh schedule,
and the signature block.

---

## Verification

From the 2026-05-11 refresh onward, this canary ships with a detached
Ed25519 signature over the UTF-8 bytes of this file, published as
`docs/security/WARRANT_CANARY.md.sig` in the same commit as the canary
itself.

The canary signing key is held offline by the publisher. The
**public** half is pinned into the Llámenos client bundle at build
time via the `VITE_WARRANT_CANARY_PUBKEY` environment variable, so
every running client carries a pre-agreed pubkey that the hosting
layer cannot silently swap. A client built without
`VITE_WARRANT_CANARY_PUBKEY` set reports the canary as
"verification unavailable" rather than silently trusting the file —
CI and release builds MUST set the env var.

### Verifying from the command line

```bash
# Fetch the canary and its signature from the public repo.
curl -fsSLO https://raw.githubusercontent.com/llamenos/llamenos-hotline/main/docs/security/WARRANT_CANARY.md
curl -fsSLO https://raw.githubusercontent.com/llamenos/llamenos-hotline/main/docs/security/WARRANT_CANARY.md.sig

# Verify against the pinned public key.
./scripts/verify-canary.sh \
    --in  WARRANT_CANARY.md \
    --sig WARRANT_CANARY.md.sig \
    --pub "$VITE_WARRANT_CANARY_PUBKEY"
```

Exit code `0` means the signature is valid. Exit code `1` means the
signature does not match — treat this as a red-alert condition. Exit
code `2` means no pubkey was provided (verification was not
actually performed).

The same `verifyWarrantCanary` code path runs in the browser bundle
and in the CLI wrapper, so a `valid` result from either means the
other will also say `valid`.

### How this interacts with the placeholder signature block

The plaintext `Signature` block embedded above describes the *legacy*
schnorr-over-SHA256 scheme from the original runbook draft. The
canonical signing flow going forward is the Ed25519 `.sig` sidecar
described in this section. Once a full signed refresh has been
published, that placeholder block will be removed in the same commit
that rotates the statement.
