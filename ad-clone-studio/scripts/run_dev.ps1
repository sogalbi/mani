# Start the AD CLONE STUDIO GUI from the dev virtualenv.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "Run scripts\setup_windows.ps1 first." -ForegroundColor Red
    exit 1
}
& .\.venv\Scripts\python.exe -m adclone @args
