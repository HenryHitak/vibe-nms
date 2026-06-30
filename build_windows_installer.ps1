$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $root "frontend"
$backendDir = Join-Path $root "backend"
$packageDir = Join-Path $root "vibe-nms-windows-installer"
$zipPath = Join-Path $root "vibe-nms-windows-installer.zip"
$launcherSource = Join-Path $root "installer\windows\bootstrapper\VibeNmsInstallerLauncher.cs"
$launcherBuildDir = Join-Path $root "installer\windows\bootstrapper\bin"

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

Write-Host "Building Windows installer launchers..."
$csc = (Get-Command csc.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $csc) {
    $candidates = @(
        "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
        "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe",
        "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe"
    )
    $csc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $csc) {
    throw "Cannot find csc.exe to build installer launchers."
}
if (Test-Path $launcherBuildDir) {
    Remove-Item -LiteralPath $launcherBuildDir -Recurse -Force
}
New-Item -ItemType Directory -Path $launcherBuildDir | Out-Null
$launcherExe = Join-Path $launcherBuildDir "VibeNmsInstallerLauncher.exe"
& $csc /nologo /target:exe /platform:anycpu /out:$launcherExe $launcherSource
if ($LASTEXITCODE -ne 0) {
    throw "Failed to build installer launcher."
}
Copy-Item -LiteralPath $launcherExe -Destination (Join-Path $packageDir "Install Vibe NMS.exe") -Force
Copy-Item -LiteralPath $launcherExe -Destination (Join-Path $packageDir "Uninstall Vibe NMS.exe") -Force

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -Force
Write-Host "Created $zipPath"
