# Respaldo portable de la firma de Android de ISP Max.
#
# Por que existe: scripts/build-android-private.ps1 guarda la clave de la firma protegida con
# DPAPI, que solo descifra este mismo usuario de Windows en esta misma PC. Si la PC se pierde,
# nadie puede firmar actualizaciones y los telefonos tendrian que desinstalar la app.
#
# El respaldo es un archivo cifrado con una frase que elige la persona (AES-256-CBC + HMAC-SHA256,
# clave derivada con PBKDF2-SHA256 de 600.000 vueltas). Sin la frase no sirve de nada.
# Compatible con Windows PowerShell 5.1.

$script:Magic = 'ISPMAX-ANDROID-SIGNING-1'
$script:Iterations = 600000

function ConvertFrom-SecureText([Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Get-DerivedKeys([Security.SecureString]$Passphrase, [byte[]]$Salt) {
    $text = ConvertFrom-SecureText $Passphrase
    try {
        $kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes($text, $Salt, $script:Iterations, [Security.Cryptography.HashAlgorithmName]::SHA256)
        try {
            $bytes = $kdf.GetBytes(64)
            return @{ Encryption = $bytes[0..31]; Mac = $bytes[32..63] }
        } finally { $kdf.Dispose() }
    } finally { $text = $null }
}

function Get-Hmac([byte[]]$Key, [byte[]]$Data) {
    $hmac = New-Object Security.Cryptography.HMACSHA256 (,$Key)
    try { return $hmac.ComputeHash($Data) } finally { $hmac.Dispose() }
}

function Test-BytesEqual([byte[]]$Left, [byte[]]$Right) {
    if ($Left.Length -ne $Right.Length) { return $false }
    $diff = 0
    for ($i = 0; $i -lt $Left.Length; $i++) { $diff = $diff -bor ($Left[$i] -bxor $Right[$i]) }
    return $diff -eq 0
}

<#
  Cifra la firma (keystore + clave) con la frase y escribe el archivo de respaldo.
  $Payload: hashtable con alias, storePassword, keystoreBase64, signerSha256, createdAt.
#>
function Protect-IspMaxSigning([hashtable]$Payload, [Security.SecureString]$Passphrase, [string]$OutFile) {
    $plain = [Text.Encoding]::UTF8.GetBytes(($Payload | ConvertTo-Json -Compress))
    $salt = New-Object byte[] 16; $iv = New-Object byte[] 16
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($salt); $rng.GetBytes($iv) } finally { $rng.Dispose() }
    $keys = Get-DerivedKeys $Passphrase $salt
    $aes = [Security.Cryptography.Aes]::Create()
    try {
        $aes.KeySize = 256; $aes.Mode = 'CBC'; $aes.Padding = 'PKCS7'
        $aes.Key = [byte[]]$keys.Encryption; $aes.IV = $iv
        $encryptor = $aes.CreateEncryptor()
        try { $cipher = $encryptor.TransformFinalBlock($plain, 0, $plain.Length) } finally { $encryptor.Dispose() }
    } finally { $aes.Dispose(); [Array]::Clear($plain, 0, $plain.Length) }
    $header = [Text.Encoding]::ASCII.GetBytes($script:Magic)
    $signed = [byte[]]($header + $salt + $iv + $cipher)
    $mac = Get-Hmac ([byte[]]$keys.Mac) $signed
    [IO.File]::WriteAllBytes($OutFile, [byte[]]($signed + $mac))
}

<# Descifra un respaldo; falla si la frase es otra o el archivo fue alterado. #>
function Unprotect-IspMaxSigning([string]$InFile, [Security.SecureString]$Passphrase) {
    $all = [IO.File]::ReadAllBytes($InFile)
    $headerLength = $script:Magic.Length
    if ($all.Length -lt $headerLength + 16 + 16 + 16 + 32) { throw 'El archivo no es un respaldo de firma de ISP Max.' }
    $header = [Text.Encoding]::ASCII.GetString($all, 0, $headerLength)
    if ($header -ne $script:Magic) { throw 'El archivo no es un respaldo de firma de ISP Max.' }
    $salt = $all[$headerLength..($headerLength + 15)]
    $iv = $all[($headerLength + 16)..($headerLength + 31)]
    $cipher = $all[($headerLength + 32)..($all.Length - 33)]
    $mac = $all[($all.Length - 32)..($all.Length - 1)]
    $keys = Get-DerivedKeys $Passphrase ([byte[]]$salt)
    $expected = Get-Hmac ([byte[]]$keys.Mac) ([byte[]]$all[0..($all.Length - 33)])
    if (-not (Test-BytesEqual ([byte[]]$expected) ([byte[]]$mac))) { throw 'Frase incorrecta o archivo danado.' }
    $aes = [Security.Cryptography.Aes]::Create()
    try {
        $aes.KeySize = 256; $aes.Mode = 'CBC'; $aes.Padding = 'PKCS7'
        $aes.Key = [byte[]]$keys.Encryption; $aes.IV = [byte[]]$iv
        $decryptor = $aes.CreateDecryptor()
        try { $plain = $decryptor.TransformFinalBlock([byte[]]$cipher, 0, $cipher.Length) } finally { $decryptor.Dispose() }
    } finally { $aes.Dispose() }
    return ([Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json)
}

Export-ModuleMember -Function Protect-IspMaxSigning, Unprotect-IspMaxSigning
