param([string]$Python)
$root = Split-Path -Parent $PSScriptRoot
$arguments = @((Join-Path $root 'scripts\gloss.mjs'), 'setup')
if ($Python) { $arguments += @('--python', $Python) }
& node @arguments
exit $LASTEXITCODE
