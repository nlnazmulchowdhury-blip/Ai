$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot '..\src\ps\win_tools.ps1'
$tokens = $null
$errs = $null
[System.Management.Automation.Language.Parser]::ParseFile($target, [ref]$tokens, [ref]$errs) | Out-Null
if ($errs.Count -gt 0) {
  foreach ($e in $errs) { Write-Output "PARSE $($e.Extent.StartLineNumber): $($e.Message)" }
  exit 1
}
Write-Output 'parse ok'
