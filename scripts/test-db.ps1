$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $projectRoot
try {
    docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tests/001_smoke_test.sql'

    if ($LASTEXITCODE -ne 0) {
        throw "Database tests failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
