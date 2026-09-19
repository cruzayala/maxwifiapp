param(
  [string]$Version = '1.13.0'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $root "release\ONU-Studio-ISP-Max-v$Version.exe"

if (-not (Test-Path $exe)) {
  throw "No se encontro el ejecutable: $exe"
}

Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessName -like 'ONU-Studio-ISP-Max-v*' } |
  Stop-Process -Force

Start-Sleep -Seconds 2
Start-Process -FilePath $exe
