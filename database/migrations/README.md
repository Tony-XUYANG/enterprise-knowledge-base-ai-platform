# SQL migrations

Add forward-only migrations using names such as `002_add_organizations.sql`.
Applied versions and SHA-256 checksums are stored in `schema_migrations`.
Never edit a migration after it has been applied; create a new migration instead.

Production deployments run migrations from the API container entrypoint before the server accepts traffic. Migration files are checksum-verified in `schema_migrations`; a modified applied file stops startup.
