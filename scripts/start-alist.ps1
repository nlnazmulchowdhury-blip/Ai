$dir = "C:\Users\nlnaz\Downloads\Compressed\alist-windows-amd64"
$existing = Get-Process -Name alist -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output "already running pid=$($existing.Id)"
} else {
  $p = Start-Process -FilePath "$dir\alist.exe" -ArgumentList "server" -WorkingDirectory $dir -WindowStyle Hidden -PassThru
  Write-Output "started pid=$($p.Id)"
}
Start-Sleep -Seconds 4
try {
  $r = Invoke-WebRequest -Uri "http://localhost:5244/api/public/settings" -UseBasicParsing -TimeoutSec 10
  Write-Output "http=$($r.StatusCode)"
} catch {
  Write-Output "not up yet: $($_.Exception.Message)"
}
