---
title: Документація
description: Дізнайтеся, як розгортати, налаштовувати та використовувати Llamenos.
guidesHeading: Посібники
guides:
  - title: Початок роботи
    description: Передумови, встановлення, майстер налаштування та ваше перше розгортання.
    href: /docs/deploy/
  - title: Огляд самостійного хостингу
    description: Розгортання на власній інфраструктурі з Docker Compose або Kubernetes.
    href: /docs/deploy/self-hosting
  - title: "Розгортання: Docker Compose"
    description: Односерверне самостійне розгортання з автоматичним HTTPS.
    href: /docs/deploy/docker
  - title: "Розгортання: Kubernetes (Helm)"
    description: Розгортання в Kubernetes за допомогою офіційного Helm chart.
    href: /docs/deploy/kubernetes
  - title: "Розгортання: Co-op Cloud"
    description: Розгортання як стандартизований рецепт для кооперативних хостингових колективів.
    href: /docs/deploy/coopcloud
  - title: Посібники
    description: Переглядайте посібники за аудиторією та темою — оператори, співробітники та абоненти.
    href: /docs/guides/
  - title: Телефонні провайдери
    description: Порівнюйте підтримуваних телефонних провайдерів і обирайте найкращого для вашої гарячої лінії.
    href: /docs/deploy/providers/
  - title: "Налаштування: SMS"
    description: Увімкніть вхідні/вихідні SMS повідомлення через вашого телефонного провайдера.
    href: /docs/deploy/providers/sms
  - title: "Налаштування: WhatsApp"
    description: Підключіть WhatsApp Business через Meta Cloud API.
    href: /docs/deploy/providers/whatsapp
  - title: "Налаштування: Signal"
    description: Налаштуйте канал Signal через міст signal-cli.
    href: /docs/deploy/providers/signal
  - title: "Налаштування: Twilio"
    description: Покроковий посібник з налаштування Twilio як телефонного провайдера.
    href: /docs/deploy/providers/twilio
  - title: "Налаштування: SignalWire"
    description: Покроковий посібник з налаштування SignalWire як телефонного провайдера.
    href: /docs/deploy/providers/signalwire
  - title: "Налаштування: Vonage"
    description: Покроковий посібник з налаштування Vonage як телефонного провайдера.
    href: /docs/deploy/providers/vonage
  - title: "Налаштування: Plivo"
    description: Покроковий посібник з налаштування Plivo як телефонного провайдера.
    href: /docs/deploy/providers/plivo
  - title: "Налаштування: Asterisk (самостійний)"
    description: Розгорніть Asterisk з мостом ARI для максимальної конфіденційності та контролю.
    href: /docs/deploy/providers/asterisk
  - title: Дзвінки в браузері через WebRTC
    description: Увімкніть відповідь на дзвінки в браузері для волонтерів за допомогою WebRTC.
    href: /docs/deploy/providers/webrtc
  - title: Модель безпеки
    description: Зрозумійте, що шифрується, а що ні, та модель загроз.
    href: /security
---

## Огляд архітектури

Llamenos — це самостійно розгортається односторінковий застосунок (SPA), який розгортається через **Docker Compose** або **Kubernetes**. Він підтримує голосові дзвінки, SMS, WhatsApp і Signal — усі спрямовуються до співробітників на зміні через єдиний інтерфейс.

| Компонент | Технологія |
|---|---|
| Frontend | Vite + React + TanStack Router |
| Backend | Bun + Hono + PostgreSQL |
| Blob Storage | RustFS (S3-сумісний) |
| Постачальник ідентифікації | Authentik (самостійний OIDC) |
| Голос | Twilio, SignalWire, Vonage, Plivo або Asterisk |
| Обмін повідомленнями | SMS, WhatsApp Business, Signal |
| Автентифікація | JWT + багатофакторний KEK + WebAuthn passkeys |
| Шифрування | ECIES (secp256k1 + XChaCha20-Poly1305), 3 рівні |
| Транскрипція | Клієнтський Whisper (WASM) — аудіо ніколи не покидає браузер |
| Реальний час | Nostr relay (strfry) |
| i18n | i18next (13 мов) | Same |

## Ролі

| Роль | Може бачити | Може робити |
|---|---|---|
| **Абонент** | Нічого (телефон/SMS/WhatsApp/Signal) | Телефонувати або писати на гарячу лінію |
| **Волонтер** | Власні нотатки, призначені розмови | Відповідати на дзвінки, писати нотатки, відповідати на повідомлення |
| **Репортер** | Лише власні повідомлення | Надсилати зашифровані повідомлення з вкладеними файлами |
| **Адміністратор** | Усі нотатки, повідомлення, розмови, журнали аудиту | Керувати волонтерами, змінами, каналами, заборонами, налаштуваннями |
