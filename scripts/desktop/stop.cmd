@echo off
rem Detiene el servidor local de Jarvis (puerto 3737).
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3737 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo Jarvis detenido.
