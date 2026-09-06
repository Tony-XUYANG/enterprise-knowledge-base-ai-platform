[CmdletBinding()]
param(
    [string]$EnvFile = '.env.production',
    [switch]$SkipDocker
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $workspace $EnvFile

if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Production environment file not found: $envPath"
}

$contents = Get-Content -LiteralPath $envPath -Raw
if ($contents -match '(?i)(CHANGE_ME|REPLACE_WITH|replace_with)') {
    throw "Production environment still contains placeholder values: $envPath"
}

$required = @(
    'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD',
    'JWT_SECRET', 'DATA_ENCRYPTION_KEY', 'CORS_ORIGIN', 'WEB_BASE_URL',
    'SMTP_HOST', 'MAIL_FROM'
)
$values = @{}
foreach ($line in (Get-Content -LiteralPath $envPath)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $values[$Matches[1]] = $Matches[2]
    }
}
foreach ($name in $required) {
    if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($values[$name])) {
        throw "Required production variable is missing: $name"
    }
}

if ($values['JWT_SECRET'].Length -lt 32) {
    throw 'JWT_SECRET must be at least 32 characters'
}
if ($values['DATA_ENCRYPTION_KEY'] -notmatch '^[0-9a-fA-F]{64}$') {
    throw 'DATA_ENCRYPTION_KEY must be exactly 64 hexadecimal characters'
}

if (-not $SkipDocker) {
    docker info --format '{{.ServerVersion}}' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Engine is not available'
    }
    docker compose -f (Join-Path $workspace 'compose.production.yaml') --env-file $envPath config -q
    if ($LASTEXITCODE -ne 0) {
        throw 'Production Compose configuration is invalid'
    }
}

Write-Output "Production preflight passed: $envPath"
