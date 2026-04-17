---
title: Seguridad at Pagkapribado
subtitle: Ano ang protektado, ano ang nakikita, at ano ang maaaring makuha sa ilalim ng subpoena — inorganisa ayon sa kung aling mga feature ang ginagamit mo.
---

## Kung ang iyong hosting provider ay subpoenaed

| Maaari nilang ibigay | HINDI nila maaaring ibigay |
|----------------------|---------------------------|
| Call/message metadata (mga oras, tagal) | Nilalaman ng tala, mga transcript, katawan ng ulat |
| Encrypted database blobs | Mga pangalan ng volunteer (end-to-end encrypted) |
| Aling mga volunteer account ang aktibo kailan | Mga contact directory record (end-to-end encrypted) |
| | Nilalaman ng mensahe (iniencrypt sa pagdating, naiimbak bilang ciphertext) |
| | Mga decryption key (protektado ng iyong PIN, identity provider account, at opsyonal na hardware security key) |
| | Per-note encryption keys (ephemeral — sinisira pagkatapos ng wrapping) |
| | Ang iyong HMAC secret para sa pagbaliktad ng phone hashes |

**Ang server ay nag-iimbak ng data na hindi nito mabasa.** Ang metadata (kailan, gaano katagal, aling mga account) ay nakikita. Ang nilalaman (ano ang sinabi, ano ang sinulat, sino ang iyong mga contact) ay hindi.

---

## Ayon sa feature

Ang iyong exposure sa privacy ay depende sa kung aling mga channel ang iyong ini-enable:

### Voice calls

| Kung gumagamit ka ng... | Maaaring ma-access ng third party | Maaaring ma-access ng server | End-to-end encrypted content |
|---------------------------|-----------------------------------|------------------------------|------------------------------|
| Twilio/SignalWire/Vonage/Plivo | Call audio (live), call records | Call metadata | Mga tala, mga transcript |
| Self-hosted Asterisk | Wala (ikaw ang may kontrol) | Call metadata | Mga tala, mga transcript |
| Browser-to-browser (WebRTC) | Wala | Call metadata | Mga tala, mga transcript |

**Telephony provider subpoena**: Mayroon silang call detail records (mga oras, numero ng telepono, tagal). WALA silang mga call notes o transcripts. Ang recording ay naka-disable by default.

**Transcription**: Ang transcription ay nangyayari nang buo sa iyong browser gamit ang on-device AI. **Ang audio ay hindi kailanman umaalis sa iyong device.** Ang naka-encrypt na transcript lamang ang naiimbak.

### Text messaging

| Channel | Provider access | Server storage | Mga tala |
|---------|-----------------|----------------|----------|
| SMS | Ang iyong telephony provider ay nagbabasa ng lahat ng mensahe | **Encrypted** | Ang provider ay nagtatago ng orihinal na mga mensahe |
| WhatsApp | Ang Meta ay nagbabasa ng lahat ng mensahe | **Encrypted** | Ang provider ay nagtatago ng orihinal na mga mensahe |
| Signal | Ang Signal network ay end-to-end encrypted, ngunit ang bridge ay nagde-decrypt sa pagdating | **Encrypted** | Mas mabuti kaysa sa SMS, hindi zero-knowledge |

**Ang mga mensahe ay iniencrypt sa sandaling dumating sa iyong server.** Ang server ay nag-iimbak lamang ng ciphertext. Ang iyong telephony o messaging provider ay maaaring mayroon pa rin ang orihinal na mensahe — ito ay isang limitasyon ng mga platform na iyon, hindi isang bagay na maaari nating baguhin.

**Messaging provider subpoena**: Ang mga SMS provider ay mayroong buong nilalaman ng mensahe. Ang Meta ay mayroong WhatsApp content. Ang Signal messages ay end-to-end encrypted sa bridge, ngunit ang bridge (na tumatakbo sa iyong server) ay nagde-decrypt bago ire-encrypt para sa imbakan. Sa lahat ng kaso, **ang iyong server ay mayroon lamang ciphertext** — ang hosting provider ay hindi maaaring basahin ang nilalaman ng mensahe.

### Mga tala, mga transcript, at mga ulat

Ang lahat ng nilalaman na isinulat ng volunteer ay end-to-end encrypted:

- Bawat tala ay gumagamit ng isang **natatanging random key** (forward secrecy — ang pag-compromise ng isang tala ay hindi nagco-compromise ng iba pa)
- Ang mga key ay naka-wrap nang hiwalay para sa volunteer at bawat admin
- Ang server ay nag-iimbak lamang ng ciphertext
- Ang decryption ay nangyayari sa browser
- **Ang mga custom field, nilalaman ng ulat, at mga file attachment ay lahat nang indibidwal na iniencrypt**

**Device seizure**: Kung wala ang iyong PIN **at** access sa iyong identity provider account, ang mga attacker ay makakakuha lamang ng isang encrypted blob na computationally infeasible na i-decrypt. Kung gumagamit ka rin ng hardware security key, **tatlong independyenteng factor** ang nagproprotekta sa iyong data.

---

## Privacy ng numero ng telepono ng volunteer

Kapag ang mga volunteer ay tumatanggap ng mga tawag sa kanilang mga personal na telepono, ang kanilang mga numero ay exposed sa iyong telephony provider.

| Scenario | Numero ng telepono na nakikita ng |
|----------|-----------------------------------|
| PSTN call sa telepono ng volunteer | Telephony provider, phone carrier |
| Browser-to-browser (WebRTC) | Walang sinuman (ang audio ay nananatili sa browser) |
| Self-hosted Asterisk + SIP phone | Tanging ang iyong Asterisk server |

**Para protektahan ang mga numero ng telepono ng volunteer**: Gumamit ng browser-based calling (WebRTC) o magbigay ng mga SIP phone na nakakonekta sa self-hosted na Asterisk.

---

## Kamakailang inilabas

Ang mga pagpapabuting ito ay live ngayon:

| Feature | Benepisyo sa privacy |
|---------|----------------------|
| Encrypted message storage | Ang mga SMS, WhatsApp, at Signal message ay naiimbak bilang ciphertext sa iyong server |
| On-device transcription | Ang audio ay hindi kailanman umaalis sa iyong browser — ganap na naproseso sa iyong device |
| Multi-factor key protection | Ang iyong mga encryption key ay protektado ng iyong PIN, identity provider, at opsyonal na hardware security key |
| Hardware security keys | Ang mga physical key ay nagdaragdag ng isang third factor na hindi maaaring remotely i-compromise |
| Reproducible builds | Patunayan na ang deployed na code ay tumutugma sa public source |
| Encrypted contact directory | Ang mga contact record, relasyon, at mga tala ay end-to-end encrypted |

## Naka-plano pa rin

| Feature | Benepisyo sa privacy |
|---------|----------------------|
| Native call-receiving apps | Walang personal na numero ng telepono na exposed |

---

## Buod na talahanayan

| Uri ng data | Encrypted | Nakikita ng server | Maaaring makuha sa ilalim ng subpoena |
|-------------|-----------|--------------------|----------------------------------------|
| Call notes | Oo (end-to-end) | Hindi | Ciphertext lamang |
| Transcripts | Oo (end-to-end) | Hindi | Ciphertext lamang |
| Mga ulat | Oo (end-to-end) | Hindi | Ciphertext lamang |
| Mga file attachment | Oo (end-to-end) | Hindi | Ciphertext lamang |
| Contact records | Oo (end-to-end) | Hindi | Ciphertext lamang |
| Volunteer identities | Oo (end-to-end) | Hindi | Ciphertext lamang |
| Team/role metadata | Oo (encrypted) | Hindi | Ciphertext lamang |
| Custom field definitions | Oo (encrypted) | Hindi | Ciphertext lamang |
| SMS/WhatsApp/Signal content | Oo (sa iyong server) | Hindi | Ciphertext mula sa iyong server; maaaring mayroon ang provider ng orihinal |
| Call metadata | Hindi | Oo | Oo |
| Caller phone hashes | HMAC hashed | Hash lamang | Hash (hindi reversible nang walang iyong secret) |

---

## Para sa mga security auditor

Teknikal na dokumentasyon:

- [Protocol Specification](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/protocol/llamenos-protocol.md)
- [Threat Model](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/THREAT_MODEL.md)
- [Data Classification](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/DATA_CLASSIFICATION.md)
- [Security Audits](https://github.com/rhonda-rodododo/llamenos/tree/main/docs/security)
- [API Documentation](/api/docs)

Ang Llamenos ay open source: [github.com/rhonda-rodododo/llamenos](https://github.com/rhonda-rodododo/llamenos)
