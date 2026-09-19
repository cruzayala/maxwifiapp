param(
  [string]$BaseUrl = $(if ($env:ISP_MAX_URL) { $env:ISP_MAX_URL } else { 'https://isp-max-production-d0b9.up.railway.app' }),
  [string]$OutputDirectory = $(Join-Path $PSScriptRoot '..\output\network-watch'),
  [int]$IntervalSeconds = 30,
  [switch]$Once
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$BaseUrl = $BaseUrl.TrimEnd('/')
$IntervalSeconds = [Math]::Max(15, $IntervalSeconds)
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$SamplesPath = Join-Path $OutputDirectory 'samples.csv'
$EventsPath = Join-Path $OutputDirectory 'events.jsonl'
$RuntimePath = Join-Path $OutputDirectory 'runtime.json'
$script:Token = $null
$script:LastStates = @{}
$mutex = New-Object System.Threading.Mutex($false, 'Local\ISPMaxNetworkWatch')
if (-not $mutex.WaitOne(0)) { throw 'El monitor de red ya esta ejecutandose.' }

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

function Convert-ToNumber {
  param($Value)
  if ($null -eq $Value -or $Value -eq '') { return $null }
  $number = 0.0
  if ([double]::TryParse([string]$Value, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
    return $number
  }
  return $null
}

function Convert-RttToMs {
  param($Value)
  $text = [string]$Value
  if (-not $text) { return $null }
  if ($text -match '^(?<ms>\d+)ms(?:(?<us>\d+)us)?$') {
    return [Math]::Round(([double]$Matches.ms + ([double]$(if ($Matches.us) { $Matches.us } else { 0 }) / 1000)), 3)
  }
  if ($text -match '^(?<us>\d+)us$') { return [Math]::Round(([double]$Matches.us / 1000), 3) }
  return Convert-ToNumber $Value
}

function Test-NetworkTarget {
  param([Parameter(Mandatory = $true)][string]$Target, [int]$Count = 2)
  $replies = @(Test-Connection -ComputerName $Target -Count $Count -ErrorAction SilentlyContinue)
  $times = @($replies | ForEach-Object { Convert-ToNumber $_.ResponseTime } | Where-Object { $null -ne $_ })
  return [pscustomobject]@{
    target = $Target
    sent = $Count
    received = $replies.Count
    lossPercent = [Math]::Round((($Count - $replies.Count) * 100.0 / $Count), 2)
    avgMs = if ($times.Count) { [Math]::Round(($times | Measure-Object -Average).Average, 2) } else { $null }
    maxMs = if ($times.Count) { [Math]::Round(($times | Measure-Object -Maximum).Maximum, 2) } else { $null }
  }
}

function Get-WifiState {
  $text = (netsh wlan show interfaces 2>$null) -join "`n"
  function Match-Value([string]$Pattern) {
    $match = [regex]::Match($text, $Pattern, [Text.RegularExpressions.RegexOptions]::Multiline)
    if ($match.Success) { return $match.Groups[1].Value.Trim() }
    return $null
  }
  $signal = Match-Value '^\s*(?:Signal|Senal)\s*:\s*(\d+)%'
  $rssi = Match-Value '^\s*Rssi\s*:\s*(-?\d+)'
  return [pscustomobject]@{
    ssid = Match-Value '^\s*SSID\s*:\s*(.+)$'
    bssid = Match-Value '^\s*(?:AP )?BSSID\s*:\s*(.+)$'
    band = Match-Value '^\s*(?:Band|Banda)\s*:\s*(.+)$'
    channel = Match-Value '^\s*(?:Channel|Canal)\s*:\s*(\d+)'
    signalPercent = Convert-ToNumber $signal
    rssiDbm = Convert-ToNumber $rssi
    receiveRateMbps = Convert-ToNumber (Match-Value '^\s*(?:Receive rate \(Mbps\)|Velocidad de recepcion \(Mbps\))\s*:\s*([\d.]+)')
    transmitRateMbps = Convert-ToNumber (Match-Value '^\s*(?:Transmit rate \(Mbps\)|Velocidad de transmision \(Mbps\))\s*:\s*([\d.]+)')
  }
}

function Connect-IspMax {
  $username = $env:ISP_MAX_USERNAME
  $password = $env:ISP_MAX_PASSWORD
  if (-not $username -or -not $password) {
    throw 'Define ISP_MAX_USERNAME e ISP_MAX_PASSWORD antes de iniciar el monitor.'
  }
  $body = @{ username = $username; password = $password } | ConvertTo-Json
  $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/login" -Body $body -ContentType 'application/json' -TimeoutSec 15
  if (-not $login.token) { throw 'ISP Max no devolvio un token de autenticacion.' }
  $script:Token = [string]$login.token
}

function Invoke-IspMax {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [ValidateSet('GET', 'POST')][string]$Method = 'GET',
    $Body = $null
  )
  if (-not $script:Token) { Connect-IspMax }
  $params = @{
    Method = $Method
    Uri = "$BaseUrl$Path"
    Headers = @{ 'X-Auth-Token' = $script:Token }
    TimeoutSec = 20
  }
  if ($null -ne $Body) {
    $params.Body = $Body | ConvertTo-Json -Depth 5
    $params.ContentType = 'application/json'
  }
  try {
    return Invoke-RestMethod @params
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -in 401, 403) {
      $script:Token = $null
      Connect-IspMax
      $params.Headers = @{ 'X-Auth-Token' = $script:Token }
      return Invoke-RestMethod @params
    }
    throw
  }
}

function Write-NetworkEvent {
  param([string]$Component, [string]$State, [string]$Message, $Details = $null)
  $event = [ordered]@{
    timestampUtc = [DateTime]::UtcNow.ToString('o')
    timestampLocal = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
    component = $Component
    state = $State
    message = $Message
    details = $Details
  }
  Add-Content -LiteralPath $EventsPath -Value ($event | ConvertTo-Json -Compress -Depth 6) -Encoding UTF8
}

function Set-NetworkState {
  param([string]$Component, [string]$State, [string]$Message, $Details = $null)
  $previous = $script:LastStates[$Component]
  if ($previous -ne $State) {
    Write-NetworkEvent -Component $Component -State $State -Message $Message -Details $Details
    $script:LastStates[$Component] = $State
  }
}

function Get-NetworkSample {
  $started = Get-Date
  $sample = [ordered]@{
    timestampUtc = [DateTime]::UtcNow.ToString('o')
    timestampLocal = $started.ToString('yyyy-MM-dd HH:mm:ss zzz')
    wifiSsid = $null
    wifiBssid = $null
    wifiBand = $null
    wifiChannel = $null
    wifiSignalPercent = $null
    wifiRssiDbm = $null
    wifiReceiveRateMbps = $null
    wifiTransmitRateMbps = $null
    localGateway = $null
    localGatewayLossPercent = $null
    localGatewayAvgMs = $null
    localInternetLossPercent = $null
    localInternetAvgMs = $null
    localDnsOk = $false
    railwayOk = $false
    railwayLatencyMs = $null
    mikrotikConnected = $false
    mikrotikQueueDepth = $null
    mikrotikLastTimeoutAt = $null
    pingTarget = '8.8.8.8'
    pingLossPercent = $null
    pingAvgMs = $null
    pingMaxMs = $null
    wanRxMbps = $null
    wanTxMbps = $null
    clientsOnline = $null
    clientsOffline = $null
    oltConnected = $false
    oltSnapshotAgeSeconds = $null
    oltOnusOnline = $null
    oltOnusOffline = $null
    oltActiveAlarms = $null
    oltCriticalAlarms = $null
    nocOpenIncidents = $null
    nocAffectedClients = $null
    sampleDurationMs = $null
    error = $null
  }

  try {
    $wifi = Get-WifiState
    $sample.wifiSsid = $wifi.ssid
    $sample.wifiBssid = $wifi.bssid
    $sample.wifiBand = $wifi.band
    $sample.wifiChannel = $wifi.channel
    $sample.wifiSignalPercent = $wifi.signalPercent
    $sample.wifiRssiDbm = $wifi.rssiDbm
    $sample.wifiReceiveRateMbps = $wifi.receiveRateMbps
    $sample.wifiTransmitRateMbps = $wifi.transmitRateMbps

    $defaultRoute = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
      Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' } |
      Sort-Object RouteMetric, InterfaceMetric |
      Select-Object -First 1
    if ($defaultRoute) {
      $sample.localGateway = [string]$defaultRoute.NextHop
      $gatewayTest = Test-NetworkTarget $sample.localGateway 2
      $sample.localGatewayLossPercent = $gatewayTest.lossPercent
      $sample.localGatewayAvgMs = $gatewayTest.avgMs
    }
    $localInternetTest = Test-NetworkTarget '1.1.1.1' 2
    $sample.localInternetLossPercent = $localInternetTest.lossPercent
    $sample.localInternetAvgMs = $localInternetTest.avgMs
    $sample.localDnsOk = [bool](Resolve-DnsName 'google.com' -Type A -DnsOnly -ErrorAction SilentlyContinue | Select-Object -First 1)

    $localState = if ($null -eq $sample.localGateway -or $sample.localGatewayLossPercent -ge 100) {
      'lan_down'
    } elseif ($sample.localInternetLossPercent -ge 100) {
      'internet_down'
    } elseif (-not $sample.localDnsOk) {
      'dns_failure'
    } elseif ($sample.localGatewayLossPercent -gt 0 -or $sample.localInternetLossPercent -gt 0 -or $sample.localGatewayAvgMs -ge 20 -or $sample.localInternetAvgMs -ge 100) {
      'degraded'
    } else {
      'up'
    }
    Set-NetworkState 'local_network' $localState "Red local $localState" @{ ssid = $sample.wifiSsid; band = $sample.wifiBand; channel = $sample.wifiChannel; signalPercent = $sample.wifiSignalPercent; rssiDbm = $sample.wifiRssiDbm; gateway = $sample.localGateway; gatewayLossPercent = $sample.localGatewayLossPercent; gatewayAvgMs = $sample.localGatewayAvgMs; internetLossPercent = $sample.localInternetLossPercent; internetAvgMs = $sample.localInternetAvgMs; dnsOk = $sample.localDnsOk }

    $healthWatch = [Diagnostics.Stopwatch]::StartNew()
    Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 15 | Out-Null
    $healthWatch.Stop()
    $sample.railwayOk = $true
    $sample.railwayLatencyMs = $healthWatch.ElapsedMilliseconds

    $mt = Invoke-IspMax '/mikrotik/status'
    $wan = Invoke-IspMax '/mikrotik/wan-traffic'
    $ping = Invoke-IspMax '/mikrotik/ping' 'POST' @{ address = '8.8.8.8'; count = 3 }
    $olt = Invoke-IspMax '/olt-api/status'
    $noc = Invoke-IspMax '/noc/summary'

    $sample.mikrotikConnected = [bool]$mt.connected
    $sample.mikrotikQueueDepth = $mt.telemetry.commandQueue.depth
    $sample.mikrotikLastTimeoutAt = $mt.telemetry.commandQueue.lastTimeoutAt
    $sample.wanRxMbps = [Math]::Round(([double]$wan.rxBps / 1000000), 3)
    $sample.wanTxMbps = [Math]::Round(([double]$wan.txBps / 1000000), 3)
    $pingRows = @($ping)
    if ($pingRows.Count -eq 1 -and -not $pingRows[0].PSObject.Properties['packet-loss'] -and $pingRows[0].PSObject.Properties['value']) {
      $pingRows = @($pingRows[0].value)
    }
    $pingSummary = $pingRows | Where-Object { $null -ne $_.'packet-loss' } | Select-Object -Last 1
    if ($pingSummary) {
      $lossText = ([string]$pingSummary.'packet-loss').TrimEnd('%')
      $sample.pingLossPercent = Convert-ToNumber $lossText
      $sample.pingAvgMs = Convert-RttToMs $pingSummary.'avg-rtt'
      $sample.pingMaxMs = Convert-RttToMs $pingSummary.'max-rtt'
    }

    $sample.oltConnected = [bool]$olt.connected
    $sample.oltOnusOnline = $olt.latest.onlineOnus
    $sample.oltOnusOffline = $olt.latest.offlineOnus
    $sample.oltActiveAlarms = $olt.latest.activeAlarms
    $sample.oltCriticalAlarms = $olt.latest.criticalAlarms
    if ($olt.latest.capturedAt) {
      $captured = [DateTimeOffset]::Parse([string]$olt.latest.capturedAt)
      $sample.oltSnapshotAgeSeconds = [Math]::Max(0, [Math]::Round(([DateTimeOffset]::UtcNow - $captured).TotalSeconds))
    }
    $sample.nocOpenIncidents = $noc.open
    $sample.nocAffectedClients = $noc.affectedClients

    $railwayState = if ($sample.railwayLatencyMs -ge 5000) { 'degraded' } else { 'up' }
    Set-NetworkState 'railway' $railwayState "Railway $railwayState ($($sample.railwayLatencyMs) ms)" @{ latencyMs = $sample.railwayLatencyMs }

    $mtState = if (-not $sample.mikrotikConnected -or $sample.pingLossPercent -ge 100) { 'down' } elseif ($null -eq $sample.pingLossPercent -or $sample.pingLossPercent -gt 0 -or $sample.pingAvgMs -ge 80) { 'degraded' } else { 'up' }
    Set-NetworkState 'mikrotik_internet' $mtState "MikroTik/Internet $mtState" @{ lossPercent = $sample.pingLossPercent; avgMs = $sample.pingAvgMs; wanRxMbps = $sample.wanRxMbps; wanTxMbps = $sample.wanTxMbps }

    $oltState = if (-not $sample.oltConnected -or $sample.oltSnapshotAgeSeconds -ge 180) { 'down' } elseif ($sample.oltCriticalAlarms -gt 0) { 'degraded' } else { 'up' }
    Set-NetworkState 'olt' $oltState "OLT $oltState" @{ snapshotAgeSeconds = $sample.oltSnapshotAgeSeconds; online = $sample.oltOnusOnline; offline = $sample.oltOnusOffline; criticalAlarms = $sample.oltCriticalAlarms }
  } catch {
    $sample.error = [string]$_.Exception.Message
    Set-NetworkState 'monitor' 'error' 'Fallo al recolectar la muestra' @{ error = $sample.error }
  }

  $sample.sampleDurationMs = [Math]::Round(((Get-Date) - $started).TotalMilliseconds)
  return [pscustomobject]$sample
}

try {
  $runtime = [ordered]@{
    pid = $PID
    startedAtUtc = [DateTime]::UtcNow.ToString('o')
    baseUrl = $BaseUrl
    intervalSeconds = $IntervalSeconds
    samplesPath = $SamplesPath
    eventsPath = $EventsPath
  }
  $runtime | ConvertTo-Json | Set-Content -LiteralPath $RuntimePath -Encoding UTF8
  Write-NetworkEvent 'monitor' 'started' "Monitor iniciado cada $IntervalSeconds segundos" @{ pid = $PID; baseUrl = $BaseUrl }

  do {
    $cycleStarted = Get-Date
    $sample = Get-NetworkSample
    if (Test-Path -LiteralPath $SamplesPath) {
      $sample | Export-Csv -LiteralPath $SamplesPath -NoTypeInformation -Append -Encoding UTF8
    } else {
      $sample | Export-Csv -LiteralPath $SamplesPath -NoTypeInformation -Encoding UTF8
    }
    if (-not $Once) {
      $remaining = [Math]::Max(1, $IntervalSeconds - [Math]::Ceiling(((Get-Date) - $cycleStarted).TotalSeconds))
      Start-Sleep -Seconds $remaining
    }
  } while (-not $Once)
} finally {
  Write-NetworkEvent 'monitor' 'stopped' 'Monitor detenido' @{ pid = $PID }
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
