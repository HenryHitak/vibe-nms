$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseDir = Join-Path $root "vibe-nms-release"
$zipPath = Join-Path $root "vibe-nms-release.zip"

if (Test-Path $releaseDir) {
    Remove-Item -LiteralPath $releaseDir -Recurse -Force
}
if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $releaseDir | Out-Null

function Copy-CleanDirectory($source, $destination, $excludedNames) {
    New-Item -ItemType Directory -Path $destination | Out-Null
    Get-ChildItem -LiteralPath $source -Force | Where-Object {
        $excludedNames -notcontains $_.Name
    } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
    }
}

Copy-CleanDirectory (Join-Path $root "backend") (Join-Path $releaseDir "backend") @("__pycache__", ".pytest_cache")
Copy-CleanDirectory (Join-Path $root "frontend") (Join-Path $releaseDir "frontend") @("node_modules", "dist", ".vite")
Copy-CleanDirectory (Join-Path $root "nginx") (Join-Path $releaseDir "nginx") @()
Copy-CleanDirectory (Join-Path $root "docs") (Join-Path $releaseDir "docs") @()

Get-ChildItem -LiteralPath $releaseDir -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force

Copy-Item -LiteralPath (Join-Path $root "docker-compose.yml") -Destination (Join-Path $releaseDir "docker-compose.yml")
Copy-Item -LiteralPath (Join-Path $root ".env.example") -Destination (Join-Path $releaseDir ".env.example")
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination (Join-Path $releaseDir "README.md")
Copy-Item -LiteralPath (Join-Path $root "build_release.ps1") -Destination (Join-Path $releaseDir "build_release.ps1")
Copy-Item -LiteralPath (Join-Path $root "build_release.sh") -Destination (Join-Path $releaseDir "build_release.sh")

Compress-Archive -Path (Join-Path $releaseDir "*") -DestinationPath $zipPath -Force
Write-Host "Created $zipPath"
