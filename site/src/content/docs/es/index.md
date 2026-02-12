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
