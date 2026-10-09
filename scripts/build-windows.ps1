param([string]$Python = "python")

$projectRoot = Split-Path -Parent $PSScriptRoot
$buildVenv = Join-Path $projectRoot "build\windows-venv"
$buildPython = Join-Path $buildVenv "Scripts\python.exe"

Push-Location $projectRoot
try {
    & npm run build:frontend
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    if (-not (Test-Path -LiteralPath $buildPython)) {
        & $Python -m venv $buildVenv
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    & $buildPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    & $buildPython -m pip install -r backend/requirements.txt -r packaging/requirements-build.txt
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    & $buildPython -m PyInstaller --noconfirm --clean packaging/GlossX.spec
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "GlossX executable: $projectRoot\dist\GlossX.exe"
}
finally {
    Pop-Location
}
