# PowerShell script for setting up Windows self-hosted GitHub Actions runner
# Run this script in PowerShell as Administrator inside the Windows VM

param (
    [Parameter(Mandatory=$true)]
    [string]$RunnerToken,
    
    [string]$RepoUrl = "https://github.com/ismigar/Projectes",
    [string]$RunnerVersion = "2.322.0"
)

$ErrorActionPreference = "Stop"

Write-Host "==> Preparing Windows self-hosted runner environment..." -ForegroundColor Green

# 1. Install Chocolatey / dependencies if winget/choco available or direct download
$RunnerDir = "C:\actions-runner"
if (-not (Test-Path $RunnerDir)) {
    New-Item -Path $RunnerDir -ItemType Directory | Out-Null
}

Set-Location $RunnerDir

# 2. Download Actions Runner zip for Windows x64
$ZipFile = "actions-runner-win-x64-$RunnerVersion.zip"
$DownloadUrl = "https://github.com/actions/runner/releases/download/v$RunnerVersion/$ZipFile"

if (-not (Test-Path "config.cmd")) {
    Write-Host "==> Downloading GitHub Actions runner from $DownloadUrl..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipFile
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory("$RunnerDir\$ZipFile", $RunnerDir)
    Remove-Item $ZipFile
}

# 3. Configure Runner
Write-Host "==> Configuring runner for repository $RepoUrl..." -ForegroundColor Yellow
.\config.cmd --url $RepoUrl --token $RunnerToken --name "Windows-Local-Runner" --labels "self-hosted,Windows,X64" --unattended --replace

# 4. Install Service
Write-Host "==> Installing runner Windows Service..." -ForegroundColor Yellow
.\svc.cmd install
.\svc.cmd start

Write-Host "==> Windows runner service successfully installed and started!" -ForegroundColor Green
