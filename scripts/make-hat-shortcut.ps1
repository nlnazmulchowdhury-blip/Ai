$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
Write-Output "desktop=$desktop"
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
$lnkPath = Join-Path $desktop 'Agent Hat.lnk'
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($lnkPath)
# .vbs লঞ্চার এই ফোল্ডারে রাখাই যায় না — নতুন তৈরি প্রতিটি .vbs এক-দুই মিনিটের মধ্যে
# অদৃশ্য হয় (স্ক্রিন-শটের ডায়ালগটাও তাই এসেছিল), তাই সরাসরি powershell, মিনিমাইজড স্টাইলে
$lnk.TargetPath = 'powershell.exe'
$lnk.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $root 'scripts\start-widget.ps1') + '"'
$lnk.WindowStyle = 7
$lnk.WorkingDirectory = $root
$lnk.IconLocation = "$edge,0"
$lnk.Description = 'ডান কোণায় এজেন্ট হাট চেট'
$lnk.Save()
Write-Output "created=$lnkPath exists=$(Test-Path $lnkPath)"
