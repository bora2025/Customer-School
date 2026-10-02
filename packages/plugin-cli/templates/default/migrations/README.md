# Migrations

Empty by default — this template has no database tables yet. When you need one, add a file here named `NNN_description.sql`, starting with the required identity header:

```sql
-- wattanam-plugin-migration: 001_create_widgets
CREATE TABLE "plugin_{{publisher}}_{{name}}_widgets" ("id" TEXT PRIMARY KEY, "label" TEXT NOT NULL);
```

Rules (enforced by the real backend verifier, and by `wattanam-plugin check`):
- Exactly one SQL statement per file.
- Every table referenced must start with `plugin_{{publisher}}_{{name}}_`.
- No transaction control, roles/users, extensions, grants/revokes, `COPY PROGRAM`, or anonymous `DO` blocks.
- `DROP`/`TRUNCATE`/`ALTER ... DROP` require `"destructive": true` on the migration entry in `plugin.json`.
- Add the file's SHA-256 checksum to `plugin.json`'s `migrations` array — `wattanam-plugin check` will tell you if it's missing or wrong.
- Once published, a migration's SQL is immutable — ship a new migration id for a schema change, never edit an old one. See `docs/plugins/upgrade-guide.md`.
