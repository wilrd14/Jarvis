@echo off
rem Abre Jarvis como aplicación: arranca el servidor local (si no está) y una ventana de Edge/Chrome sin barra.
setlocal
pushd "%~dp0..\.."
set "PORT=3737"
set "HOSTNAME=127.0.0.1"
set "JARVIS_DATA_DIR=%APPDATA%\Jarvis"
if not exist "%JARVIS_DATA_DIR%" mkdir "%JARVIS_DATA_DIR%"

if not exist ".next\standalone\server.js" (
  echo Falta compilar Jarvis. Ejecuta: npm run app:install
  pause
  exit /b 1
)

netstat -ano | findstr /R /C:"127.0.0.1:%PORT% .*LISTENING" >nul
if errorlevel 1 (
  powershell -NoProfile -WindowStyle Hidden -Command "Start-Process node -ArgumentList '.next/standalone/server.js' -WindowStyle Hidden -RedirectStandardOutput '%JARVIS_DATA_DIR%\server.log' -RedirectStandardError '%JARVIS_DATA_DIR%\server.err.log'"
  for /l %%i in (1,1,40) do (
    curl.exe -s -o nul "http://127.0.0.1:%PORT%/" && goto ready
    timeout /t 1 /nobreak >nul
  )
  echo El servidor de Jarvis no respondio. Revisa %JARVIS_DATA_DIR%\server.err.log
  pause
  exit /b 1
)

:ready
start "" msedge --app=http://127.0.0.1:%PORT%/ || start "" chrome --app=http://127.0.0.1:%PORT%/
popd
endlocal
