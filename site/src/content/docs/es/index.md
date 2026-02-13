---
title: Documentacion
description: Aprende a desplegar, configurar y usar Llamenos.
guidesHeading: Guías
guides:
  - title: Primeros Pasos
    description: Requisitos previos, instalacion, configuracion de Twilio y tu primer despliegue.
    href: /docs/getting-started
  - title: Guia de Administrador
    description: Gestiona voluntarios, turnos, listas de bloqueo, campos personalizados y configuracion.
    href: /docs/admin-guide
  - title: Guia de Voluntario
    description: Inicia sesion, recibe llamadas, escribe notas y usa la transcripcion.
    href: /docs/volunteer-guide
  - title: Proveedores de Telefonia
    description: Compara los proveedores de telefonia soportados y elige el mejor para tu linea.
    href: /docs/telephony-providers
  - title: "Configurar Twilio"
    description: Guia paso a paso para configurar Twilio como proveedor de telefonia.
    href: /docs/setup-twilio
  - title: "Configurar SignalWire"
    description: Guia paso a paso para configurar SignalWire como proveedor de telefonia.
    href: /docs/setup-signalwire
  - title: "Configurar Vonage"
    description: Guia paso a paso para configurar Vonage como proveedor de telefonia.
    href: /docs/setup-vonage
  - title: "Configurar Plivo"
    description: Guia paso a paso para configurar Plivo como proveedor de telefonia.
    href: /docs/setup-plivo
  - title: "Configurar Asterisk (Autoalojado)"
    description: Despliega Asterisk con el bridge ARI para maxima privacidad y control.
    href: /docs/setup-asterisk
  - title: Llamadas WebRTC en el Navegador
    description: Habilita la atencion de llamadas en el navegador para voluntarios usando WebRTC.
    href: /docs/webrtc-calling
  - title: Modelo de Seguridad
    description: Entiende que esta cifrado, que no lo esta y el modelo de amenazas.
    href: /security
---

## Arquitectura general

Llamenos es una aplicacion de pagina unica (SPA) respaldada por Cloudflare Workers y Durable Objects. No hay servidores tradicionales que gestionar.

| Componente | Tecnologia |
|---|---|
| Frontend | Vite + React + TanStack Router |
| Backend | Cloudflare Workers + Durable Objects |
| Telefonia | Twilio (via interfaz TelephonyAdapter) |
| Autenticacion | Claves Nostr (BIP-340 Schnorr) + WebAuthn |
| Cifrado | ECIES (secp256k1 + XChaCha20-Poly1305) |
| Transcripcion | Cloudflare Workers AI (Whisper) |
| i18n | i18next (12+ idiomas) |

## Roles

| Rol | Puede ver | Puede hacer |
|---|---|---|
| **Persona que llama** | Nada (telefono GSM) | Llamar al numero de la linea |
| **Voluntario** | Solo sus propias notas | Contestar llamadas, escribir notas durante su turno |
| **Administrador** | Todas las notas, registros de auditoria, datos de llamadas | Gestionar voluntarios, turnos, bloqueos, configuracion |
