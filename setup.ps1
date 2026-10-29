#requires -Version 5.1
<#
  PC Agent - one command setup.
  Run:  setup.cmd        (or: powershell -ExecutionPolicy Bypass -File setup.ps1)
  Does: Node check/install -> npm install -> folders + config -> shortcuts
        -> start server -> open the login wizard (/setup).
  Safe to run again any time.
#>
param(
  [switch]$NoShortcuts,
  [switch]$NoOpen,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root
$port = if ($env:PORT) { [int]$env:PORT } else { 4780 }
$base = "http://127.0.0.1:$port"

function Say($text) { Write-Host $text }
function Step($text) { Write-Host ''; Write-Host ("== " + $text) }

function Test-Health {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "$base/api/health" -TimeoutSec 3
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Get-NodeInfo {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    $v = (& node -v) 2>$null
    if ($v -match '^v(\d+)\.') {
      $major = [int]$Matches[1]
      if ($major -ge 20) { return @{ Node = $cmd.Source; Npm = (Join-Path (Split-Path -Parent $cmd.Source) 'npm.cmd'); Version = $v } }
    }
    return @{ TooOld = $v }
  }
  return $null
}

function Install-PortableNode {
  Say 'Downloading portable Node.js (no admin needed)...'
  $tools = Join-Path $root 'tools'
  New-Item -ItemType Directory -Force -Path $tools | Out-Null
  $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 60
  $lts = $index | Where-Object { $_.lts -ne $false } | Select-Object -First 1
  if (-not $lts) { throw 'Could not read the Node.js release list.' }
  $ver = $lts.version
  $zip = Join-Path $tools 'node.zip'
  $target = Join-Path $tools "node-$ver-win-x64"
  if (-not (Test-Path -LiteralPath $target)) {
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip" -OutFile $zip -TimeoutSec 600
    Expand-Archive -LiteralPath $zip -DestinationPath $tools -Force
    Remove-Item -LiteralPath $zip -Force
  }
  # autostart shortcuts call plain "node", so the portal copy must stay on PATH
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath -notlike "*$target*") {
    [Environment]::SetEnvironmentVariable('Path', ($target + ';' + $userPath), 'User')
    Say 'Portable Node added to your user PATH.'
  }
  return @{ Node = (Join-Path $target 'node.exe'); Npm = (Join-Path $target 'npm.cmd'); Version = $ver }
}

Step 'Node.js'
$node = Get-NodeInfo
if ($node -and $node.TooOld) {
  Say "Node $($node.TooOld) is too old - need 20 or newer."
  $node = $null
}
if (-not $node) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Say 'Installing Node.js LTS with winget (a Windows prompt may appear - choose Yes)...'
    try {
      & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent
    } catch { Say 'winget install failed - falling back to a portable copy.' }
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $node = Get-NodeInfo
  }
  if (-not $node) { $node = Install-PortableNode }
  if (-not $node) { throw 'Node.js could not be installed. Install Node 20+ from nodejs.org and run setup again.' }
  $env:Path = (Split-Path -Parent $node.Node) + ';' + $env:Path
}
Say ("Node " + $node.Version + " - " + $node.Node)

Step 'Dependencies'
& $node.Npm install --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
Say 'npm packages are in place.'

Step 'Folders and config'
foreach ($dir in 'data', 'workspace', 'profiles', 'workspace/shots', 'workspace/uploads', 'workspace/edits') {
  New-Item -ItemType Directory -Force -Path (Join-Path $root $dir) | Out-Null
}
$seed = Join-Path $root 'scripts/seed-config.mjs'
if (Test-Path -LiteralPath $seed) {
  & $node.Node $seed
  if ($LASTEXITCODE -ne 0) { throw 'Could not write the default config.' }
}

if (-not $NoShortcuts) {
  Step 'Shortcuts'
  $installer = Join-Path $root 'install.ps1'
  if (Test-Path -LiteralPath $installer) {
    try { & powershell -NoProfile -ExecutionPolicy Bypass -File $installer } catch { Say ('Shortcuts skipped: ' + $_.Exception.Message) }
  }
}

Step 'Server'
if (Test-Health) {
  Say "Already running at $base"
} else {
  $log = Join-Path $root 'data/server.log'
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/s', '/c', "set `"NO_OPEN=1`" && `"$($node.Node)`" server.js >> `"$log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden
  $ok = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 1000
    if (Test-Health) { $ok = $true; break }
  }
  if (-not $ok) {
    Say "Server did not answer on $base - recent log:"
    if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 20 }
    throw 'Server failed to start.'
  }
  Say "Started at $base"
}

Step 'Done'
Say "Dashboard : $base"
Say "Login page: $base/setup   <- open this once and log in to each site"
if (-not $NoOpen) {
  Start-Process "$base/setup"
}
