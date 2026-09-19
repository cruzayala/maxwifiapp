param(
    [string]$JdkHome = 'C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot',
    [string]$GoogleMavenUrl = 'https://dl.google.com/dl/android/maven2/',
    [switch]$CandidateOnly
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$signing = Join-Path $env:LOCALAPPDATA 'ISP Max\AndroidSigning'
$keystore = Join-Path $signing 'ispmax-release.p12'
$credentialFile = Join-Path $signing 'signing-credential.clixml'
$keytool = Join-Path $JdkHome 'bin\keytool.exe'
if (-not (Test-Path -LiteralPath $keytool)) { throw 'JDK 17 no disponible' }
if ((Test-Path -LiteralPath $keystore) -xor (Test-Path -LiteralPath $credentialFile)) {
    throw 'Falta una parte de la firma existente. Recupera la copia; no se generara otra firma.'
}
New-Item -ItemType Directory -Path $signing -Force | Out-Null
if (-not (Test-Path -LiteralPath $credentialFile)) {
    $random = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($random)
    $secret = [Convert]::ToBase64String($random)
    $credential = [System.Management.Automation.PSCredential]::new('ispmax-release', (ConvertTo-SecureString $secret -AsPlainText -Force))
    # Export-Clixml uses Windows DPAPI for the current Windows user.
    $credential | Export-Clixml -LiteralPath $credentialFile
} else {
    $credential = Import-Clixml -LiteralPath $credentialFile
    $secret = $credential.GetNetworkCredential().Password
}
$env:ISPMAX_ANDROID_KEYSTORE = $keystore
$env:ISPMAX_ANDROID_STORE_PASSWORD = $secret
$env:ISPMAX_ANDROID_KEY_PASSWORD = $secret
$env:ISPMAX_ANDROID_KEY_ALIAS = 'ispmax-release'
try {
    if (-not (Test-Path -LiteralPath $keystore)) {
        & $keytool -genkeypair -keystore $keystore -storetype PKCS12 -alias ispmax-release -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=ISP Max Android,O=ISP Max' -storepass:env ISPMAX_ANDROID_STORE_PASSWORD -keypass:env ISPMAX_ANDROID_KEY_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar la firma' }
    }
    $env:JAVA_HOME = $JdkHome
    $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    Push-Location (Join-Path $root 'android')
    try {
        & .\gradlew.bat :app:assembleRelease --no-daemon "-PgoogleMavenUrl=$GoogleMavenUrl"
        if ($LASTEXITCODE -ne 0) { throw 'Fallo la compilacion privada' }
    } finally { Pop-Location }
    $apk = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'
    & (Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\apksigner.bat') verify --verbose --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw 'La firma del APK no pudo verificarse' }
    $metadata = Get-Content (Join-Path $root 'android\app\build\outputs\apk\release\output-metadata.json') -Raw | ConvertFrom-Json
    $version = $metadata.elements[0].versionName
    $fileName = "ISP-Max-Android-$version.apk"
    $sha = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    $destinations = if ($CandidateOnly) { @((Join-Path $root 'output\android-candidates')) } else { @((Join-Path $root 'agent-downloads'), (Join-Path $root 'output\android-release')) }
    foreach ($dir in $destinations) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Copy-Item -LiteralPath $apk -Destination (Join-Path $dir $fileName) -Force
    }
    $manifest = @{ version = $version; versionCode = $metadata.elements[0].versionCode; fileName = $fileName; sha256 = $sha; sizeBytes = (Get-Item $apk).Length; publishedAt = [DateTime]::UtcNow.ToString('o'); status = 'preview' }
    if (-not $CandidateOnly) {
        [IO.File]::WriteAllText((Join-Path $root 'agent-downloads\android-manifest.json'), ($manifest | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
        # Keep only the manifest-selected APK in the Docker context. Older signed
        # builds remain available locally under output/android-release.
        Get-ChildItem (Join-Path $root 'agent-downloads') -Filter 'ISP-Max-Android-*.apk' -File |
            Where-Object Name -ne $fileName |
            ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination (Join-Path $root 'output\android-release') -Force }
    }
    Get-FileHash -LiteralPath $apk -Algorithm SHA256
} finally {
    Remove-Item Env:ISPMAX_ANDROID_KEYSTORE,Env:ISPMAX_ANDROID_STORE_PASSWORD,Env:ISPMAX_ANDROID_KEY_PASSWORD,Env:ISPMAX_ANDROID_KEY_ALIAS -ErrorAction SilentlyContinue
    $secret = $null
}
