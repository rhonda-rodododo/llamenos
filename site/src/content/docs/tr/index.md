---
title: Dokümantasyon
description: Llamenos'u nasıl dağıtacağınızı, yapılandıracağınızı ve kullanacağınızı öğrenin.
guidesHeading: Kılavuzlar
guides:
  - title: Başlangıç
    description: Ön koşullar, kurulum, kurulum sihirbazı ve ilk dağıtımınız.
    href: /docs/deploy/
  - title: Kendi Sunucunuzda Barındırma Genel Bakış
    description: Docker Compose veya Kubernetes ile kendi altyapınızda dağıtım.
    href: /docs/deploy/self-hosting
  - title: "Dağıtım: Docker Compose"
    description: Otomatik HTTPS ile tek sunuculu kendi sunucunuzda barındırma.
    href: /docs/deploy/docker
  - title: "Dağıtım: Kubernetes (Helm)"
    description: Resmi Helm chart'ı ile Kubernetes'e dağıtım.
    href: /docs/deploy/kubernetes
  - title: "Dağıtım: Co-op Cloud"
    description: Kooperatif barındırma kolektifleri için standartlaştırılmış tarif olarak dağıtım.
    href: /docs/deploy/coopcloud
  - title: Kılavuzlar
    description: Kitle ve konuya göre kılavuzları keşfedin — operatörler, personel ve arayanlar.
    href: /docs/guides/
  - title: Telefon Sağlayıcıları
    description: Desteklenen telefon sağlayıcılarını karşılaştırın ve yardım hattınız için en uygun olanı seçin.
    href: /docs/deploy/providers/
  - title: "Kurulum: SMS"
    description: Telefon sağlayıcınız üzerinden gelen/giden SMS mesajlaşmayı etkinleştirin.
    href: /docs/deploy/providers/sms
  - title: "Kurulum: WhatsApp"
    description: Meta Cloud API üzerinden WhatsApp Business'ı bağlayın.
    href: /docs/deploy/providers/whatsapp
  - title: "Kurulum: Signal"
    description: Signal kanalını signal-cli köprüsü üzerinden kurun.
    href: /docs/deploy/providers/signal
  - title: "Kurulum: Twilio"
    description: Telefon sağlayıcınız olarak Twilio'yu yapılandırma adım adım kılavuzu.
    href: /docs/deploy/providers/twilio
  - title: "Kurulum: SignalWire"
    description: Telefon sağlayıcınız olarak SignalWire'ı yapılandırma adım adım kılavuzu.
    href: /docs/deploy/providers/signalwire
  - title: "Kurulum: Vonage"
    description: Telefon sağlayıcınız olarak Vonage'ı yapılandırma adım adım kılavuzu.
    href: /docs/deploy/providers/vonage
  - title: "Kurulum: Plivo"
    description: Telefon sağlayıcınız olarak Plivo'yu yapılandırma adım adım kılavuzu.
    href: /docs/deploy/providers/plivo
  - title: "Kurulum: Asterisk (Kendi Sunucunuzda)"
    description: Maksimum gizlilik ve kontrol için ARI köprüsüyle Asterisk dağıtımı.
    href: /docs/deploy/providers/asterisk
  - title: WebRTC Tarayıcı Üzerinden Arama
    description: Gönüllüler için WebRTC kullanarak tarayıcı üzerinden arama yanıtlamayı etkinleştirin.
    href: /docs/deploy/providers/webrtc
  - title: Güvenlik Modeli
    description: Neyin şifreli olduğunu, neyin olmadığını ve tehdit modelini anlayın.
    href: /security
---

## Mimari genel bakış

Llamenos, **Docker Compose** veya **Kubernetes** üzerinden dağıtılan kendi sunucunuzda barındırılan tek sayfalık bir uygulamadır (SPA). Sesli aramalar, SMS, WhatsApp ve Signal'i destekler — hepsi birleşik bir arayüz üzerinden görevdeki personele yönlendirilir.

| Bileşen | Teknoloji |
|---|---|
| Ön Yüz | Vite + React + TanStack Router |
| Arka Yüz | Bun + Hono + PostgreSQL |
| Blob Depolama | RustFS (S3 uyumlu) |
| Kimlik Sağlayıcı | Authentik (kendi sunucunuzda OIDC) |
| Ses | Twilio, SignalWire, Vonage, Plivo veya Asterisk |
| Mesajlaşma | SMS, WhatsApp Business, Signal |
| Kimlik Doğrulama | JWT + çok faktörlü KEK + WebAuthn passkey'leri |
| Şifreleme | ECIES (secp256k1 + XChaCha20-Poly1305), 3 katman |
| Transkripsiyon | İstemci tarafı Whisper (WASM) — ses hiçbir şekilde tarayıcıyı terk etmez |
| Gerçek Zamanlı | Nostr relay (strfry) |
| i18n | i18next (13 dil) | Aynı |

## Roller

| Rol | Görebilir | Yapabilir |
|---|---|---|
| **Arayan** | Hiçbir şey (telefon/SMS/WhatsApp/Signal) | Yardım hattını arayabilir veya mesaj atabilir |
| **Gönüllü** | Kendi notları, atanan konuşmalar | Aramaları yanıtlar, not yazar, mesajlara yanıt verir |
| **Raporlayıcı** | Yalnızca kendi raporları | Şifreli raporlar ve dosya ekleri gönderir |
| **Yönetici** | Tüm notlar, raporlar, konuşmalar, denetim günlükleri | Gönüllüleri, vardiyaları, kanalları, yasakları, ayarları yönetir |
