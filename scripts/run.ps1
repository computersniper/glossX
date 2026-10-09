param([string]$BindHost, [int]$Port, [string]$DataDir)
$root = Split-Path -Parent $PSScriptRoot
if ($DataDir) { $env:GLOSS_DATA_DIR = $DataDir }
$arguments = @((Join-Path $root 'scripts\gloss.mjs'), 'start')
if ($BindHost) { $arguments += @('--host', $BindHost) }
if ($Port) { $arguments += @('--port', [string]$Port) }
& node @arguments
exit $LASTEXITCODE
