# Plugin database boundary

Plugins store their data in tables named `plugin_<id>_*` in the school database. Two layers keep a plugin inside its own tables.

1. **SQL guard** (`backend/src/plugins/plugin-sql-guard.ts`) runs before every plugin statement. It refuses transaction control, role and grant changes, `COPY`, `DO`, `RESET`, `SET ROLE`, `SET SESSION AUTHORIZATION`, `set_config(...)` and `SECURITY DEFINER`, and rejects table references outside the plugin's namespace. It is a fast, readable early error. It is not a complete SQL parser.
2. **Per-plugin PostgreSQL role** (`backend/src/plugins/plugin-database-roles.ts`, since core 0.1.28). This layer is enforced by PostgreSQL itself.
   - Every plugin statement runs inside a transaction after `SET LOCAL ROLE wtp_<plugin id>`.
   - That role is `NOLOGIN`, non-superuser and has no other attributes. It holds `SELECT, INSERT, UPDATE, DELETE` only on the plugin's own relations, plus `USAGE` on its sequences.
   - A plugin statement therefore cannot read core tables (users, sessions, audit), other plugins' tables or server files, even though the school API often connects as the database owner.
   - Dynamic SQL inside a function (`query_to_xml`, trigger bodies) runs under the same role.

## Lifecycle

- **Creating and refreshing roles:** each time a plugin loads, its role is created if missing, its attributes are re-asserted and grants are refreshed. Tables added by a new migration, and databases restored from a backup without grants, are therefore covered on the next load.
- **Host work in a plugin transaction:** event publication into core tables runs as the school API's own user. Plugin statements and host work run one at a time, so a role switch never overlaps another statement.
- **Migrations** run as the school API's own user. They remain guarded by the SQL guard, checksums and the single-statement rule.
- **Cluster-wide roles:** PostgreSQL roles are cluster-wide, but grants are per database. Several schools on one cluster share a role name per plugin without gaining access to each other's data.

## Operating it

| Setting | Effect |
|---|---|
| `PLUGIN_DATABASE_ROLES` unset or `enforce` (default) | boundary on |
| `PLUGIN_DATABASE_ROLES=off` | boundary off. Emergency use only, e.g. a database user without role privileges. |

- **Superuser connection (Railway default):** works as-is.
- **Hardened non-superuser API user:** the user needs `CREATEROLE`, plus `GRANT ... WITH GRANT OPTION` on the plugin tables. It is made a member of each plugin role so it can switch into it. A plugin role found with widened attributes is refused until a superuser resets it.

Tests:
- `plugin-database-roles.spec.ts`: ordering and serialisation, with a mocked database.
- `plugin-database-roles.postgres.spec.ts`: real PostgreSQL, run by the CI job `plugin-database-roles-postgres`.
