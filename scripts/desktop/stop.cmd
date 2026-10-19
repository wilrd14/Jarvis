@echo off
rem Detiene el servidor local de Jarvis (puerto 3737). Solo mata el proceso si es el servidor de Jarvis.
if not defined JARVIS_PORT set "JARVIS_PORT=3737"
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort $env:JARVIS_PORT -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $c = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess)).CommandLine; if ($c -match 'standalone.server\.js') { Stop-Process -Id $_.OwningProcess -Force; 'Jarvis detenido.' } else { 'El puerto ' + $env:JARVIS_PORT + ' lo usa otro programa; no se toca.' } }"
