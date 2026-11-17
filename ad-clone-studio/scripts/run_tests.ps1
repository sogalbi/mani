# Run the test suite (needs ffmpeg/ffprobe; GUI tests run without opening windows).
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "Run scripts\setup_windows.ps1 first." -ForegroundColor Red
    exit 1
}
& .\.venv\Scripts\python.exe -m pytest -q @args
