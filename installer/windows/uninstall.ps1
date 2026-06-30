param(
    [string]$InstallDir = "$env:ProgramFiles\Vibe NMS",
    [int]$Port = 8080,
    [switch]$KeepData
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run this uninstaller from an elevated PowerShell window."
    }
}

Assert-Admin

$taskName = "VibeNMS"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase)
} | Stop-Process -Force -ErrorAction SilentlyContinue

$ruleName = "Vibe NMS $Port"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule

$shortcutPath = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "Vibe NMS.url"
Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue

if ($KeepData) {
    Get-ChildItem -LiteralPath $InstallDir -Force | Where-Object { $_.Name -notin @("data", ".env") } | Remove-Item -Recurse -Force
} elseif (Test-Path $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
}

Write-Host "Vibe NMS uninstalled."
