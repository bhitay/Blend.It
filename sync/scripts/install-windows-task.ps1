# Registers a Windows scheduled task that runs the BlendIt sync.
#   - every night at 03:00, waking the computer from sleep if needed
#   - if the computer was off at 03:00: as soon as it is turned on again
#   - also at every logon
# The sync itself skips sources that already synced in the last ~20 hours,
# so extra triggers are harmless.
#
# Run from the sync folder:   powershell -ExecutionPolicy Bypass -File scripts\install-windows-task.ps1
# Remove:                     Unregister-ScheduledTask -TaskName "BlendIt Sync" -Confirm:$false

$ErrorActionPreference = 'Stop'
$syncDir = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source

$action = New-ScheduledTaskAction -Execute $node -Argument "src\index.mjs" -WorkingDirectory $syncDir
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At 3am),
  (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
)
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName "BlendIt Sync" -Action $action -Trigger $triggers -Settings $settings `
  -Principal $principal -Description "BlendIt: bank and credit-card sync" -Force | Out-Null

Write-Host "OK: the 'BlendIt Sync' task is registered (03:00 nightly + at logon)." -ForegroundColor Green
Write-Host "Run it now:  Start-ScheduledTask -TaskName 'BlendIt Sync'"
