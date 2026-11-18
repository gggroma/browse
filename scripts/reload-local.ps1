$ErrorActionPreference = 'Stop'
$previousRuntime = $env:OPENCODE_BROWSER_HOME
$previousPort = $env:OPENCODE_BROWSER_PORT
try {
    $env:OPENCODE_BROWSER_HOME = if ($previousRuntime) { $previousRuntime } else { (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) '.ai-folder/tools/browse-group-controls-runtime') }
    $env:OPENCODE_BROWSER_PORT = '19990'
    & bun (Join-Path $PSScriptRoot 'reload-local.ts')
    $resultCode = $LASTEXITCODE
} finally {
    $env:OPENCODE_BROWSER_HOME = $previousRuntime
    $env:OPENCODE_BROWSER_PORT = $previousPort
}
exit $resultCode
