---
title: Web E2EE Server Compromise Mitigation
status: draft
date: 2026-04-27
---

# Web E2EE Server Compromise Mitigation

**Date:** 2026-04-27
**Status:** Draft
**Context:** Signal cryptographer review identified fundamental flaw in web E2EE trust model
**Prerequisite reading:** `docs/security/THREAT_MODEL.md`, `docs/security/spec-briefs/tier-4-delivery-hardening.md`

---

## 1. Problem Statement

Every web application downloads its code from a server on each page load. For an E2EE web app, this creates a fundamental contradiction: the application claims to protect data from the server, but the server controls which code runs on the client. A compromised server (or one coerced by legal process) can serve modified JavaScript that silently exfiltrates keys, plaintext, or session material before the user's cryptographic defenses engage.

This is not a bug in Llamenos. It is a structural property of the web platform. Emily Stark (Chrome security team) articulates it precisely: "there is no long-term trustable notion of what 'the application' is" on the web, because application code is downloaded afresh on approximately each connection.

Native mobile apps partially solve this through OS-mediated app stores: Apple and Google review and sign application binaries, providing an independent trust anchor between the developer and the user. Desktop apps increasingly do not have this property (Electron apps auto-update from the developer's servers, which "looks a lot more like the web's code distribution model").

**For Llamenos specifically:**

- **Desktop is addressed**: The sibling v2 repo (`llamenos-platform`) ships a Tauri native wrapper. Code-signed binaries update through a separate channel from the web server. The trust anchor is the OS + code signing certificate.
- **The gap is mobile web**: Volunteers using Android or iOS browsers have no native wrapper. They load code from the server on every visit. This spec addresses that gap.

### What a compromised server can do

1. Serve modified JavaScript to one targeted user (Selective Malicious Code Delivery / SMCD)
2. Exfiltrate the identity private key from the crypto worker closure
3. Exfiltrate plaintext after decryption but before rendering
4. Exfiltrate the hub AES-GCM key
5. Serve a modified service worker that persists the compromise across page loads
6. Disable or neuter the binary verifier, gossip attestation, or any client-side detection

### What existing Tier 4 infrastructure provides

Llamenos already has significant mitigation infrastructure (see Tier 4 spec brief):

| Layer | Mechanism | Limitation |
|-------|-----------|------------|
| Binary verifier | Ed25519 signature verification of release manifest | Depends on itself not being tampered; first load is unverified |
| Split-origin CSP | Crypto iframe at separate origin, `connect-src 'none'` | Requires compromising two origins, but both are still web-served |
| Reproducible builds | `SOURCE_DATE_EPOCH`, cosign, SBOM, `verify-build.sh` | Post-hoc verification; does not prevent execution of bad code |
| Fleet gossip | Clients publish bundle hash to Nostr relay | Detection after the fact; targeted SMCD of one device is detectable only if other devices compare |
| Third-party verifiers | Allied orgs verify and publish verdicts | Requires operational verifier infrastructure; delay between deploy and detection |
| Service worker SRI | Precached assets validated against integrity hashes | SW itself auto-updates; first install is from the server |
| Warrant canary | Regular signed statements | Social/legal signal only; no technical enforcement |

**The honest assessment**: These layers make mass SMCD detectable within minutes and raise the cost of targeted SMCD significantly. But they do not prevent a first-load compromise, and they depend on the verifier code itself not being tampered with (a circular dependency).

---

## 2. Threat Model Scope

### In scope

- **Server compromise**: Attacker gains write access to the web server or CDN serving the SPA bundle
- **Legal compulsion**: Court order requiring the hosting provider to serve modified code to a specific user (FISA 702, UK Technical Capability Notice, equivalent)
- **CDN/hosting provider compromise**: Attacker compromises Cloudflare Pages, Netlify, or equivalent static hosting
- **Targeted SMCD**: Modified code served to a single user, with all other users receiving legitimate code
- **Service worker poisoning**: Attacker serves a malicious service worker that persists compromise

### Out of scope

- **Browser zero-days**: If the browser itself is compromised, no web-layer mitigation helps
- **OS-level compromise**: Keyloggers, screen capture, memory inspection
- **Physical device access with unlocked screen**: Game over regardless
- **Network-level TLS interception**: Addressed by HSTS preload + certificate transparency (separate concern)
- **Desktop clients**: Addressed by Tauri native wrapper in v2

### Relationship to existing threat model

This spec extends `docs/security/THREAT_MODEL.md` section "Compelled runtime instrumentation" and the Tier 4 delivery hardening spec. It does not replace either document. The existing threat model's honest acknowledgment that "modifying server code to capture data before encryption (requires deployment access)" is a real attack is the starting point for this work.

---

## 3. Research Findings

### 3.1 Browser Extension Approaches

#### 3.1.1 Firefox Android Extensions

**Status: Available and capable.**

Firefox for Android (Fenix) supports the full WebExtensions API, including:
- `webRequest` API (blocking mode) -- can intercept all HTTP requests before they execute
- `declarativeNetRequest` -- declarative rule-based request modification
- Content scripts with full DOM access
- Background scripts (persistent in MV2, event-driven in MV3)

Firefox on Android has supported an open extension ecosystem since late 2023. The `webRequest` API is not deprecated in Firefox (unlike Chrome/Chromium) and Mozilla has stated it has no plans to deprecate MV2. This is a critical differentiator.

**Relevance to Llamenos**: A Firefox Android extension can intercept the initial HTML and all script loads, compute hashes, verify against a pinned manifest, and block execution if verification fails -- before any application code runs. This eliminates the bootstrap trust problem for Firefox Android users.

**Limitation**: Market share. Firefox on Android is approximately 1-3% of mobile browser usage. However, for a security-focused app serving crisis hotline volunteers, recommending a specific browser is acceptable and common practice (Signal requires its own app; ProtonMail recommends specific clients).

#### 3.1.2 Firefox iOS Extensions

**Status: Not available.**

Firefox on iOS does not support extensions. Apple requires all iOS browsers to use the WebKit engine (outside the EU), and Apple's iOS extension system is incompatible with Firefox add-ons. There is no indication this will change.

**EU exception (iOS 17.4+)**: In the EU, Apple now allows alternative browser engines under the Digital Markets Act. Firefox could theoretically ship Gecko on iOS in the EU and support extensions. As of April 2026, this has not shipped. Even if it does, it would be EU-only.

#### 3.1.3 Safari Web Extensions on iOS

**Status: Partially capable, with critical limitations.**

Safari on iOS supports Web Extensions (since iOS 15), including:
- `declarativeNetRequest` -- supported and actively maintained (Safari 18.5 shipped bug fixes in early 2026)
- Content scripts -- supported, subject to page CSP
- Background scripts -- supported (non-persistent)

**Critical limitation**: `webRequest` (blocking mode) is NOT available on iOS Safari extensions. The `declarativeNetRequest` API can block or redirect requests based on static rules, but it cannot inspect response bodies or compute hashes of served content. Content scripts run after page load, which is too late to prevent execution of malicious code.

**Workaround**: A Safari extension could use `declarativeNetRequest` to redirect the initial page load to an extension-hosted verification page, which then fetches the real page content, verifies it, and injects it into the DOM. This is fragile and has significant UX implications.

**Assessment**: Safari iOS extensions can provide detection (content script comparing DOM against expected hashes) but not prevention (cannot block script execution before it happens). This is weaker than the Firefox Android approach but still valuable as a detection layer.

#### 3.1.4 WhatsApp's Code Verify Extension

**Status: Production, desktop-only.**

Meta's Code Verify extension (open source, available for Chrome, Firefox, Edge) verifies WhatsApp Web's served code against hashes published to Cloudflare. On mismatch, it displays a red indicator.

**Architecture**: The extension fetches a root hash from Cloudflare (independent of WhatsApp's servers), then verifies every script and resource hash against it. This is essentially the same pattern as Llamenos' binary verifier, but running in a browser extension (which has a trust anchor outside the web page).

**Limitation**: Desktop-only. No mobile version. The extension model does not translate to iOS Safari (no `webRequest`). Could work on Firefox Android.

**Relevance**: Validates the extension-based verification approach. The Llamenos verifier extension should follow this pattern.

#### 3.1.5 WEBCAT (Freedom of the Press Foundation)

**Status: Alpha, Firefox-only (MV2).**

WEBCAT (Web-based Code Assurance and Transparency) is a browser extension developed by the Freedom of the Press Foundation (SecureDrop project). It provides blocking code verification: if any resource fails verification, the page does not load.

**Architecture**:
1. Developers sign an application manifest using Sigstore (OIDC identity + transparency log)
2. The browser extension intercepts page loads via `webRequest` (MV2)
3. Before any script executes, the extension verifies every resource hash against the signed manifest
4. On failure: page load is aborted entirely (fail-closed)
5. Signing operations are logged to Sigstore's Rekor transparency log

**Key properties**:
- **Blocking verification**: Unlike Code Verify (which shows an indicator), WEBCAT prevents execution. This is the correct failure mode for high-security applications.
- **Transparency log**: Sigstore integration means signing events are publicly auditable. A compromised developer who signs a malicious manifest leaves evidence in the transparency log.
- **Decentralized enrollment**: Alpha release introduced decentralized enrollment infrastructure.
- **Proven integrations**: Successfully integrated with Jitsi, Element, Bitwarden, and GlobaLeaks.

**Critical limitation**: Requires MV2 `webRequest` API. This means:
- Works on Firefox desktop and Firefox Android
- Does NOT work on Chrome/Chromium (MV3 removed blocking `webRequest`)
- Does NOT work on Safari iOS (no `webRequest`)

**Assessment**: WEBCAT is the strongest existing solution for the bootstrap trust problem on platforms that support it. Llamenos should either adopt WEBCAT directly or build a compatible extension following the same architecture. The Sigstore transparency log integration is particularly valuable -- it addresses the "who watches the watcher" problem.

### 3.2 Platform-Level Approaches

#### 3.2.1 Trusted Web Activities (TWA) on Android

**Status: Production, Android Chrome only.**

A TWA wraps a PWA in an Android app shell, published through the Google Play Store. Digital Asset Links (DAL) verify that the app and website share the same developer.

**Security properties**:
- Code is served over HTTPS (standard web security)
- DAL verification binds the app to the website via signing key
- App binary is distributed through the Play Store (Google's review + signing)

**What TWA does NOT provide**:
- No subresource integrity verification beyond standard HTTPS
- No protection against the web server serving different content to the TWA vs. direct browser access
- The web content is still fetched from the server on each load -- TWA does not bundle or sign the web content
- DAL only verifies domain ownership, not content integrity

**Assessment**: TWA provides Play Store distribution (installability, discoverability, auto-update via Play) but does NOT solve the server compromise problem. The web content is still dynamic and server-controlled. TWA is useful for distribution but not for integrity.

#### 3.2.2 Isolated Web Apps (IWA)

**Status: Early development, ChromeOS only.**

Chrome's Isolated Web Apps proposal delivers web apps as signed Web Bundles. The app is identified by its signing key, not its serving origin. This is architecturally the right solution -- it moves the trust anchor from the server to the signing key, just like native apps.

**Current limitations**:
- Available only on ChromeOS
- Not compiled for Android
- Not available on iOS/Safari
- Restricted to an allowlist of approved developers
- No timeline for mobile support

**Assessment**: IWA is the web platform's eventual answer to this problem, but it is years away from being usable on mobile. Not viable for Llamenos in the near term. Worth monitoring.

#### 3.2.3 Web Bundles / Signed HTTP Exchanges (SXG)

**Status: SXG is Chrome-only and declining; Web Bundles are early.**

- SXG is supported in Chrome 73+ but has been rejected by Firefox ("considered harmful") and Safari
- Cloudflare deprecated SXG support in October 2025
- Web Bundles are part of the IWA proposal but not independently deployable for integrity purposes
- No mobile Safari support

**Assessment**: Not viable as a standalone integrity mechanism. The ecosystem has moved away from SXG. Web Bundles may become relevant if IWA ships broadly, but that is speculative.

### 3.3 Web Platform Primitives

#### 3.3.1 Import Maps with Integrity

**Status: Shipping in Chrome 127+ and Safari 18+.**

The `integrity` field in import maps allows specifying SRI hashes for ES module imports:

```json
{
  "imports": { "./app.js": "./app-abc123.js" },
  "integrity": { "./app-abc123.js": "sha384-..." }
}
```

**Properties**:
- Browser enforces integrity before module execution
- Covers dynamically imported modules, not just static `<script>` tags
- Polyfill available via `es-module-shims` for older browsers

**Critical limitation**: The import map itself is delivered in a `<script type="importmap">` tag in the HTML document. If the server is compromised, the attacker can serve a modified import map with hashes matching the malicious scripts. Import map integrity protects against CDN tampering (where the CDN serves JS but the origin serves HTML), but NOT against origin compromise.

**Relevance to Llamenos**: Useful as defense-in-depth for the split-origin architecture (import map served from app origin, scripts potentially from CDN). Does not solve the core problem.

#### 3.3.2 Service Worker as Trust Anchor

**Status: Viable with significant caveats.**

A service worker installed from a known-good state can intercept all subsequent fetches and verify integrity before allowing execution. This is the Trust-on-First-Use (TOFU) model.

**How it works**:
1. User installs the PWA from a known-good state (or verifies the first load via an extension)
2. The service worker pins the expected hashes of all application resources
3. On subsequent page loads, the SW intercepts all fetch requests
4. For each resource, the SW computes a hash and compares against the pinned manifest
5. On mismatch: the SW can refuse to serve the resource, display a warning, or serve the cached known-good version

**Properties**:
- Works on all platforms (Android Chrome, iOS Safari, Firefox)
- No extension required
- Survives page reloads (SW persists until explicitly updated or evicted)
- Can refuse to execute updates until user consents

**Critical limitations**:

1. **First load is unprotected**: The SW itself must be served by the server on first install. If the first load is compromised, the SW is compromised.
2. **SW update mechanism**: Browsers check for SW updates every 24 hours (or on navigation). A compromised server can serve a malicious SW update. The SW can be configured to require user consent before updating (`prompt` mode in workbox), but the update check itself fetches from the server.
3. **Browser eviction**: Browsers can evict SW caches under storage pressure (especially on iOS Safari, which is aggressive about this). After eviction, the next load is equivalent to a first load.
4. **SW byte-for-byte check**: Browsers re-fetch the SW script on each navigation and compare byte-for-byte. If the served SW differs by even one byte, the browser installs the new version. A compromised server can exploit this to replace the SW.

**Mitigation for limitations 2-4**: The SW can embed a signing key and verify its own updates. Before activating a new SW version, the installing SW can fetch the signed manifest and verify the new SW's hash. This creates a chain of trust from the first known-good install. However, this is complex and has edge cases (what if the browser force-updates the SW? what if the user clears site data?).

**Current Llamenos state**: The project uses `vite-plugin-pwa` with `registerType: 'autoUpdate'`, which means SW updates are applied silently. This is the weakest possible configuration for security. Switching to `registerType: 'prompt'` is a prerequisite for using the SW as a trust anchor.

**Assessment**: The service worker is the most broadly available mechanism for persistent integrity verification. It provides meaningful protection for repeat visits after a verified first load. The first-load problem remains, but combining SW with extension-based first-load verification (on platforms that support it) creates a strong layered defense.

#### 3.3.3 Subresource Integrity (SRI)

**Status: Broadly supported.**

SRI allows specifying expected hashes on `<script>` and `<link>` tags. The browser refuses to execute resources whose content does not match the hash.

```html
<script src="app.js" integrity="sha384-..." crossorigin="anonymous"></script>
```

**Limitation**: Same as import map integrity -- the SRI hashes are in the HTML document, which is served by the server. A compromised server serves matching hashes. SRI protects against CDN/transit tampering, not origin compromise.

**Relevance**: Useful in the split-origin architecture where HTML and JS are served from different hosts.

### 3.4 Transparency and Auditing Approaches

#### 3.4.1 Source Code Transparency (Proton / Daniel Huigens)

**Status: Proposal stage (W3C WICG submission).**

Daniel Huigens (Proton cryptography lead) proposed publishing web app source code hashes to a transparency log (analogous to Certificate Transparency for TLS certificates).

**Mechanism**:
1. Developer builds the web app and creates a signed Web Bundle
2. The bundle hash is published to a transparency log (append-only Merkle tree)
3. When a browser loads the web app, it checks that the served code's hash appears in the transparency log
4. If the hash is not in the log (or the log shows a different hash for this domain+version), the browser can warn or block

**Key insight**: This makes SMCD publicly auditable. A compromised server can still serve malicious code, but the malicious code's hash will either (a) be absent from the log (detectable by the browser) or (b) be present in the log (meaning the developer signed it, creating a public evidence trail).

**Current status**: Proposal submitted to W3C WICG after the "Secure the Web Forward" workshop (2023). No browser implementation. This is the right long-term direction for the web platform, but it requires browser vendor adoption.

#### 3.4.2 Binary Transparency Logs

**Status: Production for Android (Google), proposed for web.**

Google's Android Binary Transparency publishes APK hashes to a Merkle tree log. The WAIT paper ("Protecting the Integrity of Web Applications with Binary-Equivalent Transparency") proposes the same for web apps.

**Relevance**: The concept is sound. Llamenos already publishes checksums in GitHub Releases. The gap is that no browser natively checks these logs. The WEBCAT extension and Llamenos' binary verifier fill this gap in software, but the long-term solution requires browser-native support.

#### 3.4.3 Sigstore Integration

**Status: Production infrastructure.**

Sigstore provides keyless signing (via OIDC identity) with a public transparency log (Rekor). Tinfoil has demonstrated browser-native Sigstore verification in 50KB of JavaScript (down from 80MB WASM).

**Relevance**: Llamenos' release signing currently uses Ed25519 with a build-time-pinned key. Migrating to Sigstore would add:
- OIDC-based identity (ties signatures to a GitHub Actions workflow, not just a key)
- Public transparency log (every signing event is auditable)
- Keyless verification (no need to pin a key; verify against the OIDC identity)
- Browser-native verification via `sigstore-browser` + `tuf-browser` libraries

This does not solve the bootstrap problem (the verification code is still served by the server), but it significantly strengthens the auditing layer.

### 3.5 What Other E2EE Apps Do

| App | Approach | Mobile Story |
|-----|----------|-------------|
| **Signal** | Native apps only (no web client for messaging) | iOS App Store + Google Play Store |
| **WhatsApp Web** | Code Verify browser extension (desktop) | No mobile web client for E2EE messaging |
| **ProtonMail** | Open source + third-party audits + Key Transparency | Native apps for mobile; web client is the weak link (acknowledged) |
| **Element/Matrix** | Open source + WEBCAT integration (alpha) | Native apps for mobile; web client relies on trust |
| **CryptPad** | Sandboxed iframe (separate origin for crypto) | Same web client on mobile; sandboxed iframe helps but does not prevent SMCD |
| **Bitwarden** | Open source + third-party audits + WEBCAT integration (alpha) | Native apps for mobile; browser extension for desktop |

**Pattern**: Every serious E2EE application either (a) uses native apps for the primary client or (b) acknowledges the web trust gap honestly and layers mitigations. No one has fully solved the web E2EE trust problem for mobile browsers.

---

## 4. Proposed Architecture

### Design Principle

Accept that the web platform cannot provide the same trust guarantees as native apps. Instead of pretending otherwise, build the strongest layered defense achievable on each platform and be transparent about the residual risk.

The architecture follows a tiered approach where each tier adds protection for a broader set of users, with the strongest guarantees reserved for users who take specific actions (installing an extension or using a recommended browser).

### 4.1 Tier Overview

```
Tier 5: Native app (Tauri desktop, future mobile native)
        Trust anchor: OS code signing
        Coverage: Desktop users (existing)

Tier 4: WEBCAT-compatible browser extension
        Trust anchor: Extension store + Sigstore transparency log
        Coverage: Firefox Android users

Tier 3: Safari Web Extension (detection mode)
        Trust anchor: App Store review + declarativeNetRequest
        Coverage: iOS Safari users

Tier 2: Pinned service worker with manifest verification
        Trust anchor: TOFU from first verified load
        Coverage: All returning users on all platforms

Tier 1: Client-side binary verifier + fleet gossip + third-party verifiers
        Trust anchor: None (self-referential), but raises detection probability
        Coverage: All users (existing Tier 4 infrastructure)

Tier 0: Reproducible builds + public checksums + transparency
        Trust anchor: Social/reputational
        Coverage: Auditors, security researchers
```

### 4.2 Platform Coverage Matrix

| Platform | Browser | Tier 5 | Tier 4 | Tier 3 | Tier 2 | Tier 1 | Tier 0 |
|----------|---------|--------|--------|--------|--------|--------|--------|
| Desktop | Any | Tauri | -- | -- | SW | Verifier | Repro |
| Android | Firefox | -- | WEBCAT ext | -- | SW | Verifier | Repro |
| Android | Chrome | -- | -- | -- | SW | Verifier | Repro |
| iOS | Safari | -- | -- | Safari ext | SW | Verifier | Repro |
| iOS | Chrome* | -- | -- | -- | SW | Verifier | Repro |
| iOS | Firefox* | -- | -- | -- | SW | Verifier | Repro |
| EU iOS | Firefox (Gecko) | -- | Possible** | -- | SW | Verifier | Repro |

\* iOS Chrome and iOS Firefox use WebKit engine; they have Safari's capabilities, not Chrome's/Firefox's.

\** If Firefox ships Gecko on iOS in the EU with extension support, WEBCAT could work there. Speculative.

### 4.3 Detailed Architecture: WEBCAT-Compatible Extension (Tier 4)

#### For Firefox Android

Build a Llamenos Verifier extension following the WEBCAT architecture:

1. **Manifest signing**: CI/CD pipeline signs the release manifest using Sigstore (tied to the GitHub Actions OIDC identity). The signature and bundle hashes are published to Rekor.

2. **Extension intercept**: On every navigation to the Llamenos app origin, the extension:
   - Intercepts the HTML response via `webRequest.onBeforeRequest` (blocking)
   - Fetches the signed manifest from a configurable verification endpoint (default: Llamenos API, but pinnable to an independent source)
   - Verifies the Sigstore signature against the expected OIDC identity
   - Checks that the manifest's content hash appears in the Rekor transparency log
   - Parses the HTML to extract all `<script>` and `<link>` references
   - For each referenced resource, computes SHA-384 and compares against the manifest
   - If all hashes match: allows the page to load
   - If any hash mismatches or verification fails: blocks the page and displays a full-page warning with details

3. **Manifest pinning**: The extension stores the last-known-good manifest. If the verification endpoint is unavailable, the extension can verify against the pinned manifest (with a warning that freshness cannot be confirmed).

4. **Update alerting**: When the manifest changes (new release), the extension displays a notification before allowing the new version to load, showing the version change and a link to the release notes.

5. **Distribution**: Published to Firefox Add-ons (AMO) for both desktop and Android. The extension itself is signed by AMO, providing an independent trust anchor.

#### Integration with existing infrastructure

- The extension consumes the same `SignedReleaseManifest` that the existing binary verifier uses
- Sigstore signing replaces (or supplements) the current Ed25519 release signing
- The extension can also verify the crypto-sandbox iframe origin (split-origin architecture)

### 4.4 Detailed Architecture: Safari iOS Extension (Tier 3)

Build a Llamenos Verifier Safari extension:

1. **Content script verification**: After page load, the content script:
   - Enumerates all `<script>` and `<link>` elements in the DOM
   - Fetches each resource via `fetch()` and computes SHA-384
   - Compares against the signed manifest (fetched from verification endpoint)
   - If mismatch: injects a full-page warning overlay and attempts to prevent further script execution via DOM manipulation

2. **declarativeNetRequest rules**: Static rules that:
   - Block known-bad resource patterns (if a compromised hash is identified)
   - Redirect the app's service worker registration to a verification-first flow

3. **Limitation acknowledgment**: This is detection, not prevention. By the time the content script runs, the application code has already executed. The content script can detect the tampering and warn the user, but it cannot prevent initial execution. This must be documented honestly in the security properties.

4. **Distribution**: Published to the iOS App Store as a Safari Web Extension. Apple's App Store review provides a (weak) independent trust anchor.

### 4.5 Detailed Architecture: Pinned Service Worker (Tier 2)

Transform the existing service worker from a caching layer into a verification layer:

1. **Switch from `autoUpdate` to `prompt`**: The service worker no longer auto-updates. When a new version is detected, the user sees a prompt with:
   - Current version and new version
   - Whether the new version's manifest signature is valid
   - A "Verify and Update" button and a "Stay on Current Version" button

2. **Manifest-verified caching**: The service worker maintains a verified resource cache:
   - On install (first load or update), the SW fetches the signed release manifest
   - Verifies the manifest signature (Ed25519 or Sigstore)
   - For each resource in the manifest, fetches and hashes the content
   - Only caches resources whose hashes match the manifest
   - Subsequent page loads are served from the verified cache

3. **Fetch interception**: For all navigation and subresource requests:
   - If the resource is in the verified cache: serve from cache
   - If not in cache: fetch from network, verify hash against manifest, cache if valid
   - If hash mismatch: refuse to serve, display integrity error

4. **Self-verification on update**: When the browser detects a new SW version:
   - The current (trusted) SW fetches the new SW script
   - Computes its hash and verifies against the manifest
   - Only allows the update to proceed if verification passes
   - If verification fails: stays on current version and alerts the user

5. **Eviction recovery**: If the browser evicts the SW cache:
   - Next load is equivalent to a first load (unverified)
   - The SW re-fetches the manifest and re-verifies all resources
   - If an extension is installed (Tier 3/4), the extension provides first-load verification
   - If no extension: TOFU -- the user must trust this particular load

6. **Anti-downgrade**: The SW refuses to install a manifest with a version number lower than the current one. This prevents an attacker from serving an older (vulnerable) version.

### 4.6 Detailed Architecture: Sigstore Integration (Cross-Tier)

Migrate release signing from standalone Ed25519 to Sigstore:

1. **CI/CD signing**: The GitHub Actions release workflow signs the release manifest using `sigstore-js`. The signing identity is the GitHub Actions OIDC token, which binds the signature to:
   - The GitHub repository (`llamenos/llamenos-hotline`)
   - The GitHub Actions workflow file
   - The git commit SHA

2. **Transparency log**: Every signing event is recorded in Sigstore's Rekor log. This is append-only and publicly auditable.

3. **Browser-native verification**: Use Tinfoil's `sigstore-browser` (50KB) for in-browser Sigstore verification via WebCrypto. This replaces the current `@noble/curves/ed25519` verification in the binary verifier.

4. **Multiple verification paths**: The manifest can be verified via:
   - The browser extension (Tier 3/4) -- strongest, pre-execution
   - The service worker (Tier 2) -- strong for repeat visits
   - The in-page binary verifier (Tier 1) -- weakest, post-execution
   - External verifiers (Tier 0) -- independent, asynchronous

### 4.7 Recommended Browser Guidance

The security properties vary significantly by browser choice. Llamenos should provide clear guidance to users:

**Highest security (mobile)**:
- Android: Firefox with Llamenos Verifier extension installed
- iOS: Safari with Llamenos Verifier extension installed

**Standard security (mobile)**:
- Any modern browser with PWA installed (service worker provides TOFU verification)

**Reduced security (mobile)**:
- Any browser without PWA installed (relying on in-page verifier only)

This guidance should be surfaced at onboarding and in the security settings page.

---

## 5. Design Decisions

### D1: WEBCAT compatibility over custom extension

**Decision**: Build the Llamenos verifier extension to be compatible with the WEBCAT protocol rather than inventing a new one.

**Rationale**: WEBCAT is backed by the Freedom of the Press Foundation, has an IACR paper (2025/797), is already integrated with Element/Bitwarden/Jitsi, and uses Sigstore for transparency. Building on a standard increases auditability and allows allied organizations to verify Llamenos using the same tooling they use for other E2EE apps.

**Trade-off**: WEBCAT requires MV2 (`webRequest` blocking), which limits Chrome/Chromium support. Since our primary mobile target is Firefox Android (the only mobile browser with full extension support), this is acceptable.

### D2: Service worker prompt mode is mandatory

**Decision**: Switch from `registerType: 'autoUpdate'` to `registerType: 'prompt'` with manifest verification before update activation.

**Rationale**: Silent auto-update means a compromised server can silently replace the service worker. Prompt mode gives the user (and the SW's verification logic) an opportunity to verify before activating. This is a UX regression (users must explicitly accept updates) but a significant security improvement.

### D3: Sigstore over standalone Ed25519

**Decision**: Migrate release signing to Sigstore, retaining Ed25519 as a fallback for offline/air-gapped verification.

**Rationale**: Sigstore provides (a) OIDC identity binding (signature tied to GitHub Actions, not just a key), (b) public transparency log (signing events auditable by anyone), and (c) keyless verification (no need to trust a pinned public key). The Ed25519 key can still be used for environments without internet access to reach Rekor.

### D4: Honest tiering over false confidence

**Decision**: Explicitly document that different platforms provide different security levels. Do not claim uniform protection.

**Rationale**: The Signal cryptographer's review identified the gap specifically because the existing documentation was honest about limitations. Maintaining this honesty is a feature. Users in high-threat environments should know that Firefox Android with the extension provides stronger guarantees than iOS Safari, and should plan accordingly.

### D5: Firefox Android as the recommended mobile browser

**Decision**: Recommend Firefox Android as the highest-security mobile browser for Llamenos.

**Rationale**: Firefox Android is the only mobile browser that supports `webRequest` in blocking mode, which is required for pre-execution verification. This is not a political choice; it is a technical capability assessment. Chrome on Android does not support extensions at all. Safari on iOS does not support `webRequest`.

### D6: No Trusted Web Activity wrapper

**Decision**: Do not pursue a TWA wrapper for Android.

**Rationale**: TWA does not solve the server compromise problem. The web content is still fetched from the server on each load. TWA provides Play Store distribution, but the Firefox extension approach provides both distribution (via AMO) and integrity verification. Adding a TWA would be engineering effort that does not improve the security properties.

---

## 6. Implementation Considerations

### 6.1 Service Worker Changes

**File**: `vite.config.ts` (vite-plugin-pwa configuration)

- Change `registerType` from `'autoUpdate'` to `'prompt'`
- Add manifest verification logic to the service worker's `install` event
- Add self-verification logic to the SW update flow
- Add anti-downgrade version check
- Move SRI validation to occur before cache population

**File**: `src/client/lib/sw-update.ts` (new)

- React hook for managing SW update prompts
- Displays version change information
- Triggers manifest verification before allowing update
- Integrates with the existing notification system

### 6.2 Browser Extension

**New directory**: `extensions/llamenos-verifier/`

- `manifest.json` (MV2 for Firefox, targeting both desktop and Android)
- `background.js` -- request interception, manifest verification, Sigstore check
- `content.js` -- DOM verification for Safari fallback mode
- `popup/` -- extension popup showing verification status
- `lib/sigstore-browser.js` -- Tinfoil's browser-native Sigstore verification

**Distribution**:
- Firefox: Published to AMO (addons.mozilla.org)
- Safari: Published to iOS App Store as a Safari Web Extension
- Chrome: Not supported (MV3 lacks blocking `webRequest`); users directed to Firefox

### 6.3 Sigstore Migration

**File**: `.github/workflows/release.yml`

- Add Sigstore signing step after build
- Publish signature + certificate + Rekor entry alongside existing cosign artifacts
- Generate WEBCAT-compatible manifest format

**File**: `src/client/lib/binary-verifier.ts`

- Add Sigstore verification path (via `sigstore-browser`)
- Retain Ed25519 verification as fallback
- Accept either signature type in the manifest

**File**: `src/shared/schemas/gossip-version.ts`

- Extend `SignedReleaseManifest` schema to include Sigstore certificate chain
- Add Rekor log entry reference

### 6.4 Onboarding and Security Guidance

**File**: `src/client/components/onboarding/` (existing)

- Add browser recommendation step
- Show platform-specific security tier
- Link to extension installation for Firefox Android and iOS Safari

**File**: `docs/security/THREAT_MODEL.md`

- Add "Web Trust Gap" section referencing this spec
- Update "Compelled runtime instrumentation" section with new mitigations

### 6.5 Configuration Changes

**New environment variables**:
- `VITE_SIGSTORE_OIDC_ISSUER` -- expected OIDC issuer for Sigstore verification
- `VITE_SIGSTORE_IDENTITY` -- expected signing identity (GitHub Actions workflow)
- `VITE_WEBCAT_MANIFEST_URL` -- URL for WEBCAT-compatible manifest (defaults to API origin)

---

## 7. Limitations and Honest Assessment

### What this architecture solves

1. **Firefox Android users with extension**: Pre-execution blocking verification of all served code. Sigstore transparency log makes signing events auditable. This is close to native-app-level trust for the web platform. The trust anchor is AMO (Mozilla's extension signing) + Sigstore (public transparency log) -- two independent parties neither of which is the Llamenos server.

2. **iOS Safari users with extension**: Post-execution detection of served code tampering. Not as strong as pre-execution blocking, but detectable within seconds of page load. Combined with the service worker's verified cache, repeat visits are protected.

3. **All returning users (service worker)**: TOFU model provides integrity verification for repeat visits. A compromised server cannot silently update the service worker or the cached resources without the user's knowledge.

4. **All users (fleet gossip + verifiers)**: Mass SMCD is detectable within minutes. Targeted SMCD is detectable if it persists across multiple page loads.

### What this architecture does NOT solve

1. **First load without extension**: If a user visits Llamenos for the first time in a browser without the extension installed, and the server is compromised at that exact moment, the user receives malicious code. There is no browser-native mechanism to prevent this on any platform. This is the fundamental web trust problem.

2. **iOS without extension**: iOS forces all browsers to use WebKit. WebKit does not support `webRequest` in extensions. The best achievable protection on iOS without the Safari extension is the service worker (TOFU after first load) plus the in-page verifier (which is self-referential). This is weaker than Android Firefox.

3. **Chrome on Android without extension**: Chrome on Android does not support extensions. Users are limited to the service worker + in-page verifier. Recommending Firefox is the mitigation.

4. **Targeted SMCD of a single page load**: If the attacker compromises the server and serves malicious code to exactly one user for exactly one page load, then reverts: the fleet gossip may not detect it (depends on timing), the third-party verifier may miss it (depends on polling frequency), and the extension only helps if installed. This is the hardest attack to detect.

5. **Browser cache/SW eviction on iOS**: iOS Safari is aggressive about evicting service worker caches under storage pressure. After eviction, the next load is unprotected. There is no way to prevent this on iOS.

6. **Self-hosting hash diversity**: Self-hosted deployments build their own bundles, producing different hashes than the reference build. The WEBCAT/Sigstore approach still works (each operator signs their own manifest), but third-party verifiers cannot verify self-hosted instances against the reference build. Self-hosters must run their own verifier infrastructure.

### Honest comparison to native apps

| Property | Native App (iOS/Android) | Web + Extension (Firefox Android) | Web + SW Only (Chrome/Safari) |
|----------|-------------------------|----------------------------------|------------------------------|
| First-load trust | App Store review + code signing | Extension store + Sigstore log | None (TOFU) |
| Update verification | OS verifies signature | Extension verifies manifest | SW verifies manifest (self-referential) |
| Targeted SMCD resistance | Strong (app binary is signed) | Strong (extension blocks bad code) | Weak (in-page verifier is self-referential) |
| Persistence of trust | App stays installed | Extension stays installed | SW can be evicted |
| Independent trust anchor | Apple/Google | Mozilla (AMO) + Sigstore | None |

**The gap**: Web + SW Only (the situation for Chrome Android and iOS without extension) provides meaningfully weaker guarantees than native apps. This is an honest, permanent limitation of the web platform for these configurations. The mitigation is to steer users toward Firefox Android (with extension) or the desktop Tauri app for the highest security tier.

---

## 8. Migration Path

### Phase 1: Service Worker Hardening (Low risk, high impact)

1. Switch to `registerType: 'prompt'`
2. Add manifest verification to SW install/update flow
3. Add anti-downgrade check
4. Add user-facing update prompt with version information

This is the most impactful change with the least risk. It protects all returning users on all platforms.

### Phase 2: Sigstore Integration

1. Add Sigstore signing to the release workflow
2. Add `sigstore-browser` verification to the binary verifier
3. Extend the release manifest schema
4. Publish to Rekor transparency log

This strengthens the auditing layer for all tiers.

### Phase 3: Firefox Extension (WEBCAT-compatible)

1. Build the extension following WEBCAT architecture
2. Integrate Sigstore verification
3. Publish to AMO for desktop and Android
4. Add browser recommendation to onboarding

This provides the strongest mobile protection for users who follow the recommendation.

### Phase 4: Safari iOS Extension

1. Build the Safari Web Extension (detection mode)
2. Publish to iOS App Store
3. Integrate with the SW for cooperative verification

This fills the iOS gap as much as the platform allows.

### Phase 5: Documentation and Transparency

1. Update THREAT_MODEL.md
2. Update WHITEPAPER.md
3. Update residual risk statement
4. Add browser security guidance to onboarding

---

## 9. References

### Academic and Industry Papers

- Berra, G. (2025). "WEBCAT: Web-based Code Assurance and Transparency." IACR ePrint 2025/797. https://eprint.iacr.org/2025/797
- Sutter, T. & Berlich, P. (2021). "Web Content Signing with Service Workers." arXiv:2105.05551. https://arxiv.org/pdf/2105.05551
- Stark, E. (2023). "E2EE on the web: isolating plaintext." https://emilymstark.com/2023/09/09/e2ee-on-the-web-isolating-plaintext.html
- Stark, E. (2024). "E2EE on the web: is the web really that bad?" https://emilymstark.com/2024/02/09/e2ee-on-the-web-is-the-web-really-that-bad.html
- Huigens, D. (2023). "Source Code Transparency." W3C Secure the Web Forward Workshop. https://www.w3.org/2023/03/secure-the-web-forward/talks/source-code-transparency.html

### Specifications and Proposals

- Source Code Transparency proposal: https://github.com/twiss/source-code-transparency/blob/main/explainer.md
- Isolated Web Apps: https://github.com/WICG/isolated-web-apps
- Import Maps (with integrity): https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap
- WEBCAT GitHub: https://github.com/freedomofpress/webcat
- Sigstore: https://docs.sigstore.dev/
- Sigstore browser libraries (Tinfoil): https://tinfoil.sh/blog/2025-12-18-browser-native-verification

### Production Implementations

- WhatsApp Code Verify: https://engineering.fb.com/2022/03/10/security/code-verify/
- WEBCAT alpha (SecureDrop): https://securedrop.org/news/webcat-alpha/
- Proton Key Transparency: https://proton.me/support/key-transparency
- aldur.blog, "Code integrity for web apps": https://aldur.blog/articles/2025/09/02/web-code-verify

### Browser Extension Documentation

- Firefox Android extensions: https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
- Safari Web Extensions on iOS: https://developer.apple.com/documentation/safariservices/safari-web-extensions
- Safari declarativeNetRequest: https://developer.apple.com/documentation/safariservices/blocking-content-with-your-safari-web-extension
- Firefox iOS extension status: https://support.mozilla.org/en-US/kb/add-ons-firefox-ios

### Platform Documentation

- Trusted Web Activities: https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities
- iOS alternative browser engines (EU DMA): https://developer.apple.com/support/alternative-browser-engines/
- Chromium Service Worker Security FAQ: https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md

### Existing Llamenos Infrastructure

- Tier 4 spec brief: `docs/security/spec-briefs/tier-4-delivery-hardening.md`
- Threat model: `docs/security/THREAT_MODEL.md`
- Binary verifier: `src/client/lib/binary-verifier.ts`
- Security whitepaper: `docs/security/WHITEPAPER.md`
- Supply chain: `docs/security/SUPPLY_CHAIN.md`
