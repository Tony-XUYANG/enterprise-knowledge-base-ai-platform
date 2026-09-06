[CmdletBinding()]
param(
    [string]$EnvFile = '.env.production',
    [string]$OutputDirectory = './backups'
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $workspace $EnvFile
$outputPath = Join-Path $workspace $OutputDirectory

if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Production environment file not found: $envPath"
}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupFile = Join-Path $outputPath "knowledgehub-$timestamp.dump"
$composeFile = Join-Path $workspace 'compose.production.yaml'

docker compose -f $composeFile --env-file $envPath exec -T db sh -c 'pg_dump -Fc --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > $backupFile
if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $backupFile -Force -ErrorAction SilentlyContinue
    throw 'Database backup failed'
}

Write-Output "Database backup written: $backupFile"
