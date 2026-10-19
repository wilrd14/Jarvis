# Arranque opcional con Windows: crea/borra un acceso directo en la carpeta Inicio (shell:startup)
# que lanza SOLO el servidor de Jarvis en segundo plano (launch.cmd --server-only), sin abrir ventana.
#   -On          crea el acceso directo       -Off  lo borra
#   -StartupDir  carpeta alternativa (pruebas); por defecto la carpeta Inicio del usuario.
param(
  [switch]$On,
  [switch]$Off,
  [string]$StartupDir = ''
)
if ($On -eq $Off) { Write-Host 'Uso: autostart.ps1 -On | -Off'; exit 2 }
if (-not $StartupDir) { $StartupDir = [Environment]::GetFolderPath('Startup') }
$path = Join-Path $StartupDir 'Jarvis (servidor).lnk'
if ($Off) {
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force; Write-Host "Arranque con Windows desactivado ($path borrado)." }
  else { Write-Host 'El arranque con Windows ya estaba desactivado.' }
  exit 0
}
New-Item -ItemType Directory -Force -Path $StartupDir | Out-Null
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($path)
$lnk.TargetPath = Join-Path $PSScriptRoot 'launch.cmd'
$lnk.Arguments = '--server-only'
$lnk.WorkingDirectory = $root.Path
$lnk.IconLocation = Join-Path $PSScriptRoot 'jarvis.ico'
$lnk.WindowStyle = 7
$lnk.Description = 'Jarvis: servidor en segundo plano'
$lnk.Save()
Write-Host "Arranque con Windows activado: $path"
