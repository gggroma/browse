$ReloadArguments = @($args)
$ErrorActionPreference = 'Stop'
$previousRuntime = $env:OPENCODE_BROWSER_HOME
$previousPort = $env:OPENCODE_BROWSER_PORT
try {
    $sourceRoot = Split-Path $PSScriptRoot -Parent
    $env:OPENCODE_BROWSER_HOME = if ($previousRuntime) { $previousRuntime } else { Join-Path (Split-Path $sourceRoot -Parent) '.ai-folder/tools/browse-group-controls-runtime' }
    $env:OPENCODE_BROWSER_PORT = '19990'
    & npx.cmd -y bun@1.4.4 (Join-Path $PSScriptRoot 'reload-local.ts') @ReloadArguments
    $resultCode = $LASTEXITCODE
} finally {
    $env:OPENCODE_BROWSER_HOME = $previousRuntime
    $env:OPENCODE_BROWSER_PORT = $previousPort
}
exit $resultCode
