---
title: Funcionalidades
subtitle: Todo lo que una linea de crisis necesita, en un paquete de codigo abierto. Construido sobre Cloudflare Workers sin servidores que administrar.
---

## Enrutamiento de llamadas

**Timbre en paralelo** — Cuando un llamante marca, todos los voluntarios en turno y disponibles suenan simultaneamente. El primer voluntario que conteste toma la llamada; el timbre de los demas se detiene de inmediato.

**Turnos programados** — Crea turnos recurrentes con dias y rangos horarios especificos. Asigna voluntarios a turnos. El sistema enruta las llamadas automaticamente a quien este de servicio.

**Cola con musica de espera** — Si todos los voluntarios estan ocupados, los llamantes entran en una cola con musica de espera configurable. El tiempo de espera es ajustable (30-300 segundos). Cuando nadie responde, las llamadas pasan al buzon de voz.

**Buzon de voz como respaldo** — Los llamantes pueden dejar un mensaje de voz (hasta 5 minutos) si ningun voluntario responde. Los mensajes de voz se transcriben con Whisper AI y se cifran para revision del administrador.

## Notas cifradas

**Notas con cifrado de extremo a extremo** — Los voluntarios escriben notas durante y despues de las llamadas. Las notas se cifran en el navegador usando ECIES (secp256k1 + XChaCha20-Poly1305) antes de salir del navegador. El servidor almacena solo texto cifrado.

**Doble cifrado** — Cada nota se cifra dos veces: una para el voluntario que la escribio y otra para el administrador. Ambos pueden descifrar de forma independiente. Nadie mas puede leer el contenido.

**Campos personalizados** — Los administradores definen campos personalizados para las notas: texto, numero, seleccion, casilla de verificacion, area de texto. Los campos se cifran junto con el contenido de la nota.

**Autoguardado de borradores** — Las notas se guardan automaticamente como borradores cifrados en el navegador. Si la pagina se recarga o el voluntario navega a otro lugar, su trabajo se conserva. Los borradores se eliminan al cerrar sesion.

## Transcripcion con IA

**Transcripcion con Whisper** — Las grabaciones de llamadas se transcriben usando Cloudflare Workers AI con el modelo Whisper. La transcripcion ocurre en el servidor y luego se cifra antes del almacenamiento.

**Controles de activacion** — El administrador puede habilitar o deshabilitar la transcripcion de forma global. Los voluntarios pueden desactivarla individualmente. Ambos controles son independientes.

**Transcripciones cifradas** — Las transcripciones usan el mismo cifrado ECIES que las notas. Lo que se almacena es solo texto cifrado.

## Mitigacion de spam

**CAPTCHA por voz** — Deteccion opcional de bots por voz: los llamantes escuchan un numero aleatorio de 4 digitos y deben ingresarlo en el teclado. Bloquea llamadas automatizadas mientras permanece accesible para llamantes reales.

**Limite de frecuencia** — Limite de frecuencia por ventana deslizante por numero de telefono, persistido en almacenamiento de Durable Object. Sobrevive a reinicios del Worker. Umbrales configurables.

**Listas de bloqueo en tiempo real** — Los administradores gestionan listas de bloqueo de numeros telefonicos con entrada individual o importacion masiva. Los bloqueos surten efecto de inmediato. Los llamantes bloqueados escuchan un mensaje de rechazo.

**Mensajes IVR personalizados** — Graba mensajes de voz personalizados para cada idioma soportado. El sistema usa tus grabaciones para los flujos IVR, recurriendo a texto a voz cuando no existe una grabacion.

## Panel de administracion

**Monitoreo de llamadas en tiempo real** — Ve las llamadas activas, los llamantes en cola y el estado de los voluntarios en tiempo real via WebSocket. Las metricas se actualizan al instante.

**Gestion de voluntarios** — Agrega voluntarios con pares de claves generados, gestiona roles, consulta el estado en linea. Enlaces de invitacion para autoregistro.

**Registro de auditoria** — Cada llamada respondida, nota creada, configuracion modificada y accion de administrador queda registrada. Visor paginado para administradores.

**Historial de llamadas** — Historial de llamadas con busqueda, filtros por rango de fechas, busqueda por numero de telefono y asignacion de voluntarios. Exportacion de datos compatible con GDPR.

## Multilenguaje y movil

**12+ idiomas** — Traducciones completas de la interfaz: ingles, espanol, chino, tagalo, vietnamita, arabe, frances, criollo haitiano, coreano, ruso, hindi, portugues y aleman. Soporte RTL para arabe.

**Aplicacion web progresiva** — Instalable en cualquier dispositivo desde el navegador. El service worker almacena en cache la estructura de la app para lanzamiento sin conexion. Notificaciones push para llamadas entrantes.

**Diseno mobile-first** — Diseno responsivo construido para telefonos y tabletas. Barra lateral plegable, controles tactiles y disenos adaptables.

## Autenticacion

**Autenticacion con claves Nostr** — Los voluntarios se autentican con pares de claves compatibles con Nostr (nsec/npub). Verificacion de firma BIP-340 Schnorr. Sin contrasenas, sin direcciones de correo electronico.

**Passkeys con WebAuthn** — Soporte opcional de passkeys para inicio de sesion en multiples dispositivos. Registra una llave de hardware o biometria, y luego inicia sesion sin escribir tu clave secreta.

**Gestion de sesiones** — Tokens de sesion de 8 horas con avisos de inactividad. Renovacion de sesion, dialogos de expiracion y limpieza automatica.
