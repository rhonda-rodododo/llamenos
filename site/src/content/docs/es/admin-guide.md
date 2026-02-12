---
title: Guia de Administrador
description: Gestiona todo — voluntarios, turnos, configuracion de llamadas, listas de bloqueo y campos personalizados.
---

Como administrador, gestionas todo: voluntarios, turnos, configuracion de llamadas, listas de bloqueo y campos personalizados. Esta guia cubre los flujos de trabajo principales del administrador.

## Iniciar sesion

Inicia sesion con el `nsec` (clave secreta Nostr) generado durante la [configuracion inicial](/es/docs/getting-started). La pagina de inicio de sesion acepta el formato nsec (`nsec1...`). Tu navegador firma un desafio con la clave, y el secreto nunca sale del dispositivo.

Opcionalmente, registra una passkey de WebAuthn en Configuracion para iniciar sesion sin contrasena en otros dispositivos.

## Gestion de voluntarios

Navega a **Voluntarios** en la barra lateral para:

- **Agregar un voluntario** -- genera un nuevo par de claves Nostr. Comparte el nsec de forma segura con el voluntario (se muestra una sola vez).
- **Crear un enlace de invitacion** -- genera un enlace de uso unico que un voluntario puede usar para registrarse.
- **Editar** -- actualizar nombre, numero de telefono y rol.
- **Eliminar** -- desactivar el acceso de un voluntario.

Los numeros de telefono de los voluntarios solo son visibles para los administradores. Se usan para el timbre en paralelo cuando el voluntario esta en turno.

## Configuracion de turnos

Navega a **Turnos** para crear horarios recurrentes:

1. Haz clic en **Agregar Turno**
2. Establece un nombre, selecciona los dias de la semana y define las horas de inicio y fin
3. Asigna voluntarios usando el selector multiple con busqueda
4. Guarda: el sistema enrutara automaticamente las llamadas a los voluntarios del turno activo

Configura un **Grupo de Respaldo** en la parte inferior de la pagina de turnos. Estos voluntarios recibiran las llamadas cuando no haya un turno programado activo.

## Listas de bloqueo

Navega a **Bloqueos** para gestionar numeros de telefono bloqueados:

- **Entrada individual** -- escribe un numero de telefono en formato E.164 (por ejemplo, +15551234567)
- **Importacion masiva** -- pega multiples numeros, uno por linea
- **Eliminar** -- desbloquea un numero al instante

Los bloqueos toman efecto inmediatamente. Las personas bloqueadas escuchan un mensaje de rechazo y se desconectan.

## Configuracion de llamadas

En **Configuracion**, encontraras varias secciones:

### Mitigacion de spam

- **CAPTCHA de voz** -- activar/desactivar. Cuando esta habilitado, las personas que llaman deben ingresar un codigo aleatorio de 4 digitos.
- **Limitacion de frecuencia** -- activar/desactivar. Limita las llamadas por numero de telefono dentro de una ventana de tiempo deslizante.

### Transcripcion

- **Interruptor global** -- habilitar/deshabilitar la transcripcion con Whisper para todas las llamadas.
- Los voluntarios individuales tambien pueden desactivarla desde su propia configuracion.

### Configuracion de llamadas

- **Tiempo de espera en cola** -- cuanto tiempo esperan las personas antes de ir al buzon de voz (30-300 segundos).
- **Duracion maxima del buzon de voz** -- duracion maxima de la grabacion (30-300 segundos).

### Campos personalizados de notas

Define campos estructurados que aparecen en el formulario de notas:

- Tipos soportados: texto, numero, seleccion (desplegable), casilla de verificacion, area de texto
- Configura validacion: requerido, longitud minima/maxima, valor minimo/maximo
- Controla la visibilidad: elige que campos pueden ver y editar los voluntarios
- Reordena campos usando las flechas arriba/abajo
- Maximo 20 campos, maximo 50 opciones por campo de seleccion

Los valores de los campos personalizados se cifran junto con el contenido de la nota. El servidor nunca los ve.

### Mensajes de voz

Graba mensajes de audio IVR personalizados para cada idioma soportado. El sistema usa tus grabaciones para los flujos de saludo, CAPTCHA, cola y buzon de voz. Donde no exista una grabacion, se recurre a la sintesis de voz.

### Politica de WebAuthn

Opcionalmente requiere passkeys para administradores, voluntarios o ambos. Cuando es requerido, los usuarios deben registrar una passkey antes de poder usar la aplicacion.

## Registro de auditoria

La pagina de **Registro de Auditoria** muestra una lista cronologica de eventos del sistema: inicios de sesion, llamadas contestadas, creacion de notas, cambios de configuracion y acciones administrativas. Las entradas incluyen direcciones IP hasheadas y metadatos de pais. Usa la paginacion para navegar el historial.

## Historial de llamadas

La pagina de **Llamadas** muestra todas las llamadas con estado, duracion y voluntario asignado. Filtra por rango de fechas o busca por numero de telefono. Exporta datos en formato JSON compatible con GDPR.
