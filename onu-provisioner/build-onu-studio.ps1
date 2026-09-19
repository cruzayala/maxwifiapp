$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root '.venv\Scripts\python.exe'
$browserDir = Join-Path $root 'build-browsers'
$outputDir = Join-Path $root 'release'
$downloadDir = Join-Path (Split-Path -Parent $root) 'agent-downloads'
$version = '1.13.0'

if (-not (Test-Path $python)) {
  python -m venv (Join-Path $root '.venv')
}

Set-Location $root
& $python -m pip install --disable-pip-version-check -r requirements-build.txt
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias de compilacion.' }

$env:PLAYWRIGHT_BROWSERS_PATH = $browserDir
& $python -m playwright install chromium --no-shell
if ($LASTEXITCODE -ne 0) { throw 'No se pudo descargar Chromium para el ejecutable.' }
$browserExecutable = Get-ChildItem $browserDir -Recurse -Filter chrome.exe -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $browserExecutable) { throw 'La descarga de Chromium esta incompleta: falta chrome.exe.' }
$env:ONU_BUILD_BROWSERS = $browserDir

& $python -m PyInstaller --noconfirm --clean --distpath $outputDir onu-studio.spec
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller no pudo compilar ONU Studio.' }

$exe = Join-Path $outputDir 'ONU-Studio-ISP-Max.exe'
if (-not (Test-Path $exe)) {
  throw 'PyInstaller no genero el ejecutable esperado.'
}
Copy-Item (Join-Path $root 'LEEME-ONU-Studio.txt') (Join-Path $outputDir 'LEEME-ONU-Studio.txt') -Force
$versionedExe = Join-Path $outputDir "ONU-Studio-ISP-Max-v$version.exe"
try {
  Copy-Item $exe $versionedExe -Force
} catch [System.IO.IOException] {
  Write-Warning 'La copia versionada esta en uso; el actualizador en espera la reemplazara cuando cierre el agente.'
}

# Publica una unica copia versionada para que Railway la sirva desde el modulo
# Configurar ONU. El manifiesto permite comprobar tamano y SHA-256 antes de usarla.
New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
$downloadName = "ONU-Studio-ISP-Max-v$version.exe"
$downloadExe = Join-Path $downloadDir $downloadName
Copy-Item $exe $downloadExe -Force
$hash = (Get-FileHash -LiteralPath $downloadExe -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
  version = $version
  fileName = $downloadName
  sha256 = $hash
  releasedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $downloadDir 'manifest.json') -Encoding utf8

Write-Host ''
Write-Host 'Ejecutable creado:' -ForegroundColor Green
Write-Host $exe
Write-Host $versionedExe
Write-Host (Join-Path $downloadDir 'manifest.json')
