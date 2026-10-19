# Crea los accesos directos de Jarvis (escritorio y menú Inicio). No requiere administrador.
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$launch = Join-Path $PSScriptRoot 'launch.cmd'
$icon = Join-Path $PSScriptRoot 'jarvis.ico'
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
)
foreach ($dir in $targets) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Jarvis.lnk'))
  $lnk.TargetPath = $launch
  $lnk.WorkingDirectory = $root.Path
  $lnk.IconLocation = $icon
  $lnk.WindowStyle = 7
  $lnk.Description = 'Jarvis, asistente de voz'
  $lnk.Save()
  Write-Host "Acceso directo creado en $dir"
}
