# Crea un respaldo cifrado de la firma de Android (ver android-signing-backup.psm1).
# Uso (en esta PC, con tu usuario de Windows):
#   powershell -ExecutionPolicy Bypass -File scripts\backup-android-signing.ps1
# Te pide una frase; el archivo queda en el Escritorio. Copialo fuera de esta PC y guarda la
# frase por separado: sin ella el respaldo no sirve, y sin respaldo, si la PC se pierde, los
# telefonos no podran recibir actualizaciones de la app.
param([string]$OutDir = [Environment]::GetFolderPath('Desktop'))
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'android-signing-backup.psm1') -Force

$signing = Join-Path $env:LOCALAPPDATA 'ISP Max\AndroidSigning'
$keystore = Join-Path $signing 'ispmax-release.p12'
$credentialFile = Join-Path $signing 'signing-credential.clixml'
if (-not (Test-Path -LiteralPath $keystore) -or -not (Test-Path -LiteralPath $credentialFile)) {
    throw 'No hay firma de Android en esta PC (falta la carpeta ISP Max\AndroidSigning).'
}
$credential = Import-Clixml -LiteralPath $credentialFile
$secret = $credential.GetNetworkCredential().Password

$signer = 'desconocida'
try {
    $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($keystore, $secret)
    $signer = (($cert.GetCertHash([Security.Cryptography.HashAlgorithmName]::SHA256)) | ForEach-Object { $_.ToString('x2') }) -join ''
} catch { }

Write-Host 'Elige una frase para proteger el respaldo (minimo 12 caracteres).'
Write-Host 'Guardala aparte (por ejemplo en tu gestor de claves): sin ella el respaldo no sirve.'
$first = Read-Host 'Frase' -AsSecureString
$second = Read-Host 'Repite la frase' -AsSecureString
$a = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
try {
    $same = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($a) -ceq [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
    $long = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($a).Length -ge 12
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($a); [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
}
if (-not $same) { throw 'Las frases no coinciden.' }
if (-not $long) { throw 'La frase debe tener al menos 12 caracteres.' }

$payload = @{
    alias = $credential.UserName
    storePassword = $secret
    keystoreBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keystore))
    signerSha256 = $signer
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
}
$out = Join-Path $OutDir ('ISP-Max-firma-android-{0}.ispmaxkey' -f (Get-Date -Format 'yyyyMMdd'))
try {
    Protect-IspMaxSigning $payload $first $out
    $check = Unprotect-IspMaxSigning $out $first
    if ($check.keystoreBase64 -ne $payload.keystoreBase64) { throw 'La verificacion del respaldo fallo.' }
} finally {
    $payload.storePassword = $null; $secret = $null
}
Write-Host ''
Write-Host "Respaldo creado y verificado: $out"
Write-Host "Huella de la firma: $signer"
Write-Host 'Copialo fuera de esta PC (USB, nube o correo propio) y guarda la frase por separado.'
