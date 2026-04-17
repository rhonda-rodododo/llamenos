---
title: مستندات
description: یاد بگیرید چگونه Llamenos را مستقر، پیکربندی و استفاده کنید.
guidesHeading: راهنماها
guides:
  - title: شروع به کار
    description: پیش‌نیازها، نصب، ویزارد راه‌اندازی و اولین استقرار شما.
    href: /docs/deploy/
  - title: نمای کلی میزبانی خودتان
    description: روی زیرساخت خودتان با Docker Compose یا Kubernetes مستقر کنید.
    href: /docs/deploy/self-hosting
  - title: "استقرار: Docker Compose"
    description: استقرار self-hosted تک‌سروره با HTTPS خودکار.
    href: /docs/deploy/docker
  - title: "استقرار: Kubernetes (Helm)"
    description: با Helm chart رسمی روی Kubernetes مستقر کنید.
    href: /docs/deploy/kubernetes
  - title: "استقرار: Co-op Cloud"
    description: به عنوان یک recipe استاندارد برای collectiveهای میزبانی تعاونی مستقر کنید.
    href: /docs/deploy/coopcloud
  - title: راهنماها
    description: راهنماها را بر اساس مخاطب و موضوع مرور کنید — اپراتورها، کارکنان و تماس‌گیرندگان.
    href: /docs/guides/
  - title: ارائه‌دهندگان تلفنی
    description: ارائه‌دهندگان تلفنی پشتیبانی‌شده را مقایسه کنید و بهترین گزینه را برای خط تلفن خود انتخاب کنید.
    href: /docs/deploy/providers/
  - title: "راه‌اندازی: پیامک"
    description: پیام‌رسانی ورودی/خروجی پیامک را از طریق ارائه‌دهنده تلفنی خود فعال کنید.
    href: /docs/deploy/providers/sms
  - title: "راه‌اندازی: واتس‌اپ"
    description: واتس‌اپ بیزینس را از طریق Meta Cloud API متصل کنید.
    href: /docs/deploy/providers/whatsapp
  - title: "راه‌اندازی: سیگنال"
    description: کانال سیگنال را از طریق پل signal-cli راه‌اندازی کنید.
    href: /docs/deploy/providers/signal
  - title: "راه‌اندازی: Twilio"
    description: راهنمای گام به گام برای پیکربندی Twilio به عنوان ارائه‌دهنده تلفنی شما.
    href: /docs/deploy/providers/twilio
  - title: "راه‌اندازی: SignalWire"
    description: راهنمای گام به گام برای پیکربندی SignalWire به عنوان ارائه‌دهنده تلفنی شما.
    href: /docs/deploy/providers/signalwire
  - title: "راه‌اندازی: Vonage"
    description: راهنمای گام به گام برای پیکربندی Vonage به عنوان ارائه‌دهنده تلفنی شما.
    href: /docs/deploy/providers/vonage
  - title: "راه‌اندازی: Plivo"
    description: راهنمای گام به گام برای پیکربندی Plivo به عنوان ارائه‌دهنده تلفنی شما.
    href: /docs/deploy/providers/plivo
  - title: "راه‌اندازی: Asterisk (میزبان‌شده خودتان)"
    description: Asterisk را با پل ARI برای حداکثر حریم خصوصی و کنترل مستقر کنید.
    href: /docs/deploy/providers/asterisk
  - title: تماس مرورگری WebRTC
    description: پاسخ‌دهی به تماس در مرورگر را برای داوطلبان با استفاده از WebRTC فعال کنید.
    href: /docs/deploy/providers/webrtc
  - title: مدل امنیتی
    description: درک کنید چه چیزهایی رمزگذاری می‌شوند، چه چیزهایی نمی‌شوند و مدل تهدید چیست.
    href: /security
---

## نمای کلی معماری

Llamenos یک برنامه تک‌صفحه‌ای (SPA) self-hosted است که از طریق **Docker Compose** یا **Kubernetes** مستقر می‌شود. از تماس‌های صوتی، پیامک، واتس‌اپ و سیگنال پشتیبانی می‌کند — همه از طریق یک رابط واحد به کارکنان شیفت‌دار هدایت می‌شوند.

| جزء | فناوری |
|---|---|
| Frontend | Vite + React + TanStack Router |
| Backend | Bun + Hono + PostgreSQL |
| Blob Storage | RustFS (سازگار با S3) |
| ارائه‌دهنده هویت | Authentik (OIDC self-hosted) |
| صدا | Twilio، SignalWire، Vonage، Plivo یا Asterisk |
| پیام‌رسانی | پیامک، واتس‌اپ بیزینس، سیگنال |
| احراز هویت | JWT + KEK چند عاملی + passkeyهای WebAuthn |
| رمزگذاری | ECIES (secp256k1 + XChaCha20-Poly1305)، ۳ سطح |
| رونویسی | Whisper سمت کلاینت (WASM) — صدا هرگز مرورگر را ترک نمی‌کند |
| بلادرنگ | رله Nostr (strfry) |
| i18n | i18next (۱۳ زبان) |

## نقش‌ها

| نقش | می‌تواند ببیند | می‌تواند انجام دهد |
|---|---|---|
| **تماس‌گیرنده** | هیچ‌چیز (تلفن/پیامک/واتس‌اپ/سیگنال) | با خط تلفن تماس بگیرد یا پیام بدهد |
| **داوطلب** | یادداشت‌های خود، مکالمات اختصاص‌یافته | تماس پاسخ دهد، یادداشت بنویسد، به پیام‌ها پاسخ دهد |
| **گزارش‌دهنده** | فقط گزارش‌های خود | گزارش‌های رمزگذاری‌شده با پیوست فایل ارسال کند |
| **مدیر** | همه یادداشت‌ها، گزارش‌ها، مکالمات، logs حسابرسی | داوطلبان، شیفت‌ها، کانال‌ها، ممنوعیت‌ها، تنظیمات را مدیریت کند |
