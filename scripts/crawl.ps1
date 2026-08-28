<#
.SYNOPSIS
    Runs the catalogue crawl, with logging and log rotation, for Windows Task
    Scheduler. Mirrors the pattern already used by paddle_sync.ps1 in Joola Pulse.

.DESCRIPTION
    Exit codes:
      0  clean       every stage completed
      1  partial     some stages or collections failed; data was still written
      2  error       the run produced nothing

.EXAMPLE
    # Register a daily 09:00 task (run once, from an elevated prompt):
    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
                 -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Workspace\ClaudeProductFinder\scripts\crawl.ps1"'
    $trigger = New-ScheduledTaskTrigger -Daily -At 9:00am
    Register-ScheduledTask -TaskName 'ProductFinder Daily Crawl' -Action $action -Trigger $trigger `
                 -Description 'Crawls configured brand storefronts and records price/stock history.'
#>

[CmdletBinding()]
param(
    [string] $Brand,
    [string] $Country,
    [string] $Stages,
    [switch] $DryRun,
    [int]    $KeepLogs = 30
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot 'storage\logs'

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$logFile = Join-Path $logDir "crawl_$stamp.log"

# Rotate: keep only the most recent $KeepLogs runs.
Get-ChildItem -Path $logDir -Filter 'crawl_*.log' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $KeepLogs |
    Remove-Item -Force -ErrorAction SilentlyContinue

$crawlArgs = @('tsx', 'src/cli.ts', 'crawl', '--scheduled')
if ($Brand)   { $crawlArgs += @('--brand', $Brand) }
if ($Country) { $crawlArgs += @('--country', $Country) }
if ($Stages)  { $crawlArgs += @('--stages', $Stages) }
if ($DryRun)  { $crawlArgs += '--dry-run' }

Push-Location $repoRoot
try {
    "=== ProductFinder crawl started $(Get-Date -Format 'u') ===" | Tee-Object -FilePath $logFile
    "args: $($crawlArgs -join ' ')" | Tee-Object -FilePath $logFile -Append

    & npx @crawlArgs 2>&1 | Tee-Object -FilePath $logFile -Append
    $exitCode = $LASTEXITCODE

    $verdict = switch ($exitCode) {
        0 { 'clean' }
        1 { 'PARTIAL - check crawl_errors' }
        default { 'ERROR - no data written' }
    }
    "=== finished $(Get-Date -Format 'u') : $verdict (exit $exitCode) ===" |
        Tee-Object -FilePath $logFile -Append

    exit $exitCode
}
finally {
    Pop-Location
}
