# Baba Solars — start the server automatically on the office Windows PC (mode A: server + C:\ on the same PC).
# Run once in PowerShell from the project folder after `npm install`, `npm run build:server` and creating server\.env:
#   powershell -ExecutionPolicy Bypass -File server\install-windows-service.ps1
# Remove:   Unregister-ScheduledTask -TaskName "Baba Solars Server" -Confirm:$false

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw 'Node.js / npm is not installed. Install Node.js 20 or newer from https://nodejs.org.' }
if (-not (Test-Path (Join-Path $project 'server\.env'))) { throw 'Create server\.env first (copy server\.env.example).' }
if (-not (Test-Path (Join-Path $project 'dist\index.html'))) { throw 'Build the website first: npm run build:server' }

$action = New-ScheduledTaskAction -Execute $npm -Argument 'run server' -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'Baba Solars Server' -Action $action -Trigger $trigger -Settings $settings -Description 'Baba Solars admin server (documents in C:\Quotation and Billing)' -Force | Out-Null
Start-ScheduledTask -TaskName 'Baba Solars Server'
Write-Host 'Installed. Open http://localhost:8787/admin in Chrome or Edge.'
