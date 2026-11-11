# Plugin-owned screens (`app` component)

A plugin can ship its own screens as static files in its signed package, instead of relying on a screen built into the school core. The core shows them in a sandboxed iframe and lets them talk to the plugin's own API through a small bridge. A plugin can then change or add a screen in a **plugin release**, without a core release, and outside publishers can build rich screens too.

Requires school core **0.1.29** or newer. Set `requiresCore` to `>=0.1.29` in any plugin version that uses `app`, because older cores refuse the unknown component type.

## Declaring a screen

```json
{ "id": "sessions", "title": "Attendance Sessions", "routePath": "sessions", "permission": "wattanam.demo.view",
  "parameters": [], "dataSources": [],
  "components": [{ "id": "sessions-app", "type": "app", "title": "Attendance Sessions",
                   "options": { "entry": "ui/sessions/index.html", "height": "auto", "minHeight": 420 } }] }
```

| Option | Rules |
|---|---|
| `entry` | Required. Must be `ui/<path>.html` with lowercase segments, and the file must be in the signed package. |
| `height` | `auto` (the screen reports its height) or `fill` (fills the viewport). |
| `minHeight` | 120–4000 px. |

Files go under `ui/` in the plugin folder. `wattanam-plugin pack` signs them like every other file. Allowed types are `.html .js .mjs .css .json .svg .png .jpg .jpeg .gif .webp .ico .woff .woff2`. Inline `<script>` blocks are blocked, so put scripts in separate files and load them with `<script src="...">`.

## What the screen can and cannot do

**The screen runs in `<iframe sandbox="allow-scripts allow-forms allow-modals allow-downloads">` with no `allow-same-origin`.** The core serves the files with this CSP: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; frame-ancestors 'self'; sandbox …`.

| The screen can | The screen cannot |
|---|---|
| Call its **own** plugin's API as the signed-in user, through the bridge | Make network requests itself (`fetch`, XHR, WebSocket) |
| Use its own files: scripts, styles, images, fonts | Read school cookies, local storage or the school page |
| Resize its frame and move between its own plugin's pages | Call core APIs or another plugin's API |
| Show forms, confirmation dialogs and downloads | Navigate the school window |

The plugin's API still checks the user's permissions on every call, so the bridge never grants more than the plugin's own routes already allow.

Each file is checked against the package's signed checksums before it is served. A plugin that is not active, or any version other than the one installed, gets a 404. The URL contains the version, so files are cached as immutable.

**Limitation:** a screen can still send data away by navigating its own frame to another site. Sandboxing cannot prevent this. Only trusted publishers' screens should handle sensitive data, which is the same trust rule that applies to their backend code.

## The bridge (protocol `wattanam.plugin-ui/1`)

The Wattanam plugin SDK ships a ready-made client, `wattanam-plugin-ui.js`. Copy it into `ui/` and load it before your own script. The raw messages are:

| From the screen | Host reply |
|---|---|
| `{ type: 'ready' }` | `{ type: 'init', pluginId, pluginVersion, params, language, theme }` |
| `{ type: 'request', id, method, path, query?, body? }` | `{ type: 'response', id, status, body }`. `path` is relative to the plugin's API, e.g. `classes/42`. Unsafe paths (`..`, encoded slashes) get no reply. |
| `{ type: 'resize', height }` | (none) |
| `{ type: 'navigate', routePath }` | (none). Opens `/plugins/<pluginId>/<routePath>`. |

Every message carries `protocol: 'wattanam.plugin-ui/1'`.

Limits:
- 20 requests per second per frame; extra requests get status 429.
- Request bodies: JSON only, up to 256 KiB.
- Replies are JSON.

## Tests

- `backend/src/plugins/plugin-ui-assets.spec.ts`: paths, headers, checksum verification, version and activity checks, and schema rules.
- `frontend/e2e/plugin-ui/plugin-ui-app-sandbox.spec.ts`: a real browser. The bridge works, and network, cookie, DOM, storage and path-trick escapes are all refused. Runs in the CI job `plugin-ui-sandbox-browser`.
