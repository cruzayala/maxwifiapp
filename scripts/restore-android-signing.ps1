# Restaura en otra PC (o en esta, tras reinstalar Windows) la firma de Android desde un
# respaldo creado con backup-android-signing.ps1. Despues, build-android-private.ps1 firma
# con la misma clave y los telefonos reciben las actualizaciones como siempre.
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\restore-android-signing.ps1 -BackupFile <archivo.ispmaxkey>
param([Parameter(Mandatory = $true)][string]$BackupFile)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'android-signing-backup.psm1') -Force

$signing = Join-Path $env:LOCALAPPDATA 'ISP Max\AndroidSigning'
$keystore = Join-Path $signing 'ispmax-release.p12'
$credentialFile = Join-Path $signing 'signing-credential.clixml'
if ((Test-Path -LiteralPath $keystore) -or (Test-Path -LiteralPath $credentialFile)) {
    throw 'Esta PC ya tiene una firma. No se sobrescribe: si de verdad quieres reemplazarla, mueve antes la carpeta ISP Max\AndroidSigning a otro lugar.'
}
$passphrase = Read-Host 'Frase del respaldo' -AsSecureString
$data = Unprotect-IspMaxSigning (Resolve-Path -LiteralPath $BackupFile).Path $passphrase

New-Item -ItemType Directory -Path $signing -Force | Out-Null
[IO.File]::WriteAllBytes($keystore, [Convert]::FromBase64String($data.keystoreBase64))
# Export-Clixml vuelve a proteger la clave con DPAPI para el usuario de Windows de esta PC.
$credential = New-Object Management.Automation.PSCredential($data.alias, (ConvertTo-SecureString $data.storePassword -AsPlainText -Force))
$credential | Export-Clixml -LiteralPath $credentialFile
Write-Host "Firma restaurada (huella $($data.signerSha256))."
Write-Host 'Ya puedes compilar con scripts\build-android-private.ps1.'
