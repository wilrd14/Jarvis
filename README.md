<div align="center">

<img src="public/logo.svg" alt="Jarvis" width="120" />

# Jarvis

**Asistente de voz personal con núcleo holográfico, que corre en tu propio PC.**
Hablas, te responde en voz alta y hace cosas reales: abrir apps, crear documentos, recordarte cosas o ver tu pantalla.

Next.js 16 · TypeScript · Tailwind · Framer Motion · OpenRouter

</div>

---

## Qué hace

### Conversación por voz
- **Entrada automática:** hablas y, cuando haces una pausa, Jarvis procesa el audio. No hay que mantener nada pulsado.
- **Voz en tiempo real:** empieza a hablar frase por frase mientras todavía piensa la respuesta, con la cola de audio sin cortes.
- **Modo conversación:** reabre el micrófono solo tras responder, para hablar de seguido.
- **Elección de modelo:** un modelo rápido y barato para charla y órdenes sencillas, y uno potente para lo difícil.
- **Caché de voz** en disco para no pagar dos veces por la misma frase, y **contador de gasto** con tu saldo real de OpenRouter, tope mensual opcional y bloqueo al superarlo.

### Órdenes instantáneas (sin IA, sin coste)
Volumen, abrir carpetas y apps, captura de pantalla, bloquear el equipo, temporizadores, notas, hora y fecha, saludos.

### Acciones sobre tu PC
Correo y calendario, portapapeles, buscar y abrir archivos, abrir apps, carpetas y páginas, volumen, bloqueo de pantalla, capturas, notas, recordatorios, temporizadores y alarmas, y resumen del día (clima, agenda y recordatorios). Las acciones con efecto piden confirmación con una tarjeta.

### Entiende tu pantalla
«¿Qué estoy viendo?»: captura la pantalla y la analiza con un modelo de visión.

### Documentos
Crea documentos hablando, en **Word, PDF, Excel, PowerPoint, Markdown, HTML, texto y CSV**. Se guardan en `Documentos\Jarvis` sin sobrescribir nada. La tarjeta de confirmación muestra el coste estimado: sin coste si el contenido ya está dictado, o un máximo estimado si Jarvis tiene que redactarlo.

### Skills
Instrucciones en Markdown que Jarvis aplica al redactar. Una skill puede ser un `.md` suelto o una carpeta con `SKILL.md`. Trae 7 en español (informe formal, carta formal, acta de reunión, resumen ejecutivo, CV, propuesta comercial, informe universitario) y puedes crear las tuyas desde Ajustes. Solo se leen instrucciones: nunca se ejecuta código de una skill. Guía en [`docs/documentos-y-skills.md`](docs/documentos-y-skills.md).

### Memoria a largo plazo
Recuerda lo que le pides que recuerde («recuerda que…») y lo usa en conversaciones futuras. Se puede desactivar y borrar.

### Usarlo desde el celular, en privado
Con [Tailscale](https://tailscale.com) abres Jarvis desde el móvil como una app, sin exponerlo a internet. Detalles abajo.

---

## Instalación en Windows

Jarvis corre como programa local: un servidor en `127.0.0.1:3737` y una ventana de Edge/Chrome en modo aplicación. No hay `.exe` sin firmar, así que funciona con Smart App Control activado y no toca ninguna protección de Windows.

```bash
npm install
npm run app:install     # compila y crea el acceso directo «Jarvis» (atajo Ctrl+Alt+J)
```

1. Abre Jarvis desde el acceso directo y entra en **Ajustes**.
2. Pega tu API key de OpenRouter (se guarda en `%APPDATA%\Jarvis\settings.json`, nunca en el repositorio).

Arranque con Windows (opcional): `npm run app:autostart:on` / `npm run app:autostart:off`.
Más detalles, variables y desinstalación en [`scripts/desktop/README.md`](scripts/desktop/README.md).

### Desarrollo

```bash
npm run dev             # http://localhost:3000
npm run lint
npm run test:e2e        # suites E2E seguras (ver tests/run-all.mjs)
```

Las suites sin coste usan una key falsa y un servidor standalone temporal; las marcadas `*-live` llaman a OpenRouter de verdad y no se ejecutan solas.

---

## Usarlo desde el celular (Tailscale)

Jarvis sigue escuchando solo en `127.0.0.1`. Tailscale lo publica con HTTPS dentro de tu red privada, así que solo tus dispositivos pueden abrirlo.

1. Instala Tailscale en el PC y en el celular, con la misma cuenta.
2. En Jarvis → **Ajustes → Usar Jarvis en el celular (privado)**: usa la dirección detectada, pulsa «Publicar» (HTTPS, necesario para el micrófono), define un PIN y activa el interruptor.
3. En el celular abre `https://<tu-pc>.<tu-red>.ts.net`, introduce el PIN y añádela a la pantalla de inicio.

Las acciones sobre el PC (abrir apps, bloquear, documentos…) se ejecutan en el PC, como un control remoto. El PC tiene que estar encendido y sin suspenderse.

---

## Seguridad

- Servidor solo en loopback; el encabezado `Host`, el origen (`Sec-Fetch-Site`/`Origin`) y el tipo de contenido se validan en cada petición, para frenar CSRF y DNS rebinding desde otras webs.
- Lista cerrada de acciones con validación estricta. Las que tienen efecto necesitan confirmación y una **firma HMAC** emitida por el cerebro; lo que entra desde fuera (p. ej. el portapapeles) nunca ejecuta acciones solo.
- Las API keys no salen del servidor, no se escriben en logs ni en el repositorio, y los procesos hijos no las heredan.
- Acceso remoto: solo hosts `.ts.net` configurados, PIN con scrypt, cookie de sesión firmada (`HttpOnly`, `Secure`, `SameSite=Strict`), bloqueo tras 5 intentos fallidos, y Ajustes/PIN modificables solo desde el propio PC.
- Los documentos solo se escriben en `Documentos\Jarvis` y sin sobrescribir.

---

## Estructura

```
src/app/            páginas y rutas /api (cerebro, voz, acciones, documentos, skills, remoto…)
src/lib/actions/    registro de acciones (una por archivo)
src/lib/docs/       motor de documentos y renderizadores
src/components/     interfaz (holograma, ajustes, tarjetas de confirmación)
skills-bundled/     skills incluidas
scripts/desktop/    instalador, lanzador y autoarranque de Windows
tests/              suites E2E
```

## Costes

Todo pasa por OpenRouter y se paga por uso. Las órdenes locales no cuestan nada; el modelo rápido y la caché de voz reducen el gasto, y Jarvis muestra tu saldo real y puede bloquearse al llegar a un tope mensual.
