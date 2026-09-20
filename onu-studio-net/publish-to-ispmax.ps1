# Publica el ejecutable recien construido para que los tecnicos lo descarguen
# desde el modulo "Configurar ONU" de ISP Max.
#
#   .\publish-to-ispmax.ps1
#
# Copia el .exe a agent-downloads\ y actualiza manifest.json (version, tamano y
# huella SHA-256). Despues hay que subir el proyecto a Railway para que quede
# disponible en la nube.

[CmdletBinding()]
param(
    [string]$Executable,
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

if (-not $Executable) {
    $Executable = Get-ChildItem (Join-Path $PSScriptRoot 'release') -Filter 'ONU-Studio-ISP-Max-v*.exe' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Executable -or -not (Test-Path $Executable)) {
    throw 'No se encontro el ejecutable. Ejecuta primero .\build.ps1'
}

$downloads = Join-Path $RepoRoot 'agent-downloads'
if (-not (Test-Path $downloads)) { New-Item -ItemType Directory -Path $downloads | Out-Null }

$fileName = Split-Path $Executable -Leaf
$version = if ($fileName -match 'v(\d+\.\d+\.\d+)') { $Matches[1] } else { '2.0.0' }
$target = Join-Path $downloads $fileName
Copy-Item $Executable $target -Force

$hash = (Get-FileHash $target -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $target).Length

$manifest = [ordered]@{
    version        = $version
    fileName       = $fileName
    sha256         = $hash
    size           = $size
    browserRuntime = 'Incluido: se instala solo la primera vez'
    releasedAt     = (Get-Date).ToUniversalTime().ToString('o')
}
$manifestPath = Join-Path $downloads 'manifest.json'
$manifest | ConvertTo-Json | Set-Content -Path $manifestPath -Encoding utf8

Write-Host ''
Write-Host "Publicado: $target" -ForegroundColor Green
Write-Host "Version $version · $([math]::Round($size / 1MB, 1)) MB"
Write-Host "Manifiesto actualizado: $manifestPath"
Write-Host ''
Write-Host 'Falta subir el proyecto a Railway para que los tecnicos lo vean.' -ForegroundColor Yellow
