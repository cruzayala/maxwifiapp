# Genera el ejecutable de ONU Studio (.NET) listo para copiar a la PC del tecnico.
#
#   .\build.ps1              -> compila, prueba y publica
#   .\build.ps1 -SkipTests   -> solo publica
#
# El resultado queda en release\ONU-Studio-ISP-Max-vX.Y.Z.exe: un solo archivo,
# sin necesidad de instalar .NET en la PC de destino.

[CmdletBinding()]
param(
    [switch]$SkipTests,
    [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$app = Join-Path $root 'src\OnuStudio.App\OnuStudio.App.csproj'
$tests = Join-Path $root 'tests\OnuStudio.Tests\OnuStudio.Tests.csproj'
$publish = Join-Path $root 'artifacts\publish'
$release = Join-Path $root 'release'

Write-Host 'Compilando ONU Studio…' -ForegroundColor Cyan
dotnet build $app -c $Configuration --nologo
if ($LASTEXITCODE -ne 0) { throw 'La compilacion fallo' }

if (-not $SkipTests) {
    Write-Host 'Ejecutando las pruebas…' -ForegroundColor Cyan
    dotnet test $tests -c $Configuration --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Las pruebas fallaron' }
}

Write-Host 'Publicando el ejecutable…' -ForegroundColor Cyan
if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
dotnet publish $app -c $Configuration -r win-x64 --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:IncludeAllContentForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -p:DebugType=None `
    -o $publish --nologo
if ($LASTEXITCODE -ne 0) { throw 'La publicacion fallo' }

$version = ([xml](Get-Content $app)).Project.PropertyGroup.Version | Select-Object -First 1
if (-not $version) { $version = '2.0.0' }

if (-not (Test-Path $release)) { New-Item -ItemType Directory -Path $release | Out-Null }
$source = Join-Path $publish 'ONU Studio.exe'
$target = Join-Path $release "ONU-Studio-ISP-Max-v$version.exe"
Copy-Item $source $target -Force

$size = [math]::Round((Get-Item $target).Length / 1MB, 1)
Write-Host ''
Write-Host "Listo: $target ($size MB)" -ForegroundColor Green
Write-Host 'Copialo a la PC del tecnico y abrelo. Windows pedira permisos de administrador.'
Write-Host 'Usa el Microsoft Edge de Windows; no hay que instalar nada mas.'
