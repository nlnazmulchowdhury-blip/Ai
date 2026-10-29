$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js not found. Install Node.js 20+ first, then run this again.'
  exit 1
}
$open = Join-Path $root 'start-agent.vbs'
$silent = Join-Path $root 'start-agent-silent.vbs'
if (-not (Test-Path -LiteralPath $open) -or -not (Test-Path -LiteralPath $silent)) {
  Write-Host 'start-agent.vbs / start-agent-silent.vbs missing next to this installer.'
  exit 1
}

$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$icon = "$($node.Source),0"
$shell = New-Object -ComObject WScript.Shell

function New-Shortcut($path, $arguments, $description) {
  $sc = $shell.CreateShortcut($path)
  $sc.TargetPath = $wscript
  $sc.Arguments = $arguments
  $sc.WorkingDirectory = $root
  $sc.IconLocation = $icon
  $sc.Description = $description
  $sc.Save()
}

$desktop = $shell.SpecialFolders('Desktop')
$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\PC Agent'
$startup = [Environment]::GetFolderPath('Startup')
New-Item -ItemType Directory -Force -Path $programs | Out-Null

New-Shortcut (Join-Path $desktop 'PC Agent.lnk') ('"' + $open + '"') 'PC Agent - local AI dashboard'
New-Shortcut (Join-Path $programs 'PC Agent.lnk') ('"' + $open + '"') 'PC Agent - local AI dashboard'
New-Shortcut (Join-Path $startup 'PC Agent (autostart).lnk') ('"' + $silent + '"') 'PC Agent - start hidden at login'

Write-Host 'Installed:'
Write-Host ("  desktop   : " + (Join-Path $desktop 'PC Agent.lnk'))
Write-Host ("  start menu: " + (Join-Path $programs 'PC Agent.lnk'))
Write-Host ("  autostart : " + (Join-Path $startup 'PC Agent (autostart).lnk'))
