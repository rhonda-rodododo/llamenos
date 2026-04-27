---
title: Web E2EE Server Compromise Mitigation (v1 Interim)
status: draft
date: 2026-04-27
---

# Web E2EE Server Compromise Mitigation (v1 Interim)

**Date:** 2026-04-27
**Status:** Draft
**Context:** Signal cryptographer review identified fundamental flaw in web E2EE trust model
**Prerequisite reading:** `docs/security/THREAT_MODEL.md`, `docs/security/spec-briefs/tier-4-delivery-hardening.md`

---

## 1. Problem Statement

Every web application downloads its code from a server on each page load. For an E2EE web app, this creates a fundamental contradiction: the application claims to protect data from the server, but the server controls which code runs on the client. A compromised server (or one coerced by legal process) can serve modified JavaScript that silently exfiltrates keys, plaintext, or session material before the user's cryptographic defenses engage.

This is not a bug in Llamenos. It is a structural property of the web platform. Emily Stark (Chrome security team) articulates it precisely: "there is no long-term trustable notion of what 'the application' is" on the web, because application code is downloaded afresh on approximately each connection.

### What a compromised server can do

1. Serve modified JavaScript to one targeted user (Selective Malicious Code Delivery / SMCD)
2. Exfiltrate the identity private key from the crypto worker closure
3. Exfiltrate plaintext after decryption but before rendering
4. Exfiltrate the hub AES-GCM key
5. Serve a modified service worker that persists the compromise across page loads
6. Disable or neuter the binary verifier, gossip attestation, or any client-side detection

### What existing Tier 4 infrastructure provides

Llamenos already has significant detection infrastructure (see Tier 4 spec brief):

| Layer | Mechanism | Limitation |
|-------|-----------|------------|
| Binary verifier | Ed25519 signature verification of release manifest | Self-referential: depends on itself not being tampered |
| Split-origin CSP | Crypto iframe at separate origin, `connect-src 'none'` | Requires compromising two origins, but both are web-served |
| Reproducible builds | `SOURCE_DATE_EPOCH`, cosign, SBOM, `verify-build.sh` | Post-hoc verification; does not prevent execution |
| Fleet gossip | Clients publish bundle hash to Nostr relay | Detection after the fact; targeted SMCD hard to catch |
| Third-party verifiers | Allied orgs verify and publish verdicts | Delay between deploy and detection |
| Service worker SRI | Precached assets validated against integrity hashes | SW itself auto-updates silently; first install unverified |
| Warrant canary | Regular signed statements | Social/legal signal only |

**The honest assessment**: These layers make mass SMCD detectable and raise the cost of targeted SMCD. But they do not prevent a first-load compromise, and they are self-referential (the server delivers the verifier that verifies the server's code).

---

## 2. Strategic Direction: Native Clients Are the Answer

### Why browser extensions are not the path forward

Research into browser extension approaches (WEBCAT, WhatsApp Code Verify, custom extensions) revealed that the mobile coverage matrix is fundamentally broken:

| Platform | Extension support | Pre-execution blocking | Market share |
|----------|------------------|----------------------|-------------|
| Firefox Android | Full (`webRequest` blocking) | Yes | ~2% |
| Safari iOS | Partial (`declarativeNetRequest` only) | No (detection only) | ~27% |
| Chrome Android | None | No | ~65% |
| iOS Chrome/Firefox | None (WebKit forced) | No | ~5% |

Building and maintaining two extension codebases (Firefox MV2 + Safari Web Extension) for AMO and App Store distribution would provide pre-execution protection to ~2% of mobile users. The remaining ~98% would still rely on the service worker (TOFU) and the self-referential binary verifier. This is excessive engineering for marginal security improvement.

**Every serious E2EE application has reached the same conclusion:**

| App | Approach | Mobile story |
|-----|----------|-------------|
| **Signal** | Native apps only | No web client for messaging |
| **WhatsApp** | Code Verify extension (desktop only) | No mobile web E2EE client |
| **ProtonMail** | Web + native apps | Acknowledges web client is the weak link |
| **Element/Matrix** | WEBCAT integration (alpha, Firefox only) | Native apps for mobile |
| **Bitwarden** | WEBCAT integration (alpha, Firefox only) | Native apps for mobile |

The pattern is clear: **native clients are the real solution**. The v2 platform (`llamenos-platform`) ships Tauri for desktop and will ship native iOS and Android clients. The web client is a transitional tool, not the long-term security-critical path.

### v1 interim strategy

Rather than building an extension ecosystem that will be superseded by native clients, the v1 web client should:

1. **Harden the service worker** -- highest-impact, lowest-cost change for all platforms
2. **Integrate Sigstore** -- strengthens the release signing pipeline (benefits native builds too)
3. **Document the web trust gap honestly** -- so users in high-threat environments know to wait for native clients or use the desktop Tauri app

---

## 3. Threat Model Scope

### In scope (v1 interim mitigations)

- **Server compromise**: Attacker gains write access to the web server or CDN
- **Legal compulsion**: Court order requiring modified code delivery
- **Service worker poisoning**: Malicious SW update persisting compromise

### Out of scope

- **Browser zero-days**: No web-layer mitigation helps
- **OS-level compromise**: Keyloggers, screen capture, memory inspection
- **Network-level TLS interception**: Addressed by HSTS preload + CT (separate concern)
- **Desktop clients**: Addressed by Tauri native wrapper in v2
- **Native mobile clients**: Addressed by v2 platform (iOS + Android)

---

## 4. Phase 1: Service Worker Hardening

The single highest-impact change for v1. Protects all returning users on all platforms.

### 4.1 Switch from `autoUpdate` to `prompt`

**Current state:** `vite-plugin-pwa` configured with `registerType: 'autoUpdate'` -- the weakest possible mode. A compromised server can silently replace the service worker and all cached assets.

**Change:** Switch to `registerType: 'prompt'` with manifest verification before update activation.

**Behavior after change:**
- When a new SW version is detected, the user sees a prompt with current and new version numbers
- The SW verifies the new version's manifest signature before offering the update
- User explicitly accepts or defers the update
- If verification fails: stays on current version, alerts the user

**UX impact:** Users must explicitly accept updates. This is a deliberate trade-off -- security over convenience.

### 4.2 Manifest-verified caching

Transform the SW from a performance cache into a verification cache:

1. On install (first load or accepted update), the SW fetches the signed release manifest
2. Verifies the manifest signature (Ed25519, migrating to Sigstore in Phase 2)
3. For each resource in the manifest, fetches content and computes SHA-384
4. Only caches resources whose hashes match the manifest
5. Subsequent page loads are served from the verified cache
6. Cache misses: fetch from network, verify hash, cache if valid, refuse if mismatch

### 4.3 Self-verification on update

When the browser detects a new SW version (byte-for-byte diff on the SW script):

1. The current (trusted) SW intercepts the update flow
2. Fetches the new SW script and computes its hash
3. Verifies the hash against the signed manifest
4. Only allows activation if verification passes
5. If verification fails: stays on current version, alerts the user, publishes divergence to fleet gossip

### 4.4 Anti-downgrade protection

The SW refuses to install a manifest with a version number lower than the current one. Prevents an attacker from serving an older (vulnerable) version.

### 4.5 Eviction recovery

iOS Safari aggressively evicts SW caches under storage pressure. After eviction:

- Next load is equivalent to a first load (TOFU)
- The SW re-fetches the manifest and re-verifies all resources
- This is an inherent limitation of the web platform on iOS -- documented honestly

### 4.6 Implementation files

| File | Change |
|------|--------|
| `vite.config.ts` | Change `registerType` to `'prompt'`, update workbox config |
| `src/client/lib/sw-register.ts` | New: SW registration with update prompt logic |
| `src/client/lib/sri-workbox-plugin.ts` | Extend: manifest verification in SW install/activate |
| `src/client/components/sw-update-prompt.tsx` | New: UI component for update consent |

---

## 5. Phase 2: Sigstore Integration

Strengthens the release signing pipeline. Benefits both the web client and future native clients.

### 5.1 Why Sigstore over standalone Ed25519

| Property | Current Ed25519 | Sigstore |
|----------|----------------|----------|
| Identity binding | Key only (who holds it?) | OIDC identity (tied to GitHub Actions workflow) |
| Transparency | None (trust the key) | Public Rekor log (every signing event auditable) |
| Key management | Must protect and rotate a private key | Keyless (ephemeral signing via OIDC) |
| Verification | Requires pinned public key | Verify against OIDC identity + transparency log |
| "Who watches the watcher" | Nothing | Rekor log -- a malicious signing leaves evidence |

### 5.2 Architecture

1. **CI/CD signing**: GitHub Actions release workflow signs the release manifest using `sigstore-js`. The signing identity is the GitHub Actions OIDC token, binding the signature to the repo, workflow file, and commit SHA.

2. **Transparency log**: Every signing event is recorded in Sigstore's Rekor log. Append-only, publicly auditable.

3. **Browser-native verification**: Use Tinfoil's `sigstore-browser` (~50KB) for in-browser Sigstore verification via WebCrypto. This supplements (and eventually replaces) the current Ed25519 verification in the binary verifier.

4. **Ed25519 retained as fallback**: For offline/air-gapped verification and as a transition period backup.

### 5.3 Implementation files

| File | Change |
|------|--------|
| `.github/workflows/release.yml` | Add Sigstore signing step, publish to Rekor |
| `src/client/lib/binary-verifier.ts` | Add Sigstore verification path alongside Ed25519 |
| `src/shared/schemas/gossip-version.ts` | Extend `SignedReleaseManifest` with Sigstore certificate chain |

---

## 6. Phase 3: Honest Documentation

Update the security documentation to clearly communicate the web trust gap and the path forward.

### 6.1 Threat model update

Add a "Web Trust Gap" section to `docs/security/THREAT_MODEL.md`:

- Acknowledge the fundamental limitation of web-delivered code
- Document what the SW hardening and Sigstore integration provide (and don't)
- State that native clients (v2) are the intended long-term solution
- Recommend the desktop Tauri app for users in high-threat environments until native mobile ships

### 6.2 Whitepaper update

Add a section to `docs/security/WHITEPAPER.md` covering:

- The web trust problem and industry-wide approaches
- Llamenos' interim mitigations (SW hardening, Sigstore, fleet gossip, reproducible builds)
- The v2 native client roadmap as the definitive answer
- Honest comparison table: web client vs native client security properties

### 6.3 Onboarding guidance

Surface security tier information during volunteer onboarding:

- If on desktop: recommend the Tauri app
- If on mobile: explain that the web client provides detection-level protection, native apps are coming
- Link to the security documentation for users who want the full picture

### 6.4 Implementation files

| File | Change |
|------|--------|
| `docs/security/THREAT_MODEL.md` | Add "Web Trust Gap" section |
| `docs/security/WHITEPAPER.md` | Add web trust discussion + native client roadmap |
| Onboarding components | Add security tier guidance (deferred to v2 onboarding flow) |

---

## 7. Limitations and Honest Assessment

### What v1 interim mitigations provide

1. **Service worker hardening**: Protects all returning users on all platforms via TOFU. A compromised server cannot silently update the SW or cached resources. Users must consent to updates. This is the strongest web-native defense available.

2. **Sigstore integration**: Makes release signing publicly auditable. A compromised build pipeline that signs a malicious manifest leaves evidence in the Rekor transparency log. This strengthens the "who watches the watcher" problem.

3. **Combined with existing Tier 4**: Fleet gossip detects mass SMCD within minutes. Reproducible builds allow independent verification. Split-origin CSP forces attackers to compromise two origins.

### What v1 interim mitigations do NOT provide

1. **First-load protection**: If a user's first visit occurs while the server is compromised, they receive malicious code. No web-only mechanism can prevent this.

2. **iOS cache eviction recovery**: iOS Safari evicts SW caches aggressively. After eviction, the next load is unprotected TOFU.

3. **Prevention of targeted single-load SMCD**: If the attacker serves malicious code to one user for one page load, detection depends on timing and gossip coverage.

4. **An independent trust anchor**: The SW, the verifier, and the signing verification code are all delivered by the server on first load. This circularity is the fundamental web trust problem. Sigstore adds external auditability but not a runtime trust anchor.

### Honest comparison

| Property | Native App (v2) | Web + Hardened SW (v1) |
|----------|----------------|----------------------|
| First-load trust | App Store + code signing | None (TOFU) |
| Update verification | OS verifies signature | SW verifies manifest (self-referential on first load) |
| Targeted SMCD resistance | Strong | Weak (detection, not prevention) |
| Persistence of trust | App stays installed | SW can be evicted (especially iOS) |
| Independent trust anchor | Apple/Google | Sigstore (audit trail, not runtime enforcement) |

**The honest conclusion**: The v1 web client with these mitigations provides meaningful detection and raises the cost of attack significantly. But it cannot match native app trust guarantees. Native clients (v2 Tauri desktop + future iOS/Android) are the definitive answer. The v1 mitigations buy time while v2 ships.

---

## 8. Research Appendix

This section preserves the research findings for future reference. The browser extension approaches documented here were evaluated and deliberately deferred in favor of native clients.

### Browser extension landscape (evaluated, deferred)

- **WEBCAT** (Freedom of the Press Foundation, IACR 2025/797): Blocking code verification via Sigstore. Firefox-only (MV2). Strongest web-based solution but limited to ~2% of mobile users. Integrated with Element, Bitwarden, Jitsi, GlobaLeaks.
- **WhatsApp Code Verify**: Desktop-only. Validates the extension pattern but no mobile version.
- **Firefox Android**: Only mobile browser with full `webRequest` blocking. Mozilla has no plans to deprecate MV2.
- **Safari iOS extensions**: `declarativeNetRequest` only -- detection, not prevention. No `webRequest`.
- **Firefox iOS**: No extension support. WebKit forced (except EU DMA, where Gecko hasn't shipped).
- **Chrome Android**: No extension support at all.

### Platform approaches (evaluated, not viable for v1)

- **Trusted Web Activities (TWA)**: Play Store distribution but no content integrity -- web content still fetched from server each load.
- **Isolated Web Apps (IWA)**: Architecturally correct (signed Web Bundles) but ChromeOS-only, no mobile timeline.
- **Signed HTTP Exchanges (SXG)**: Chrome-only, declining ecosystem (Cloudflare deprecated Oct 2025).
- **Import Maps with integrity**: Chrome 127+, Safari 18+. Protects against CDN tampering but not origin compromise.

### Web platform proposals (monitoring)

- **Source Code Transparency** (Daniel Huigens / Proton, W3C WICG): Transparency log for web app code hashes. No browser implementation yet. The right long-term direction.
- **Binary Transparency for web** (WAIT paper): Extends Android Binary Transparency to web. Concept stage.

---

## 9. References

### Academic and Industry Papers

- Berra, G. (2025). "WEBCAT: Web-based Code Assurance and Transparency." IACR ePrint 2025/797.
- Sutter, T. & Berlich, P. (2021). "Web Content Signing with Service Workers." arXiv:2105.05551.
- Stark, E. (2023). "E2EE on the web: isolating plaintext."
- Stark, E. (2024). "E2EE on the web: is the web really that bad?"
- Huigens, D. (2023). "Source Code Transparency." W3C Secure the Web Forward Workshop.

### Production Implementations

- WhatsApp Code Verify (Meta, 2022)
- WEBCAT alpha (SecureDrop / Freedom of the Press Foundation)
- Proton Key Transparency
- Sigstore browser-native verification (Tinfoil, 2025)

### Existing Llamenos Infrastructure

- Tier 4 spec brief: `docs/security/spec-briefs/tier-4-delivery-hardening.md`
- Threat model: `docs/security/THREAT_MODEL.md`
- Binary verifier: `src/client/lib/binary-verifier.ts`
- Security whitepaper: `docs/security/WHITEPAPER.md`
- Supply chain: `docs/security/SUPPLY_CHAIN.md`
