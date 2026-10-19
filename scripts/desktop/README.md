# Jarvis de escritorio (Windows)

Jarvis corre con el Node del sistema (firmado) y una ventana de Edge/Chrome en modo aplicacion (`--app`). Servidor en `127.0.0.1:3737`, datos en `%APPDATA%\Jarvis`.

## Por que no hay .exe
Smart App Control bloquea binarios sin firma (un .exe de Electron propio lo seria). Aqui solo se usan Node, Edge/Chrome y scripts; no se toca ninguna proteccion de Windows.

## Instalar
`npm run app:install` compila, genera el icono y crea el acceso directo "Jarvis" en el Escritorio y en el menu Inicio.

Opciones directas: `powershell -ExecutionPolicy Bypass -File scripts/desktop/install.ps1 [-Hotkey CTRL+ALT+J] [-OutDir carpeta]` (`-Hotkey ''` quita el atajo; `-OutDir` crea el .lnk solo en esa carpeta, util para pruebas).

## Atajo de teclado (Ctrl+Alt+J)
Es la tecla de acceso rapido del `.lnk`. Limitaciones: Windows solo la respeta si el `.lnk` esta en el Escritorio o en el menu Inicio, y deja de funcionar si se mueve a otra carpeta. No es un atajo global "real": un programa que ya use esa combinacion, o un cambio de sesion, puede tapar el atajo.

Si Jarvis ya esta abierto, `msedge --app=URL` abre otra ventana (se comprobo), asi que `launch.cmd` busca antes una ventana de Edge/Chrome titulada exactamente "Jarvis" con UI Automation (sin compilar ni instalar nada), la restaura si esta minimizada y la trae al frente. Si no hay, abre una nueva.

## Arranque con Windows (opcional, desactivado por defecto)
- `npm run app:autostart:on` crea `Jarvis (servidor).lnk` en `shell:startup`, que ejecuta `launch.cmd --server-only`: levanta solo el servidor, sin ventana. Es idempotente: si el puerto ya responde "Jarvis" no lo duplica; si lo ocupa otro programa, sale sin tocarlo. Puede verse un instante un cmd minimizado.
- `npm run app:autostart:off` borra ese acceso directo.

## Detener
`scripts\desktop\stop.cmd`: detiene el servidor solo si el proceso del puerto es el de Jarvis (`standalone/server.js`).

## Variables
`JARVIS_PORT` (3737), `JARVIS_DATA_DIR` (`%APPDATA%\Jarvis`), `JARVIS_BROWSER_ARGS` (argumentos extra para el navegador, p. ej. `--user-data-dir=...`).

## Desinstalar
1. `stop.cmd` y `npm run app:autostart:off`.
2. Borrar `Jarvis.lnk` del Escritorio y de `%APPDATA%\Microsoft\Windows\Start Menu\Programs`.
3. Opcional: borrar `%APPDATA%\Jarvis` (ajustes, historial y logs) y la carpeta del repositorio.
