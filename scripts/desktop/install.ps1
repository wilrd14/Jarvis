# Crea los accesos directos de Jarvis (escritorio y menu Inicio). No requiere administrador.
#   -Hotkey  Tecla de acceso rapido del .lnk (por defecto CTRL+ALT+J; '' para no poner ninguna).
#            Windows solo la respeta si el .lnk esta en el Escritorio o en el menu Inicio.
#   -OutDir  Crea el acceso directo solo en esta carpeta (pruebas); no toca Escritorio ni Inicio.
param(
  [string]$Hotkey = 'CTRL+ALT+J',
  [string]$OutDir = ''
)
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$launch = Join-Path $PSScriptRoot 'launch.cmd'
$icon = Join-Path $PSScriptRoot 'jarvis.ico'
$shell = New-Object -ComObject WScript.Shell
if ($OutDir) {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $targets = @($OutDir)
} else {
  $targets = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
  )
}
foreach ($dir in $targets) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Jarvis.lnk'))
  $lnk.TargetPath = $launch
  $lnk.WorkingDirectory = $root.Path
  $lnk.IconLocation = $icon
  $lnk.WindowStyle = 7
  $lnk.Description = 'Jarvis, asistente de voz'
  if ($Hotkey) { $lnk.Hotkey = $Hotkey }
  $lnk.Save()
  Write-Host "Acceso directo creado en $dir (atajo: $(if ($Hotkey) { $Hotkey } else { 'ninguno' }))"
}
