param([switch]$Stop, [int]$CollapsedW = 380, [int]$CollapsedH = 128, [int]$ExpandedW = 380, [int]$ExpandedH = 600)

# Agent Hat: an Edge app-window pinned to the bottom-right corner, above every app.
# -Stop only ever touches msedge processes using our own widget-edge profile dir.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$profile = Join-Path $root 'data\widget-edge'
$stateFile = Join-Path $root 'data\widget.json'
$hbFile = Join-Path $root 'data\widget.hb'
$logFile = Join-Path $root 'data\widget.log'
$url = 'http://127.0.0.1:4780/widget'

function Log([string]$msg) {
  try { Add-Content -Path $logFile -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -Encoding ASCII } catch { }
}
# RAM-চাপে powershell-ই মরে যেতে পারে — প্রথম লাইনেই চিহ্ন রেখে দিই, তাহলে লগ বলে
# "এনফোর্সার এসেছিল" নাকি "এসেই ছিল না"
Log "enforcer starting pid=$PID"
# $ErrorActionPreference='Stop' + Add-Type-এর C# কম্পাইল — RAM কম থাকলে সেখানেই থেমে যায়,
# আর স্ক্রিপ্ট নীরবে মরে যেত। trap সেটা ধরে লগে লেখে, তাই কারণ দেখা যায়
trap { Log "fatal: $($_.Exception.Message)"; break }

$edgeCandidates = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
)
$edge = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Log 'no msedge.exe'; Write-Output 'no msedge.exe found'; exit 1 }

function Get-WidgetEdgePid {
  @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*widget-edge*' } |
    Select-Object -ExpandProperty ProcessId)
}

function Write-StopState {
  try {
    ([pscustomobject]@{ mode = 'expanded'; running = $false; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }) |
      ConvertTo-Json | Set-Content -Path $stateFile -Encoding ASCII
    Set-Content -Path $hbFile -Value '0' -Encoding ASCII
  } catch { }
}

if ($Stop) {
  foreach ($p in (Get-WidgetEdgePid)) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  Write-StopState
  Log 'stopped by request'
  Write-Output 'widget stopped'
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms

$sources = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Hat {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr l);
  // CharSet.Unicode না দলে PowerShell-এর ডিফল্ট Ansi marshalling — বাংলা টাইটেল থেকে মাত্র ১ অক্ষর পড়া যায়
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern IntPtr SetWindowLongPtrW(IntPtr h, int idx, IntPtr val);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  // এজ কাস্টম-ফ্রেম: টাইটেল-বারটা DWM আঁকে না, নিজে আঁকে — DWMWA_USE_IMMERSIVE_DARK_MODE সেট হলেও রং বদলায় না
  // (34/35/36 = বর্ডার/ক্যাপশন/টেক্সট কালার এই বিল্ডে E_INVALIDARG)। বার কালো করতে লাগে --force-dark-mode
  public static void DarkFrame(IntPtr h) {
    int on = 1;
    DwmSetWindowAttribute(h, 20, ref on, 4);  // DWMWA_USE_IMMERSIVE_DARK_MODE
    int black = 0x000000;                      // COLORREF = 0x00BBGGRR — সাপোর্ট থাকলে কাজে লাগে
    DwmSetWindowAttribute(h, 34, ref black, 4);
    DwmSetWindowAttribute(h, 35, ref black, 4);
  }

  // এজ প্রোফাইলটা মিনিমাইজড অবস্থা মনে রাখে — মিনিমাইজড উইন্ডোতে SetWindowPos শুধু জায়গা বদলায়, সাইজ না
  public static void Restore(IntPtr h) { if (IsIconic(h)) ShowWindow(h, 9); }  // SW_RESTORE

  // the app frame is the only visible window of that pid carrying a title
  public static IntPtr FindTitledWindow(int pid) {
    IntPtr result = IntPtr.Zero;
    EnumProc cb = delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p != (uint)pid) return true;
      StringBuilder sb = new StringBuilder(256);
      if (GetWindowTextW(h, sb, sb.Capacity) > 0) { result = h; return false; }
      return true;
    };
    EnumWindows(cb, IntPtr.Zero);
    return result;
  }

  public static bool Alive(IntPtr h) { return h != IntPtr.Zero && IsWindow(h); }

  public static void ForceTop(IntPtr h) {
    long ex = GetWindowLongPtrW(h, -20).ToInt64();    // GWL_EXSTYLE
    long wanted = ex | 0x8 | 0x80;                    // WS_EX_TOPMOST + WS_EX_TOOLWINDOW (no taskbar entry)
    if (wanted == ex) return;
    SetWindowLongPtrW(h, -20, new IntPtr(wanted));
    // শুধু বিট বসালে কাজ হয় না — z-band আবার TOPMOST না করা পর্যন্ত উইন্ডোটা maximized অ্যাপের পেছনে চলে যায়
    SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x1 | 0x2 | 0x10);  // NOMOVE|NOSIZE|NOACTIVATE
  }
}
'@
Add-Type -TypeDefinition $sources

$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea

function Resolve-Hat {
  foreach ($p in (Get-WidgetEdgePid)) {
    $cand = [Hat]::FindTitledWindow([int]$p)
    if ($cand -ne [IntPtr]::Zero) { return $cand }
  }
  return [IntPtr]::Zero
}

function Place-BottomRight([IntPtr]$h, [int]$wCss, [int]$hCss) {
  [Hat]::Restore($h)
  $dpiW = [Hat]::GetDpiForWindow($h)
  if ($dpiW -lt 96) { $dpiW = 96 }
  $scale = $dpiW / 96.0
  $w = [int]([Math]::Round($wCss * $scale))
  $hh = [int]([Math]::Round($hCss * $scale))
  # কোণাটা সবসময় ওয়ার্ক-এরিয়ার ডান-নিচেই বসে — আগের রেক্ট থেকে অ্যাংকর করলে প্রতি ভাঁজে-খোলায় কয়েক পিক্সেল সরে যেত
  $x = $wa.Right - $w - 18
  $y = $wa.Bottom - $hh - 18
  # এজের নিজের টাইটেল-বার (৩১px) ক্লায়েন্ট এরিয়ার উপরে থাকে — ভাঁজ করা উইন্ডোটা ছোট রাখলে পিলটা সেই বারের বোতামের নিচে চাপা পড়ত
  [void][Hat]::SetWindowPos($h, [IntPtr](-1), $x, $y, $w, $hh, 0x10)  # HWND_TOPMOST + SWP_NOACTIVATE
  return "$x,$y ${w}x${hh}"
}

# একটাই এনফোর্সার চলবে — পুরনোগুলো বেঁচে থাকলে সবাই একই উইন্ডো টানে, কোণা দিক হারায়
@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -like '*start-widget.ps1*' -and
    $_.CommandLine -notlike '*-Stop*' -and
    $_.ProcessId -ne $PID
  } | Select-Object -ExpandProperty ProcessId) | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
foreach ($p in (Get-WidgetEdgePid)) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 600

$cmd = "--user-data-dir=`"$profile`" --app=$url --window-size=$ExpandedW,$ExpandedH --window-position=$($wa.Right - $ExpandedW - 18),$($wa.Bottom - $ExpandedH - 18) --no-first-run --no-default-browser-check --disable-session-crashed-bubble --hide-crash-restore-bubble --disable-features=Translate --force-dark-mode"
Log "launch: $cmd"
$proc = Start-Process -FilePath $edge -ArgumentList $cmd -PassThru
Log "launcher pid=$($proc.Id)"

$hat = [IntPtr]::Zero
for ($i = 0; $i -lt 70; $i += 1) {
  Start-Sleep -Milliseconds 400
  $hat = [Hat]::FindTitledWindow($proc.Id)
  if ($hat -eq [IntPtr]::Zero) { $hat = Resolve-Hat }
  if ($hat -ne [IntPtr]::Zero) { break }
}
if ($hat -eq [IntPtr]::Zero) { Log 'window never appeared'; Write-Output 'hat window not found'; exit 2 }

Log "placed: $(Place-BottomRight $hat $ExpandedW $ExpandedH)"
# এনফোর্সার নিজেই জীবিততার ছাপা ফেলে — server সেটা থেকে alive মেপে নেয়,
# কারণ widget.json-এর running কেবল ইচ্ছে (এনফোর্সার মরলেও সেটি true থেকে যেত)
try { Set-Content -Path $hbFile -Value ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -Encoding ASCII } catch { }
[Hat]::DarkFrame($hat)
for ($i = 0; $i -lt 6; $i += 1) { [Hat]::ForceTop($hat); Start-Sleep -Milliseconds 120 }

$lastMode = 'expanded'
$misses = 0
$ticks = 0
while ($true) {
  Start-Sleep -Milliseconds 800
  if (-not [Hat]::Alive($hat)) { $hat = Resolve-Hat }
  if (-not [Hat]::Alive($hat)) {
    $misses += 1
    if ($misses -ge 8) { Log 'window gone'; break }
    continue
  }
  $misses = 0
  if ([Hat]::IsIconic($hat)) { Log 'hat minimized -> restored'; [Hat]::Restore($hat) }

  $mode = 'expanded'
  $picking = $false
  try {
    $st = Get-Content $stateFile -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
    if ($st) {
      if ($st.running -eq $false) { Log 'state stopped'; break }
      if ($st.mode) { $mode = $st.mode }
      # স্ক্রিনে হাতে ঘেরার সময় হ্যাট আগে আসে না — নাহলে স্নিপিং ওভারলের উপর ভেসে থাকে
      $picking = [bool]$st.pick
    }
  } catch { }
  if ($picking) { Start-Sleep -Milliseconds 800; continue }

  [Hat]::ForceTop($hat)
  $ticks += 1
  # প্রতি ~৩ সেকেন্ডে ছাপা — সার্ভার এখান থেকেই বোঝে হাট সত্যিই কোণায় আছে কি না
  if ($ticks % 4 -eq 0) {
    try { Set-Content -Path $hbFile -Value ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -Encoding ASCII } catch { }
  }
  # উইন্ডো হ্যান্ডল বদলালে (মিনিমাইজ-রিস্টোর) DWM-এর রং উড়ে যায় — মাঝে মাঝে আবার বসানো হয়
  if ($ticks % 10 -eq 0) { [Hat]::DarkFrame($hat) }

  $wantW = $ExpandedW; $wantH = $ExpandedH
  if ($mode -eq 'collapsed') { $wantW = $CollapsedW; $wantH = $CollapsedH }

  if ($mode -ne $lastMode) {
    if ($mode -eq 'collapsed') { [void](Place-BottomRight $hat $CollapsedW $CollapsedH) }
    else { [void](Place-BottomRight $hat $ExpandedW $ExpandedH) }
    Log "mode -> $mode"
    $lastMode = $mode
  } elseif ($ticks % 4 -eq 0) {
    # এজ নিজের সাইজ বদলে ফেললে (২৮৭x৫৩০ হয়ে যাচ্ছিল) কোণাটা আবার ঠিক করা হয়
    $rc = New-Object Hat+RECT
    [void][Hat]::GetWindowRect($hat, [ref]$rc)
    $scale = [Math]::Max(1, [Hat]::GetDpiForWindow($hat) / 96.0)
    $tw = [int][Math]::Round($wantW * $scale); $th = [int][Math]::Round($wantH * $scale)
    if ([Math]::Abs(($rc.Right - $rc.Left) - $tw) -gt 6 -or [Math]::Abs(($rc.Bottom - $rc.Top) - $th) -gt 6) {
      Log "drifted $($rc.Right-$rc.Left)x$($rc.Bottom-$rc.Top) -> re-place"
      [void](Place-BottomRight $hat $wantW $wantH)
    }
  }
}

foreach ($p in (Get-WidgetEdgePid)) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
Write-StopState
Log 'enforcer exited'
