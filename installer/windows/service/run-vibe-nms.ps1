$ErrorActionPreference = "Stop"

$installDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envPath = Join-Path $installDir ".env"
$logDir = Join-Path $installDir "logs"
$serverExe = Join-Path $installDir "server\vibe-nms-server.exe"
$serviceLog = Join-Path $logDir "vibe-nms-service.log"
$stdoutLog = Join-Path $logDir "vibe-nms-service.out.log"
$stderrLog = Join-Path $logDir "vibe-nms-service.err.log"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (Test-Path $envPath) {
    Get-Content -LiteralPath $envPath | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
            return
        }
        $separator = $line.IndexOf("=")
        $key = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()
        [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
}

if (-not $env:NMS_DATABASE_PATH) {
    $env:NMS_DATABASE_PATH = Join-Path $installDir "data\nms.sqlite"
}
if (-not $env:NMS_FRONTEND_DIST) {
    $env:NMS_FRONTEND_DIST = Join-Path $installDir "frontend\dist"
}
if (-not $env:NMS_PORT) {
    $env:NMS_PORT = "8080"
}
if (-not $env:NMS_TIME_ZONE) {
    $env:NMS_TIME_ZONE = "America/Tijuana"
}

$port = 8080
if (-not [int]::TryParse($env:NMS_PORT, [ref]$port)) {
    $port = 8080
    $env:NMS_PORT = "8080"
}

Set-Location $installDir
"$(Get-Date -Format s) Starting Vibe NMS on port $port from $installDir" | Add-Content -LiteralPath $serviceLog

$serverProcess = Start-Process `
    -FilePath $serverExe `
    -ArgumentList @("--host", "0.0.0.0", "--port", "$port") `
    -WorkingDirectory $installDir `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -NoNewWindow `
    -PassThru

$serverProcess.WaitForExit()
"$(Get-Date -Format s) Vibe NMS stopped with exit code $($serverProcess.ExitCode)" | Add-Content -LiteralPath $serviceLog
exit $serverProcess.ExitCode
