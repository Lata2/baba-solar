# Baba Solars — register the document sync agent to start when you log in to Windows.
# Run once in PowerShell from the project folder:   powershell -ExecutionPolicy Bypass -File agent\install-windows.ps1
# Remove:   Unregister-ScheduledTask -TaskName "Baba Solars Document Sync" -Confirm:$false

$ErrorActionPreference = 'Stop'
$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js is not installed. Install Node.js 20 or newer from https://nodejs.org and run this again.' }
if (-not (Test-Path (Join-Path $agentDir 'agent.env'))) { throw 'Create agent\agent.env first (copy agent\agent.env.example and fill SERVER_URL and AGENT_TOKEN).' }

New-Item -ItemType Directory -Force -Path 'C:\Quotation and Billing\Quotations' | Out-Null
New-Item -ItemType Directory -Force -Path 'C:\Quotation and Billing\Billing' | Out-Null

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$agentDir\sync-agent.mjs`"" -WorkingDirectory $agentDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'Baba Solars Document Sync' -Action $action -Trigger $trigger -Settings $settings -Description 'Copies quotations and bills from the Baba Solars server to C:\Quotation and Billing' -Force | Out-Null
Start-ScheduledTask -TaskName 'Baba Solars Document Sync'
Write-Host 'Installed. Files will appear in C:\Quotation and Billing (Quotations, Billing).'
