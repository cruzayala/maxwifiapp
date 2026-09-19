$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $root '.venv\Scripts\python.exe'

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process powershell -Verb RunAs -ArgumentList $arguments
  exit
}

if (-not (Test-Path $venvPython)) {
  & (Join-Path $root 'instalar-onu-provisioner.ps1')
}

$port = 8765
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  $portLine = Get-Content $envFile | Where-Object { $_ -match '^ONU_PORT=' } | Select-Object -First 1
  if ($portLine) { $port = [int]($portLine -replace '^ONU_PORT=', '') }
}

Start-Process "http://127.0.0.1:$port/"
Set-Location $root
& $venvPython app.py

