# AD CLONE STUDIO - Windows dev setup. Run from the ad-clone-studio folder:
#   powershell -ExecutionPolicy Bypass -File scripts\setup_windows.ps1
# (Messages are ASCII on purpose: Windows PowerShell 5.1 misreads UTF-8 scripts without BOM.)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$py = $null
$pyArgs = @()
if (Get-Command py -ErrorAction SilentlyContinue) {
    try {
        & py -3.11 -c "import sys" *> $null
        if ($LASTEXITCODE -eq 0) { $py = "py"; $pyArgs = @("-3.11") }
    } catch { }
}
if (-not $py) {
    if (Get-Command python -ErrorAction SilentlyContinue) {
        $ver = & python -c "import sys; print('%d.%d' % sys.version_info[:2])"
        if ($ver -eq "3.11") { $py = "python"; $pyArgs = @() }
    }
}
if (-not $py) {
    Write-Host "Python 3.11 not found. Install it first:  winget install Python.Python.3.11" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path ".venv")) {
    Write-Host "Creating .venv ..."
    & $py @pyArgs -m venv .venv
}
$venvPy = ".\.venv\Scripts\python.exe"
& $venvPy -m pip install --upgrade pip
& $venvPy -m pip install -r requirements.lock
if ($LASTEXITCODE -ne 0) { Write-Host "pip install failed" -ForegroundColor Red; exit 1 }
& $venvPy -m pip install --no-deps -e .
if ($LASTEXITCODE -ne 0) { Write-Host "pip install -e . failed" -ForegroundColor Red; exit 1 }

if ((Get-Command ffmpeg -ErrorAction SilentlyContinue) -and (Get-Command ffprobe -ErrorAction SilentlyContinue)) {
    Write-Host "FFmpeg found:" (Get-Command ffmpeg).Source -ForegroundColor Green
} else {
    Write-Host "FFmpeg/ffprobe not found on PATH." -ForegroundColor Yellow
    Write-Host "  Install:  winget install Gyan.FFmpeg   (then open a NEW terminal)"
    Write-Host "  Or set the folder in the app: Tools > Environment check, or set ADCLONE_FFMPEG_DIR."
}
Write-Host ""
Write-Host "Done. Start the app with:  scripts\run_dev.ps1" -ForegroundColor Green
