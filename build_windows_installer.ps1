$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $root "frontend"
$backendDir = Join-Path $root "backend"
$packageDir = Join-Path $root "vibe-nms-windows-installer"
$zipPath = Join-Path $root "vibe-nms-windows-installer.zip"

if (Test-Path $packageDir) {
    Remove-Item -LiteralPath $packageDir -Recurse -Force
}
if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

Write-Host "Building frontend..."
Push-Location $frontendDir
try {
    $env:VITE_API_BASE_URL = "/api"
    npm run build
} finally {
    Pop-Location
}

$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $python = (Get-Command python).Source
}

Write-Host "Ensuring PyInstaller is available..."
$hasPyInstaller = $false
try {
    & $python -c "import PyInstaller" 2>$null
    $hasPyInstaller = $LASTEXITCODE -eq 0
} catch {
    $hasPyInstaller = $false
}
if (-not $hasPyInstaller) {
    & $python -m pip install pyinstaller
}

Write-Host "Building backend executable..."
Push-Location $backendDir
try {
    & $python -m PyInstaller `
        --clean `
        --noconfirm `
        --name vibe-nms-server `
        --console `
        --add-data "mssql;mssql" `
        vibe_nms_server.py
} finally {
    Pop-Location
}

Write-Host "Assembling installer package..."
New-Item -ItemType Directory -Path $packageDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDir "server") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDir "frontend") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDir "installer") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDir "service") | Out-Null

Copy-Item -Path (Join-Path $backendDir "dist\vibe-nms-server\*") -Destination (Join-Path $packageDir "server") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $frontendDir "dist") -Destination (Join-Path $packageDir "frontend\dist") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root "installer\windows\install.ps1") -Destination (Join-Path $packageDir "installer\install.ps1") -Force
Copy-Item -LiteralPath (Join-Path $root "installer\windows\uninstall.ps1") -Destination (Join-Path $packageDir "installer\uninstall.ps1") -Force
Copy-Item -LiteralPath (Join-Path $root "installer\windows\service\run-vibe-nms.ps1") -Destination (Join-Path $packageDir "service\run-vibe-nms.ps1") -Force
Copy-Item -LiteralPath (Join-Path $root "installer\windows\README-INSTALLER.md") -Destination (Join-Path $packageDir "README-INSTALLER.md") -Force

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -Force
Write-Host "Created $zipPath"
