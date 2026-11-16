param([Parameter(ValueFromRemainingArguments = $true)][string[]]$BrowseArguments)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$previousRuntime = $env:OPENCODE_BROWSER_HOME
$previousPort = $env:OPENCODE_BROWSER_PORT
try {
    $env:OPENCODE_BROWSER_HOME = Join-Path (Split-Path $sourceRoot -Parent) 'browse-group-controls-runtime'
    $env:OPENCODE_BROWSER_PORT = '19990'
    & node (Join-Path $sourceRoot 'cli/dist/cli.mjs') @BrowseArguments
    $resultCode = $LASTEXITCODE
} finally {
    $env:OPENCODE_BROWSER_HOME = $previousRuntime
    $env:OPENCODE_BROWSER_PORT = $previousPort
}
exit $resultCode
