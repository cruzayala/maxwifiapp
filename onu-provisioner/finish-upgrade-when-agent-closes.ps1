$ErrorActionPreference = 'Stop'
$taskName = 'ISP Max ONU Studio Agent'
$sourceExe = 'C:\Users\maxim\Desktop\wishubapp\wishub-admin\onu-provisioner\release\ONU-Studio-ISP-Max.exe'
$targetExe = 'C:\Users\maxim\Desktop\wishubapp\wishub-admin\onu-provisioner\release\ONU-Studio-ISP-Max-v1.8.0.exe'
$logPath = 'C:\Users\maxim\Desktop\wishubapp\wishub-admin\onu-provisioner\release\upgrade-v1.7.1.log'

try {
  while (Get-Process -Name 'ONU-Studio-ISP-Max-v1.8.0' -ErrorAction SilentlyContinue) {
    Start-Sleep -Seconds 2
  }
  Copy-Item -LiteralPath $sourceExe -Destination $targetExe -Force
  Start-ScheduledTask -TaskName $taskName
  "$(Get-Date -Format o) upgrade completed" | Set-Content -LiteralPath $logPath
} catch {
  "$(Get-Date -Format o) $($_.Exception.Message)" | Set-Content -LiteralPath $logPath
}
