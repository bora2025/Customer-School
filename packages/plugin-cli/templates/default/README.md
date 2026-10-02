# {{displayName}}

Scaffolded by `wattanam-plugin init`. The project includes a signed manifest contract, backend,
declarative frontend, namespaced migration, English/Khmer translations, and operational docs.
See `docs/plugins/package-and-runtime.md` in Wattanam V2 for the SDK 1.1 contract.

## Develop

```bash
npx wattanam-plugin check .          # validate plugin.json, migrations, and entry points
```

Write unit tests against `backend/index.js` using `@wattanam/plugin-sdk`'s `createTestContext()` — see that package's README.

## Package and sign

```bash
npx wattanam-plugin keygen ./keys
npx wattanam-plugin pack --source . --private-key ./keys/plugin-signing-private.pem --key-id my-key-2026 --out ./dist/{{publisher}}-{{name}}-0.1.0.wtp
```

## Publish (official repository only — see the platform's publishing policy)

```bash
npx wattanam-plugin publish --package ./dist/{{publisher}}-{{name}}-0.1.0.wtp --repository-url https://marketplace.example --admin-token $MARKETPLACE_ADMIN_TOKEN --channel beta --changelog "Initial release"
```
