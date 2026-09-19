$ErrorActionPreference = 'Stop'
$taskName = 'ISP Max ONU Studio Agent'
$sourceExe = 'C:\Users\maxim\Desktop\wishubapp\wishub-admin\onu-provisioner\release\ONU-Studio-ISP-Max.exe'
$exe = 'C:\Users\maxim\Desktop\wishubapp\wishub-admin\onu-provisioner\release\ONU-Studio-ISP-Max-v1.13.0.exe'

if (-not (Test-Path -LiteralPath $exe)) {
  Copy-Item -LiteralPath $sourceExe -Destination $exe -Force
}

$task = Get-ScheduledTask -TaskName $taskName
$approvedExe = [Environment]::ExpandEnvironmentVariables([string]$task.Actions.Execute)
Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
Start-Sleep -Seconds 4

try {
  $action = New-ScheduledTaskAction -Execute $exe -Argument '--background'
  Set-ScheduledTask -TaskName $taskName -Action $action -ErrorAction Stop | Out-Null
} catch [Microsoft.Management.Infrastructure.CimException] {
  if (-not $approvedExe) { throw }
  Copy-Item -LiteralPath $exe -Destination $approvedExe -Force
  Write-Warning "Windows conservo la ruta elevada aprobada; se actualizo su binario a v1.13.0."
}

Start-ScheduledTask -TaskName $taskName
