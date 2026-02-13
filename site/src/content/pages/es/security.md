---
title: Modelo de seguridad y privacidad
subtitle: Una evaluacion honesta de lo que Llamenos cifra de extremo a extremo, lo que el servidor puede ver y lo que estamos trabajando para mejorar.
---

## Que esta cifrado de extremo a extremo

<details>
<summary><strong>Notas de llamadas</strong></summary>

Las notas se cifran en el navegador usando ECIES: un intercambio de claves ECDH efimero sobre secp256k1, seguido de cifrado simetrico XChaCha20-Poly1305. El contenido cifrado sale del navegador — el servidor almacena solo texto cifrado. Cada nota tiene doble cifrado: una copia para el voluntario que la escribio, otra para el administrador. Ambos pueden descifrar de forma independiente usando sus claves privadas.

</details>

<details>
<summary><strong>Transcripciones de llamadas</strong></summary>

Despues de la transcripcion, el texto resultante se cifra usando el mismo esquema ECIES antes de almacenarse. Lo que se guarda es solo texto cifrado. Tanto el voluntario como el administrador reciben copias cifradas de forma independiente.

</details>

<details>
<summary><strong>Valores de campos personalizados</strong></summary>

Los campos personalizados definidos por el administrador (texto, numero, seleccion, casilla de verificacion, area de texto) se cifran junto con el contenido de la nota usando el mismo cifrado ECIES. Las definiciones de los campos (nombres, tipos, opciones) se almacenan en texto plano para la interfaz del formulario, pero todos los valores ingresados por el usuario se cifran antes de salir del navegador.

</details>

<details>
<summary><strong>Borradores de notas</strong></summary>

Las notas en progreso se guardan automaticamente como borradores cifrados en el localStorage del navegador. Se cifran con la clave publica del voluntario antes de almacenarse. Los borradores se eliminan del localStorage al cerrar sesion.

</details>

## Lo que el servidor nunca ve

- Contenido de las notas (texto libre y valores de campos personalizados)
- Texto de transcripciones despues del cifrado
- Claves secretas de voluntarios (nsec) — la autenticacion usa firmas de desafio-respuesta
- Contenido de borradores de notas (almacenados localmente en el navegador)

## Limitaciones honestas

<details>
<summary><strong>Las llamadas de voz pasan por la PSTN y tu proveedor de telefonia</strong></summary>

Cuando se usa un proveedor en la nube (Twilio, SignalWire, Vonage o Plivo), Llamenos enruta las llamadas a traves de la red telefonica publica conmutada (PSTN) via la infraestructura de ese proveedor. Esto significa que el proveedor procesa el audio de las llamadas en tiempo real y puede tecnicamente acceder a el durante el transito. Esta es una limitacion inherente de la telefonia en la nube basada en PSTN. Para maxima privacidad, Llamenos tambien soporta Asterisk autoalojado con troncales SIP, lo que elimina al proveedor tercero por completo.

</details>

<details>
<summary><strong>La transcripcion requiere acceso al audio en el servidor</strong></summary>

Las grabaciones de llamadas se transcriben en el servidor usando Cloudflare Workers AI (Whisper). Durante la transcripcion, el servidor tiene acceso transitorio al audio. Despues de completar la transcripcion, el texto se cifra inmediatamente y la referencia al audio se descarta. La ventana de acceso al texto plano se minimiza pero existe.

</details>

<details>
<summary><strong>Los metadatos de llamadas son visibles para el servidor</strong></summary>

Marcas de tiempo, duraciones de llamadas, decisiones de enrutamiento, posiciones en la cola y que voluntario respondio — todo esto son metadatos operacionales que el servidor necesita para funcionar. Los numeros de telefono se almacenan para la verificacion de listas de bloqueo, pero no se incluyen en las transmisiones WebSocket a los voluntarios. La identidad del llamante se redacta de las actualizaciones en tiempo real.

</details>

## Modelo de amenazas

Llamenos esta disenado para proteger a los voluntarios y llamantes de lineas de crisis contra:

1. **Filtracion de base de datos** — Un atacante que obtenga la base de datos solo obtiene texto cifrado de notas y transcripciones. Sin las claves privadas del voluntario o administrador, el contenido es ilegible.
2. **Servidor comprometido** — Un servidor comprometido puede ver metadatos de llamadas y tiene acceso transitorio al audio durante la transcripcion, pero no puede leer notas ni transcripciones almacenadas.
3. **Vigilancia de red** — Todas las conexiones usan TLS. Las conexiones WebSocket estan autenticadas. El servidor aplica HSTS y encabezados CSP estrictos.
4. **Suplantacion de voluntario** — La autenticacion usa firmas BIP-340 Schnorr. Sin la clave privada del voluntario, el inicio de sesion es imposible. Los passkeys de WebAuthn agregan un segundo factor respaldado por hardware.
5. **Amenaza interna (voluntario)** — Los voluntarios solo pueden descifrar sus propias notas. No pueden ver las notas de otros voluntarios, informacion personal ni datos exclusivos del administrador.

Ningun sistema es perfectamente seguro. El objetivo es minimizar la superficie de confianza y ser transparentes sobre lo que queda.

## En lo que estamos trabajando

<details>
<summary><strong>Llamadas en el navegador con WebRTC</strong></summary>

Migrar las llamadas de voz de PSTN/proveedores en la nube a WebRTC permite audio directo de navegador a navegador, eliminando al proveedor de telefonia de la ruta de voz por completo. Llamenos ya soporta llamadas WebRTC para voluntarios — combinado con una instalacion de Asterisk autoalojado, toda la ruta de voz puede evitar la infraestructura de terceros.

</details>

<details>
<summary><strong>Transcripcion en el cliente</strong></summary>

Ejecutar Whisper (o un modelo similar) directamente en el navegador via WebAssembly o WebGPU eliminaria por completo el acceso al audio en el servidor. La transcripcion se generaria localmente y se cifraria antes de subirla.

</details>

<details>
<summary><strong>Builds reproducibles</strong></summary>

Compilaciones deterministas que permitan a cualquier persona verificar que el codigo desplegado coincide con el repositorio de codigo abierto, asegurando que no se hayan introducido modificaciones del lado del servidor.

</details>

## Verificalo tu mismo

Llamenos es completamente de codigo abierto. Cada operacion de cifrado, cada endpoint de API, cada verificacion del lado del cliente — todo esta en el repositorio. Lee el codigo, audita la criptografia, reporta problemas. [github.com/rikki-llamenos/llamenos](https://github.com/rikki-llamenos/llamenos)
