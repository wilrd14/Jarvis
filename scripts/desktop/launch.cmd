@echo off
rem Abre Jarvis como aplicacion: arranca el servidor local (si no esta) y una ventana de Edge/Chrome sin barra.
rem   launch.cmd               servidor + ventana (si la ventana ya existe, la trae al frente)
rem   launch.cmd --server-only solo el servidor en segundo plano, sin ventana ni pausas (arranque con Windows)
rem Variables opcionales: JARVIS_PORT (3737), JARVIS_DATA_DIR (%APPDATA%\Jarvis), JARVIS_BROWSER_ARGS (args extra del navegador).
setlocal
set "SERVER_ONLY="
if /i "%~1"=="--server-only" set "SERVER_ONLY=1"
pushd "%~dp0..\.."
if not defined JARVIS_PORT set "JARVIS_PORT=3737"
set "PORT=%JARVIS_PORT%"
set "HOSTNAME=127.0.0.1"
if not defined JARVIS_DATA_DIR set "JARVIS_DATA_DIR=%APPDATA%\Jarvis"
if not exist "%JARVIS_DATA_DIR%" mkdir "%JARVIS_DATA_DIR%"
rem La ruta del servidor viaja por variable de entorno: asi espacios, apostrofos y parentesis no rompen PowerShell.
set "JARVIS_SERVER_JS=%CD%\.next\standalone\server.js"

if not exist "%JARVIS_SERVER_JS%" (
  echo Falta compilar Jarvis. Ejecuta: npm run app:install
  if not defined SERVER_ONLY pause
  popd
  exit /b 1
)

rem Si ya hay algo escuchando en el puerto, solo se reutiliza si es Jarvis (lo identifica su manifest).
netstat -ano | findstr /R /C:"127.0.0.1:%PORT% .*LISTENING" >nul
if errorlevel 1 goto start_server
call :is_jarvis && goto ready
echo El puerto %PORT% esta ocupado por otro programa que no es Jarvis.
echo Cierralo e intenta de nuevo.
if not defined SERVER_ONLY pause
popd
exit /b 1

:start_server
powershell -NoProfile -WindowStyle Hidden -Command "$q=[char]34; Start-Process node -ArgumentList ($q+$env:JARVIS_SERVER_JS+$q) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $env:JARVIS_DATA_DIR 'server.log') -RedirectStandardError (Join-Path $env:JARVIS_DATA_DIR 'server.err.log')"
for /l %%i in (1,1,60) do (
  call :is_jarvis && goto ready
  timeout /t 1 /nobreak >nul
)
echo El servidor de Jarvis no respondio. Revisa server.err.log en la carpeta de datos.
if not defined SERVER_ONLY pause
popd
exit /b 1

:ready
if defined SERVER_ONLY goto done
rem Si ya hay una ventana de Jarvis abierta (msedge/chrome --app abririan otra), se trae al frente en vez de duplicarla.
call :focus_window && goto done
start "" msedge %JARVIS_BROWSER_ARGS% --app=http://127.0.0.1:%PORT%/ || start "" chrome %JARVIS_BROWSER_ARGS% --app=http://127.0.0.1:%PORT%/ || start "" http://127.0.0.1:%PORT%/

:done
popd
endlocal
exit /b 0

:is_jarvis
curl.exe -s --max-time 2 "http://127.0.0.1:%PORT%/manifest.webmanifest" | findstr /C:"Jarvis" >nul
exit /b

:focus_window
powershell -NoProfile -Command "Add-Type -AssemblyName UIAutomationClient; $A=[Windows.Automation.AutomationElement]; $P=[Windows.Automation.PropertyCondition]; $c=New-Object Windows.Automation.AndCondition((New-Object $P($A::NameProperty,'Jarvis')),(New-Object $P($A::ClassNameProperty,'Chrome_WidgetWin_1'))); $w=$A::RootElement.FindFirst('Children',$c); if(-not $w){exit 1}; try{ $wp=$w.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern); if($wp.Current.WindowVisualState -eq 'Minimized'){$wp.SetWindowVisualState('Normal')} }catch{}; try{$w.SetFocus()}catch{}; exit 0"
exit /b
