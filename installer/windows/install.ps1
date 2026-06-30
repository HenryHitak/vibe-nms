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

function Stop-ExistingTask {
    param([string]$TaskName)

    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
}

function Stop-VibeNmsPortListeners {
    param(
        [int]$Port,
        [string]$InstallDir,
        [string]$PackageRoot
    )

    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        if (-not $process) {
            continue
        }
        $processPath = $process.Path
        $isVibeNmsProcess = $process.ProcessName -like "vibe-nms-server*"
        if ($processPath) {
            $isVibeNmsProcess = $isVibeNmsProcess `
                -or $processPath.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase) `
                -or $processPath.StartsWith($PackageRoot, [System.StringComparison]::OrdinalIgnoreCase)
        }
        if ($isVibeNmsProcess) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }

    Start-Sleep -Seconds 1
    $remaining = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($remaining) {
        $owners = @()
        foreach ($listener in $remaining) {
            $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
            if ($process) {
                $owners += "$($process.ProcessName)($($process.Id))"
            }
        }
        throw "Port $Port is already in use by $($owners -join ', '). Stop that process and run the installer again."
    }
}

function Wait-ForDashboard {
    param([int]$Port)

    $healthUrl = "http://localhost:$Port/health"
    $homeUrl = "http://localhost:$Port/"
    $healthy = $false
    for ($i = 0; $i -lt 45; $i++) {
        try {
            $health = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
            if ($health.StatusCode -eq 200) {
                $healthy = $true
                break
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }

    if (-not $healthy) {
        throw "Vibe NMS backend did not respond at $healthUrl."
    }

    try {
        $home = Invoke-WebRequest -UseBasicParsing -Uri $homeUrl -TimeoutSec 5
        if ($home.Content -notmatch "<html|<div id=`"root`"|/assets/") {
            throw "Unexpected response from dashboard root."
        }
    } catch {
        throw "Backend is running, but the frontend dashboard is not being served at $homeUrl. $($_.Exception.Message)"
    }
}

function Get-LanIPv4Addresses {
    $addresses = @()
    try {
        $addresses += Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -and
                $_.IPAddress -notlike "127.*" -and
                $_.IPAddress -notlike "169.254.*" -and
                $_.IPAddress -notlike "0.*"
            } |
            Sort-Object InterfaceMetric, InterfaceIndex |
            Select-Object -ExpandProperty IPAddress
    } catch {
        $ipconfig = cmd.exe /c ipconfig
        $addresses += [regex]::Matches(($ipconfig -join "`n"), "(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])") |
            ForEach-Object { $_.Value } |
            Where-Object { $_ -notlike "127.*" -and $_ -notlike "169.254.*" -and $_ -notlike "0.*" }
    }

    $addresses |
        Where-Object { $_ } |
        Select-Object -Unique
}

function Get-AccessUrls {
    param([int]$Port)

    $urls = @("http://localhost:$Port")
    foreach ($address in Get-LanIPv4Addresses) {
        $urls += "http://$address`:$Port"
    }
    $urls | Select-Object -Unique
}

function Add-UniqueText {
    param(
        [System.Collections.Generic.List[string]]$Values,
        [string]$Value
    )

    if ($Value -and -not $Values.Contains($Value)) {
        [void]$Values.Add($Value)
    }
}

function Get-MonitoringNetworks {
    $networks = [System.Collections.Generic.List[string]]::new()
    foreach ($network in @("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")) {
        Add-UniqueText -Values $networks -Value $network
    }

    try {
        $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -and
                $_.IPAddress -notlike "127.*" -and
                $_.IPAddress -notlike "169.254.*" -and
                $_.IPAddress -notlike "0.*"
            } |
            Sort-Object InterfaceMetric, InterfaceIndex
        foreach ($address in $addresses) {
            if ($address.PrefixLength -gt 0 -and $address.PrefixLength -le 32) {
                Add-UniqueText -Values $networks -Value "$($address.IPAddress)/$($address.PrefixLength)"
            }
            if ($address.IPAddress -match "^(\d+)\.(\d+)\.") {
                Add-UniqueText -Values $networks -Value "$($Matches[1]).$($Matches[2]).0.0/16"
            }
        }
    } catch {
        foreach ($address in Get-LanIPv4Addresses) {
            if ($address -match "^(\d+)\.(\d+)\.") {
                Add-UniqueText -Values $networks -Value "$($Matches[1]).$($Matches[2]).0.0/16"
            }
        }
    }

    $networks.ToArray() -join ","
}

function Get-EnvValue {
    param(
        [string[]]$Lines,
        [string]$Key
    )

    foreach ($line in $Lines) {
        if ($line -match "^$([regex]::Escape($Key))=(.*)$") {
            return $Matches[1]
        }
    }
    return ""
}

function Merge-CsvValues {
    param(
        [string]$Existing,
        [string]$Additional
    )

    $values = [System.Collections.Generic.List[string]]::new()
    foreach ($item in (($Existing, $Additional) -join "," -split ",")) {
        Add-UniqueText -Values $values -Value $item.Trim()
    }
    $values.ToArray() -join ","
}

Stop-ExistingTask -TaskName $taskName
Stop-VibeNmsPortListeners -Port $Port -InstallDir $InstallDir -PackageRoot $packageRoot
$accessUrls = @(Get-AccessUrls -Port $Port)
$corporateNetworks = Get-MonitoringNetworks

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

$frontendIndex = Join-Path $InstallDir "frontend\dist\index.html"
if (-not (Test-Path $frontendIndex)) {
    throw "Frontend dashboard files were not installed. Missing $frontendIndex"
}

$envPath = Join-Path $InstallDir ".env"
if (-not (Test-Path $envPath)) {
    $allowedOrigins = $accessUrls -join ","
    @"
NMS_PORT=$Port
NMS_DATABASE_ENGINE=sqlite
NMS_DATABASE_PATH=$InstallDir\data\nms.sqlite
NMS_FRONTEND_DIST=$InstallDir\frontend\dist
NMS_ALLOWED_ORIGINS=$allowedOrigins
NMS_CORPORATE_NETWORKS=$corporateNetworks
NMS_TIME_ZONE=America/Tijuana
NMS_COLLECTOR_ENABLED=true
NMS_PING_COUNT=3
NMS_TCP_FALLBACK_PORTS=445,3389,80,443
NMS_AP_CLIENT_DISCOVERY_ENABLED=true
NMS_AP_CLIENT_DEFAULT_PROVIDER=demo
NMS_BOOTSTRAP_ADMIN_USERNAME=admin
NMS_BOOTSTRAP_ADMIN_PASSWORD=admin
NMS_AUTH_SECRET=change-this-to-a-long-random-secret
NMS_DISPLAY_API_TOKEN=
"@ | Set-Content -LiteralPath $envPath -Encoding UTF8
} else {
    $envLines = Get-Content -LiteralPath $envPath
    $existingCorporateNetworks = Get-EnvValue -Lines $envLines -Key "NMS_CORPORATE_NETWORKS"
    $managedValues = @{
        "NMS_PORT" = "$Port"
        "NMS_DATABASE_PATH" = "$InstallDir\data\nms.sqlite"
        "NMS_FRONTEND_DIST" = "$InstallDir\frontend\dist"
        "NMS_ALLOWED_ORIGINS" = ($accessUrls -join ",")
        "NMS_CORPORATE_NETWORKS" = (Merge-CsvValues -Existing $existingCorporateNetworks -Additional $corporateNetworks)
        "NMS_TIME_ZONE" = "America/Tijuana"
        "NMS_PING_COUNT" = "3"
        "NMS_TCP_FALLBACK_PORTS" = "445,3389,80,443"
    }
    foreach ($key in $managedValues.Keys) {
        $value = $managedValues[$key]
        $found = $false
        for ($i = 0; $i -lt $envLines.Count; $i++) {
            if ($envLines[$i] -match "^$([regex]::Escape($key))=") {
                $envLines[$i] = "$key=$value"
                $found = $true
                break
            }
        }
        if (-not $found) {
            $envLines += "$key=$value"
        }
    }
    $displayTokenExists = $false
    foreach ($line in $envLines) {
        if ($line -match "^NMS_DISPLAY_API_TOKEN=") {
            $displayTokenExists = $true
            break
        }
    }
    if (-not $displayTokenExists) {
        $envLines += "NMS_DISPLAY_API_TOKEN="
    }
    $envLines | Set-Content -LiteralPath $envPath -Encoding UTF8
}

$runner = Join-Path $InstallDir "service\run-vibe-nms.ps1"
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" `
    -WorkingDirectory $InstallDir
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
$settingsCommand = Get-Command New-ScheduledTaskSettingsSet
$settingsParams = @{}
if ($settingsCommand.Parameters.ContainsKey("AllowStartIfOnBatteries")) {
    $settingsParams["AllowStartIfOnBatteries"] = $true
}
if ($settingsCommand.Parameters.ContainsKey("DontStopIfGoingOnBatteries")) {
    $settingsParams["DontStopIfGoingOnBatteries"] = $true
}
if ($settingsCommand.Parameters.ContainsKey("ExecutionTimeLimit")) {
    $settingsParams["ExecutionTimeLimit"] = (New-TimeSpan -Days 0)
}
if ($settingsCommand.Parameters.ContainsKey("RestartCount")) {
    $settingsParams["RestartCount"] = 3
}
if ($settingsCommand.Parameters.ContainsKey("RestartInterval")) {
    $settingsParams["RestartInterval"] = (New-TimeSpan -Minutes 1)
}
$settings = New-ScheduledTaskSettingsSet @settingsParams
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($startupTrigger, $logonTrigger) -Settings $settings -Principal $principal | Out-Null

if (-not $SkipFirewall) {
    $ruleName = "Vibe NMS $Port"
    try {
        Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        New-NetFirewallRule `
            -DisplayName $ruleName `
            -Direction Inbound `
            -Protocol TCP `
            -LocalPort $Port `
            -Action Allow `
            -Profile Domain,Private,Public | Out-Null
    } catch {
        Write-Warning "Could not create Windows Firewall rule for port $Port. Other PCs may not connect until IT opens TCP $Port inbound. $($_.Exception.Message)"
    }
}

$shortcutPath = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "Vibe NMS.url"
@"
[InternetShortcut]
URL=http://localhost:$Port
"@ | Set-Content -LiteralPath $shortcutPath -Encoding ASCII

$networkUrlsPath = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "Vibe NMS Network URLs.txt"
@(
    "Vibe NMS access URLs",
    "",
    "This PC:",
    "http://localhost:$Port",
    "",
    "Other PCs on the company network:"
) + ($accessUrls | Where-Object { $_ -notlike "http://localhost:*" }) | Set-Content -LiteralPath $networkUrlsPath -Encoding UTF8

Start-ScheduledTask -TaskName $taskName
Wait-ForDashboard -Port $Port

Write-Host ""
Write-Host "Vibe NMS installed."
Write-Host "Open on this PC: http://localhost:$Port"
Write-Host "Open from other company PCs:"
foreach ($url in $accessUrls | Where-Object { $_ -notlike "http://localhost:*" }) {
    Write-Host "  $url"
}
Write-Host "Default login: admin / admin"
