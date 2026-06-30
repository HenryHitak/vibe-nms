param(
    [string]$InstallDir = "$env:ProgramFiles\Vibe NMS",
    [int]$Port = 8080,
    [switch]$SkipFirewall
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run this installer from an elevated PowerShell window."
    }
}

Assert-Admin

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageRoot = Split-Path -Parent $sourceRoot
$taskName = "VibeNMS"

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "data") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "logs") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "service") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "server") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "frontend") -Force | Out-Null

Copy-Item -Path (Join-Path $packageRoot "server\*") -Destination (Join-Path $InstallDir "server") -Recurse -Force
Copy-Item -Path (Join-Path $packageRoot "frontend\*") -Destination (Join-Path $InstallDir "frontend") -Recurse -Force
Copy-Item -Path (Join-Path $packageRoot "service\*") -Destination (Join-Path $InstallDir "service") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $packageRoot "README-INSTALLER.md") -Destination (Join-Path $InstallDir "README-INSTALLER.md") -Force

$envPath = Join-Path $InstallDir ".env"
if (-not (Test-Path $envPath)) {
    @"
NMS_PORT=$Port
NMS_DATABASE_ENGINE=sqlite
NMS_DATABASE_PATH=$InstallDir\data\nms.sqlite
NMS_FRONTEND_DIST=$InstallDir\frontend\dist
NMS_ALLOWED_ORIGINS=http://localhost:$Port,http://127.0.0.1:$Port
NMS_COLLECTOR_ENABLED=true
NMS_AP_CLIENT_DISCOVERY_ENABLED=true
NMS_AP_CLIENT_DEFAULT_PROVIDER=demo
NMS_BOOTSTRAP_ADMIN_USERNAME=admin
NMS_BOOTSTRAP_ADMIN_PASSWORD=admin
NMS_AUTH_SECRET=change-this-to-a-long-random-secret
"@ | Set-Content -LiteralPath $envPath -Encoding UTF8
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$runner = Join-Path $InstallDir "service\run-vibe-nms.ps1"
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" `
    -WorkingDirectory $InstallDir
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DisallowStartIfOnBatteries:$false `
    -ExecutionTimeLimit (New-TimeSpan -Days 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($startupTrigger, $logonTrigger) -Settings $settings -Principal $principal | Out-Null

if (-not $SkipFirewall) {
    $ruleName = "Vibe NMS $Port"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
    }
}

$shortcutPath = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "Vibe NMS.url"
@"
[InternetShortcut]
URL=http://localhost:$Port
"@ | Set-Content -LiteralPath $shortcutPath -Encoding ASCII

Start-ScheduledTask -TaskName $taskName

Write-Host ""
Write-Host "Vibe NMS installed."
Write-Host "Open: http://localhost:$Port"
Write-Host "Default login: admin / admin"
