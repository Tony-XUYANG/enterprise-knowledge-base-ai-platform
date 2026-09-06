#!/bin/sh
set -eu

attempt=1
max_attempts="${MIGRATION_RETRIES:-30}"
until node /app/apps/api/dist/db/migrate.js; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Database migrations failed after ${attempt} attempts" >&2
    exit 1
  fi
  echo "Database is not ready; retrying migrations (${attempt}/${max_attempts})" >&2
  attempt=$((attempt + 1))
  sleep 2
done

exec node /app/apps/api/dist/server.js
