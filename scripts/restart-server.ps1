# Queued-safe restart for the PC agent server.
# Refuses while a task is running or waiting, so an in-flight instruction is never cut off.
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restart-server.ps1
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$health = Invoke-RestMethod -Uri "http://127.0.0.1:4780/api/health" -TimeoutSec 8 -ErrorAction SilentlyContinue
if ($health -and ($health.queue.running -ne 0 -or $health.queue.waiting -ne 0)) {
  "BUSY: running=$($health.queue.running) waiting=$($health.queue.waiting) - left alone"
  exit 1
}
$old = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server\.js' }
if ($old) {
  Stop-Process -Id $old.ProcessId -Force
  "stopped pid=$($old.ProcessId)"
  Start-Sleep -Seconds 2
} else {
  "was not running"
}
# Start-Process keeps it alive after this shell exits; a Bash background child would not.
$new = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$root\data\logs\server.out" -RedirectStandardError "$root\data\logs\server.err"
"started pid=$($new.Id)"
Start-Sleep -Seconds 8
try { (Invoke-WebRequest -Uri "http://127.0.0.1:4780/api/health" -UseBasicParsing -TimeoutSec 10).Content }
catch { "health MISSING: $($_.Exception.Message)"; exit 1 }
