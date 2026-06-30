$ErrorActionPreference = "Stop"

$installDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envPath = Join-Path $installDir ".env"
$logDir = Join-Path $installDir "logs"
$serverExe = Join-Path $installDir "server\vibe-nms-server.exe"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (Test-Path $envPath) {
    Get-Content -LiteralPath $envPath | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
            return
        }
        $parts = $line.Split("=", 2)
        [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
    }
}

$env:NMS_DATABASE_PATH = $env:NMS_DATABASE_PATH -or (Join-Path $installDir "data\nms.sqlite")
$env:NMS_FRONTEND_DIST = $env:NMS_FRONTEND_DIST -or (Join-Path $installDir "frontend\dist")
$env:NMS_PORT = $env:NMS_PORT -or "8080"

Set-Location $installDir
& $serverExe --host 0.0.0.0 --port $([int]$env:NMS_PORT) *>> (Join-Path $logDir "vibe-nms-service.log")
