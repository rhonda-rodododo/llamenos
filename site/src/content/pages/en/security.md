---
title: Security & Privacy Model
subtitle: An honest assessment of what Llamenos encrypts end-to-end, what the server can see, and what we're working to improve.
---

## What is encrypted end-to-end

<details>
<summary><strong>Call notes</strong></summary>

Notes are encrypted client-side using ECIES: an ephemeral ECDH key exchange on secp256k1, followed by XChaCha20-Poly1305 symmetric encryption. The encrypted payload leaves the browser — the server stores only ciphertext. Each note is dual-encrypted: one copy for the volunteer who wrote it, one for the admin. Both can decrypt independently using their private keys.

</details>

<details>
<summary><strong>Call transcripts</strong></summary>

After transcription, the resulting text is encrypted using the same ECIES scheme before storage. The stored transcript is ciphertext only. Both the volunteer and admin receive independently encrypted copies.

</details>

<details>
<summary><strong>Custom field values</strong></summary>

Admin-defined custom fields (text, number, select, checkbox, textarea) are encrypted alongside note content using the same ECIES encryption. Field definitions (names, types, options) are stored in plaintext for the form UI, but all user-entered values are encrypted before leaving the browser.

</details>

<details>
<summary><strong>Draft notes</strong></summary>

In-progress notes are auto-saved as encrypted drafts in the browser's localStorage. They're encrypted with the volunteer's public key before storage. Drafts are cleaned from localStorage on logout.

</details>

## What the server never sees

- Note content (free-text and custom field values)
- Transcript text after encryption
- Volunteer secret keys (nsec) — authentication uses challenge-response signatures
- Draft note content (stored locally in the browser)

## Honest limitations

<details>
<summary><strong>Voice calls traverse the PSTN and your telephony provider</strong></summary>

When using a cloud provider (Twilio, SignalWire, Vonage, or Plivo), Llamenos routes calls through the public switched telephone network (PSTN) via that provider's infrastructure. This means the provider processes call audio in real time and can technically access it during transit. This is an inherent limitation of PSTN-based cloud telephony. For maximum privacy, Llamenos also supports self-hosted Asterisk with SIP trunks, which eliminates the third-party provider entirely.

</details>

<details>
<summary><strong>Transcription requires server-side audio access</strong></summary>

Call recordings are transcribed server-side using Cloudflare Workers AI (Whisper). During transcription, the server has transient access to the audio. After transcription completes, the text is immediately encrypted and the audio reference is discarded. The window of plaintext access is minimized but exists.

</details>

<details>
<summary><strong>Call metadata is visible to the server</strong></summary>

Timestamps, call durations, routing decisions, queue positions, and which volunteer answered — all of this is operational metadata that the server needs to function. Phone numbers are stored for ban list matching but are not included in WebSocket broadcasts to volunteers. Caller identity is redacted from real-time updates.

</details>

## Threat model

Llamenos is designed to protect crisis hotline volunteers and callers against:

1. **Database breach** — An attacker who obtains the database gets only ciphertext for notes and transcripts. Without volunteer or admin private keys, the content is unreadable.
2. **Server compromise** — A compromised server can see call metadata and has transient access to audio during transcription, but cannot read stored notes or transcripts.
3. **Network surveillance** — All connections use TLS. WebSocket connections are authenticated. The server enforces HSTS and strict CSP headers.
4. **Volunteer impersonation** — Authentication uses BIP-340 Schnorr signatures. Without the volunteer's private key, login is impossible. WebAuthn passkeys add hardware-backed second factor.
5. **Insider threat (volunteer)** — Volunteers can only decrypt their own notes. They cannot see other volunteers' notes, personal information, or admin-only data.

No system is perfectly secure. The goal is to minimize the trust surface and be transparent about what remains.

## What we're working toward

<details>
<summary><strong>WebRTC in-browser calling</strong></summary>

Moving voice calls from PSTN/cloud providers to WebRTC allows direct browser-to-browser audio, eliminating the telephony provider from the voice path entirely. Llamenos already supports WebRTC calling for volunteers — when combined with a self-hosted Asterisk setup, the entire voice path can bypass third-party infrastructure.

</details>

<details>
<summary><strong>Client-side transcription</strong></summary>

Running Whisper (or a similar model) directly in the browser via WebAssembly or WebGPU would eliminate server-side audio access entirely. The transcript would be generated locally and encrypted before upload.

</details>

<details>
<summary><strong>Reproducible builds</strong></summary>

Deterministic builds that allow anyone to verify the deployed code matches the open-source repository, ensuring no server-side modifications have been introduced.

</details>

## Verify it yourself

Llamenos is fully open source. Every encryption operation, every API endpoint, every client-side check — it's all in the repository. Read the code, audit the crypto, file issues. [github.com/rikki-llamenos/llamenos](https://github.com/rikki-llamenos/llamenos)
