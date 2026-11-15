# Windows PowerShell installer for Command Code Go OMP Provider
$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/trefeon/pi-commandcode-go-provider.git"
$ExtDir = Join-Path $HOME ".omp\agent\extensions"
$TargetDir = Join-Path $ExtDir "pi-commandcode-go-provider"
$LoaderFile = Join-Path $ExtDir "commandcode-go.ts"

Write-Host "=== Installing Command Code Go Provider for OMP ===" -ForegroundColor Cyan

if (-not (Test-Path $ExtDir)) {
    New-Item -ItemType Directory -Path $ExtDir -Force | Out-Null
}

if (Test-Path (Join-Path $TargetDir ".git")) {
    Write-Host "Existing installation found. Pulling latest updates..." -ForegroundColor Yellow
    git -C $TargetDir pull --ff-only
} else {
    Write-Host "Cloning repository into $TargetDir..." -ForegroundColor Yellow
    git clone --depth 1 $RepoUrl $TargetDir
}

Write-Host "Registering auto-loader in $LoaderFile..." -ForegroundColor Yellow
$LoaderContent = @"
import extension from "./pi-commandcode-go-provider/index.ts";
export default extension;
"@

Set-Content -Path $LoaderFile -Value $LoaderContent -Encoding UTF8

Write-Host ""
Write-Host "=== Installation Complete! ===" -ForegroundColor Green
Write-Host "The provider is now automatically loaded by OMP."
Write-Host "Use:"
Write-Host "  omp --model commandcode-go/deepseek/deepseek-v4.1-flash"
Write-Host "  or inside an interactive session: /model commandcode-go/deepseek/deepseek-v4.1-flash"
Write-Host "To update anytime, run /commandcode-go-update inside OMP or re-run this script." -ForegroundColor Cyan
