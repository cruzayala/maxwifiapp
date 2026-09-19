$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $root '.venv'

if (-not (Test-Path $venv)) {
  python -m venv $venv
}

$python = Join-Path $venv 'Scripts\python.exe'
& $python -m pip install --disable-pip-version-check -r (Join-Path $root 'requirements.txt')
Write-Host ''
Write-Host 'Agente ONU instalado.' -ForegroundColor Green
Write-Host 'Usa iniciar-onu-provisioner.ps1 para abrirlo.'

