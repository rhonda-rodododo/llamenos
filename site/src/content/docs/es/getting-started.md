---
title: Primeros Pasos
description: Despliega tu propia linea de Llamenos en menos de una hora.
---

Despliega tu propia linea de Llamenos en menos de una hora. Necesitaras una cuenta de Cloudflare, una cuenta de proveedor de telefonia y una maquina con Bun instalado.

## Requisitos previos

- [Bun](https://bun.sh) v1.0 o superior (entorno de ejecucion y gestor de paquetes)
- Una cuenta de [Cloudflare](https://www.cloudflare.com) (el nivel gratuito funciona para desarrollo)
- Una cuenta de proveedor de telefonia — [Twilio](https://www.twilio.com) es el mas facil para empezar, pero Llamenos tambien soporta [SignalWire](/docs/setup-signalwire), [Vonage](/docs/setup-vonage), [Plivo](/docs/setup-plivo) y [Asterisk autoalojado](/docs/setup-asterisk). Consulta la [comparativa de proveedores](/docs/telephony-providers) para elegir.
- Git

## 1. Clonar e instalar

```bash
git clone https://github.com/rikki-llamenos/llamenos.git
cd llamenos
bun install
```

## 2. Generar el par de claves del administrador

Genera un par de claves Nostr para la cuenta de administrador. Esto produce una clave secreta (nsec) y una clave publica (npub/hex).

```bash
bun run bootstrap-admin
```

Guarda el `nsec` de forma segura: es tu credencial de inicio de sesion como administrador. Necesitaras la clave publica en formato hex para el siguiente paso.

## 3. Configurar secretos

Crea un archivo `.dev.vars` en la raiz del proyecto para desarrollo local. Este ejemplo usa Twilio — si usas otro proveedor, puedes omitir las variables de Twilio y configurar tu proveedor a traves de la interfaz de administracion despues del primer inicio de sesion.

```bash
# .dev.vars
TWILIO_ACCOUNT_SID=tu_twilio_account_sid
TWILIO_AUTH_TOKEN=tu_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890
ADMIN_PUBKEY=tu_clave_publica_hex_del_paso_2
ENVIRONMENT=development
```

Para produccion, configura estos como secretos de Wrangler:

```bash
bunx wrangler secret put ADMIN_PUBKEY
# Si usas Twilio como proveedor por defecto via variables de entorno:
bunx wrangler secret put TWILIO_ACCOUNT_SID
bunx wrangler secret put TWILIO_AUTH_TOKEN
bunx wrangler secret put TWILIO_PHONE_NUMBER
```

> **Nota**: Tambien puedes configurar tu proveedor de telefonia completamente a traves de la interfaz de Configuracion del administrador en lugar de usar variables de entorno. Esto es obligatorio para proveedores que no sean Twilio. Consulta la [guia de configuracion de tu proveedor](/docs/telephony-providers).

## 4. Configurar los webhooks de telefonia

Configura tu proveedor de telefonia para enviar webhooks de voz a tu Worker. Las URLs de webhook son las mismas independientemente del proveedor:

- **URL de llamada entrante**: `https://tu-worker.tu-dominio.com/telephony/incoming` (POST)
- **URL de callback de estado**: `https://tu-worker.tu-dominio.com/telephony/status` (POST)

Para instrucciones especificas de cada proveedor, consulta: [Twilio](/docs/setup-twilio), [SignalWire](/docs/setup-signalwire), [Vonage](/docs/setup-vonage), [Plivo](/docs/setup-plivo) o [Asterisk](/docs/setup-asterisk).

Para desarrollo local, necesitaras un tunel (como Cloudflare Tunnel o ngrok) para exponer tu Worker local a tu proveedor de telefonia.

## 5. Ejecutar localmente

Inicia el servidor de desarrollo del Worker (backend + frontend):

```bash
# Construir los assets del frontend primero
bun run build

# Iniciar el servidor de desarrollo del Worker
bun run dev:worker
```

La aplicacion estara disponible en `http://localhost:8787`. Inicia sesion con el nsec de administrador del paso 2.

## 6. Desplegar en Cloudflare

```bash
bun run deploy
```

Esto construye el frontend y despliega el Worker con Durable Objects en Cloudflare. Despues de desplegar, actualiza las URLs de webhook de tu proveedor de telefonia para que apunten a la URL del Worker en produccion.

## Siguientes pasos

- [Guia de Administrador](/es/docs/admin-guide) -- agrega voluntarios, crea turnos, configura ajustes
- [Guia de Voluntario](/es/docs/volunteer-guide) -- comparte con tus voluntarios
- [Proveedores de Telefonia](/docs/telephony-providers) -- compara proveedores y cambia de Twilio si lo necesitas
- [Modelo de Seguridad](/es/security) -- entiende el cifrado y el modelo de amenazas
