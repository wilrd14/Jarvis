@echo off
rem Abre Jarvis como aplicacion: arranca el servidor local (si no esta) y una ventana de Edge/Chrome sin barra.
setlocal
pushd "%~dp0..\.."
if not defined JARVIS_PORT set "JARVIS_PORT=3737"
set "PORT=%JARVIS_PORT%"
set "HOSTNAME=127.0.0.1"
set "JARVIS_DATA_DIR=%APPDATA%\Jarvis"
if not exist "%JARVIS_DATA_DIR%" mkdir "%JARVIS_DATA_DIR%"

if not exist ".next\standalone\server.js" (
  echo Falta compilar Jarvis. Ejecuta: npm run app:install
  pause
  exit /b 1
)

rem Si ya hay algo escuchando en el puerto, solo se reutiliza si es Jarvis (lo identifica su manifest).
netstat -ano | findstr /R /C:"127.0.0.1:%PORT% .*LISTENING" >nul
if errorlevel 1 goto start_server
call :is_jarvis && goto ready
echo El puerto %PORT% esta ocupado por otro programa que no es Jarvis.
echo Cierralo e intenta de nuevo.
pause
exit /b 1

:start_server
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process node -ArgumentList '.next/standalone/server.js' -WindowStyle Hidden -RedirectStandardOutput ($env:JARVIS_DATA_DIR + '\server.log') -RedirectStandardError ($env:JARVIS_DATA_DIR + '\server.err.log')"
for /l %%i in (1,1,60) do (
  call :is_jarvis && goto ready
  timeout /t 1 /nobreak >nul
)
echo El servidor de Jarvis no respondio. Revisa %JARVIS_DATA_DIR%\server.err.log
pause
exit /b 1

:ready
start "" msedge --app=http://127.0.0.1:%PORT%/ || start "" chrome --app=http://127.0.0.1:%PORT%/ || start "" http://127.0.0.1:%PORT%/
popd
endlocal
exit /b 0

:is_jarvis
curl.exe -s --max-time 2 "http://127.0.0.1:%PORT%/manifest.webmanifest" | findstr /C:"Jarvis" >nul
exit /b
