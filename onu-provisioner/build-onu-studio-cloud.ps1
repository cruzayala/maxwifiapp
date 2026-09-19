$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root '.venv\Scripts\python.exe'
$outputDir = Join-Path $root 'release-cloud'
$downloadDir = Join-Path (Split-Path -Parent $root) 'agent-downloads'
$version = '1.13.0'

if (-not (Test-Path $python)) {
  throw 'Falta el entorno Python del agente. Ejecuta primero build-onu-studio.ps1.'
}

Set-Location $root
$env:ONU_BUILD_EMBED_BROWSERS = '0'
$env:ONU_BUILD_NAME = 'ONU-Studio-ISP-Max-Cloud'
try {
  & $python -m PyInstaller --noconfirm --clean --distpath $outputDir onu-studio.spec
  if ($LASTEXITCODE -ne 0) { throw 'PyInstaller no pudo compilar la edicion de nube.' }
} finally {
  Remove-Item Env:ONU_BUILD_EMBED_BROWSERS -ErrorAction SilentlyContinue
  Remove-Item Env:ONU_BUILD_NAME -ErrorAction SilentlyContinue
}

$exe = Join-Path $outputDir 'ONU-Studio-ISP-Max-Cloud.exe'
if (-not (Test-Path $exe)) { throw 'No se genero el ejecutable de nube esperado.' }

New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
$downloadName = "ONU-Studio-ISP-Max-v$version.exe"
$downloadExe = Join-Path $downloadDir $downloadName
Copy-Item $exe $downloadExe -Force
$hash = (Get-FileHash -LiteralPath $downloadExe -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
  version = $version
  fileName = $downloadName
  sha256 = $hash
  size = (Get-Item -LiteralPath $downloadExe).Length
  browserRuntime = 'Microsoft Edge o Google Chrome instalado en Windows'
  releasedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $downloadDir 'manifest.json') -Encoding utf8

Write-Host "Ejecutable de nube creado: $downloadExe" -ForegroundColor Green
Write-Host "SHA-256: $hash"
