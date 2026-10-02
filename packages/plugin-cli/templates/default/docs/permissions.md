# Permissions

| Permission | Purpose | Recommended roles |
| --- | --- | --- |
| `{{publisher}}.{{name}}.manage` | View and update {{displayName}} settings. | `SUPER_ADMIN`, explicitly delegated administrators |

Keep permissions task-specific. Adding a permission is compatible; renaming or removing one needs
a migration plan for existing grants.
