---
title: Dukumeentiyada
description: Bar sida loo deploy-gareeyo, loo hagaajiyo, oo loo isticmaalo Llamenos.
guidesHeading: Haggaagyo
guides:
  - title: Getting Started
    description: Shuruudaha hore, rakibidda, setup wizard, iyo deployment-kaaga ugu horreeya.
    href: /docs/deploy/
  - title: Self-Hosting Overview
    description: Ku deploy infrastructure-kaaga adiga leh Docker Compose ama Kubernetes.
    href: /docs/deploy/self-hosting
  - title: "Deploy: Docker Compose"
    description: Self-hosted deployment hal server ah oo leh HTTPS otomaatig ah.
    href: /docs/deploy/docker
  - title: "Deploy: Kubernetes (Helm)"
    description: Ku deploy Kubernetes chart-ka Helm-ka rasmiga ah.
    href: /docs/deploy/kubernetes
  - title: "Deploy: Co-op Cloud"
    description: Ku deploy sida recipe standardized ah oo loogu talagalay ururada hosting-ka iskaashiga ah.
    href: /docs/deploy/coopcloud
  - title: Guides
    description: Eeg haggaagyada dadweynaha iyo mowduuca — operators, staff, iyo wiciyayaasha.
    href: /docs/guides/
  - title: Telephony Providers
    description: Isbarbardhig bixiyeyaasha telefooniyada ee la taageero oo dooro kuwa ugu habboon hotline-kaaga.
    href: /docs/deploy/providers/
  - title: "Setup: SMS"
    description: Fur fariimaha soo gala/soo baxa ee SMS via bixiyahaaga telefooniyada.
    href: /docs/deploy/providers/sms
  - title: "Setup: WhatsApp"
    description: Ku xiriir WhatsApp Business via Meta Cloud API.
    href: /docs/deploy/providers/whatsapp
  - title: "Setup: Signal"
    description: Deji islaahlabka Signal via signal-cli bridge.
    href: /docs/deploy/providers/signal
  - title: "Setup: Twilio"
    description: Haggaag talaabo-talaabo ah si loo hagaajiyo Twilio sida bixiyahaaga telefooniyada.
    href: /docs/deploy/providers/twilio
  - title: "Setup: SignalWire"
    description: Haggaag talaabo-talaabo ah si loo hagaajiyo SignalWire sida bixiyahaaga telefooniyada.
    href: /docs/deploy/providers/signalwire
  - title: "Setup: Vonage"
    description: Haggaag talaabo-talaabo ah si loo hagaajiyo Vonage sida bixiyahaaga telefooniyada.
    href: /docs/deploy/providers/vonage
  - title: "Setup: Plivo"
    description: Haggaag talaabo-talaabo ah si loo hagaajiyo Plivo sida bixiyahaaga telefooniyada.
    href: /docs/deploy/providers/plivo
  - title: "Setup: Asterisk (Self-Hosted)"
    description: Ku deploy Asterisk iyagoo leh ARI bridge si aad u hesho qoys iyo xakame ugu badan.
    href: /docs/deploy/providers/asterisk
  - title: WebRTC Browser Calling
    description: Fur in-browser call answering siiwacalayaasha isticmaalaya WebRTC.
    href: /docs/deploy/providers/webrtc
  - title: Security Model
    description: Fah waxa sirta ah, waxa aan ahayn, iyo threat model-ka.
    href: /security
---

## Aragtida guud ee qaab-dhismeedka

Llamenos waa self-hosted single-page application (SPA) oo la deploy-gareeyo via **Docker Compose** ama **Kubernetes**. Waxay taageertaa wicitaannada codka, SMS, WhatsApp, iyo Signal — oo dhan loo waddooyiyay staff-ka shaqada via interface mid ah.

| Qayb | Farsamo |
|---|---|
| Frontend | Vite + React + TanStack Router |
| Backend | Bun + Hono + PostgreSQL |
| Blob Storage | RustFS (S3-compatible) |
| Identity Provider | Authentik (self-hosted OIDC) |
| Cod | Twilio, SignalWire, Vonage, Plivo, ama Asterisk |
| Fariimaha | SMS, WhatsApp Business, Signal |
| Auth | JWT + multi-factor KEK + WebAuthn passkeys |
| Sirta | ECIES (secp256k1 + XChaCha20-Poly1305), 3 tiers |
| Turjumaadda | Client-side Whisper (WASM) — codku marnaba ma ka taga browser-ka |
| Real-time | Nostr relay (strfry) |
| i18n | i18next (13 luuqadood) | Isla'eg |

## Doorka

| Door | Waxa uu arki karaa | Waxa uu sameyn karaa |
|---|---|---|
| **Wiciyaha** | Waxba (telefoon/SMS/WhatsApp/Signal) | Waco ama fariin u dir hotline-ka |
| **Siiwacalaha** | Qoraalladiisa, wada-hadalka la qoondeeyay | Ka jawaab wicitaannada, qor qoraal, jawaab fariimaha |
| **Reporter-ka** | Warbixinnadiisa oo keliya | Soo gudbi warbixinno sirta ah iyagoo leh lifaaqyada faylasha |
| **Maamulaha** | Dhammaan qoraallada, warbixinnada, wada-hadalka, audit logs | Maamul siiwacalayaasha, shaqooyinka, islaahlabka, reer-booliska, goobaha |
