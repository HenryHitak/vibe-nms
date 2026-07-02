param(
    [string]$InstallDir = "$env:ProgramFiles\Vibe NMS",
    [int]$Port = 8080
)

$ErrorActionPreference = "Continue"
$taskName = "VibeNMS"
$serverExe = Join-Path $InstallDir "server\vibe-nms-server.exe"
$envPath = Join-Path $InstallDir ".env"
$dataPath = Join-Path $InstallDir "data\nms.sqlite"
$dashboardUrl = "http://localhost:$Port"
$healthUrl = "http://localhost:$Port/health"

function Write-Item {
    param(
        [string]$Label,
        [string]$Value
    )
    Write-Host ("{0,-24} {1}" -f ($Label + ":"), $Value)
}

Write-Host ""
Write-Host "Vibe NMS Server Status"
Write-Host "======================"
Write-Host ""

Write-Item "Install folder" $InstallDir
Write-Item "Server EXE" $serverExe
Write-Item "Env file" $envPath
Write-Item "Default SQLite DB" $dataPath
Write-Item "Dashboard URL" $dashboardUrl
Write-Host ""

if (Test-Path $InstallDir) {
    Write-Item "Install folder exists" "YES"
} else {
    Write-Item "Install folder exists" "NO"
}

if (Test-Path $serverExe) {
    Write-Item "Server EXE exists" "YES"
} else {
    Write-Item "Server EXE exists" "NO"
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Write-Item "Scheduled Task" "$($task.TaskName) / $($task.State)"
} else {
    Write-Item "Scheduled Task" "NOT FOUND"
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    $processText = if ($process) { "$($process.ProcessName) / PID $($process.Id) / $($process.Path)" } else { "PID $($listener.OwningProcess)" }
    Write-Item "Port $Port" "LISTENING"
    Write-Item "Port owner" $processText
} else {
    Write-Item "Port $Port" "NOT LISTENING"
}

try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
    if ($health.StatusCode -eq 200) {
        Write-Item "Health check" "OK"
    } else {
        Write-Item "Health check" "HTTP $($health.StatusCode)"
    }
} catch {
    Write-Item "Health check" "FAILED"
}

Write-Host ""
Write-Host "How to control the server"
Write-Host "-------------------------"
Write-Host "Start:   Start-ScheduledTask -TaskName VibeNMS"
Write-Host "Stop:    Stop-ScheduledTask -TaskName VibeNMS"
Write-Host "Restart: Stop-ScheduledTask -TaskName VibeNMS; Start-ScheduledTask -TaskName VibeNMS"
Write-Host ""

if (-not $task -or -not (Test-Path $serverExe)) {
    Write-Host "Result: Vibe NMS does not look installed on this PC."
} elseif (-not $listener) {
    Write-Host "Result: Vibe NMS is installed, but the server is not listening on port $Port."
} else {
    Write-Host "Result: Vibe NMS server is running. Open $dashboardUrl"
}
