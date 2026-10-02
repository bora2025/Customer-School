# Data model

`plugin_{{publisher}}_{{name}}_widget` is owned exclusively by `{{publisher}}.{{name}}`.

- Other plugins must consume a versioned route, durable event, or published read model.
- Never query or mutate another plugin's tables.
- Published migrations are immutable and forward-only.
- Removal preserves this table unless the operator separately approves cleanup after the rollback window.
