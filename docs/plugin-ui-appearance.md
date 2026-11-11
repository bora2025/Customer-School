# Styling plugin pages

Plugin pages (`frontend/page.json`) are declarative. A plugin never ships CSS or Tailwind classes. The school core draws every page with its own components in `frontend/components/plugin-ui/`, using classes from the core's Tailwind build.

## Where to make a style change

| You want to change | Edit | Live after |
|---|---|---|
| The look of all plugin pages (cards, tables, buttons) | `frontend/app/styles.css` (`.card`, `.btn`, …) | core release + deploy |
| One component type (e.g. the class manager) | `frontend/components/plugin-ui/Plugin*.tsx` | core release + deploy |
| Theme tokens (colors, fonts) | `frontend/tailwind.config.js`, the `:root` variables in `styles.css` | core release + deploy |
| How one plugin's page is arranged or tinted | that plugin's `page.json` `appearance` (below) | plugin release + school upgrade |

A merge to `main` does not change a live school: the core runs signed images. For instant feedback while working on styles, run `npm run dev` in `frontend/`. The local Docker stack needs `up -d --build web`.

## The `appearance` vocabulary

Pages and components can declare `appearance`, using only these values. The core rejects anything else, including `className`, `style` or `css`. The plugin CLI (`wattanam-plugin check`) reports the same errors before publishing.

```json
{
  "id": "overview",
  "appearance": { "theme": "company", "layout": "grid", "accent": "info" },
  "components": [
    { "id": "intro", "type": "text", "title": "…", "appearance": { "surface": "tinted", "tone": "info" } },
    { "id": "present", "type": "metric", "appearance": { "width": "third" } },
    { "id": "late", "type": "metric", "appearance": { "width": "third", "surface": "card", "tone": "warning" } }
  ]
}
```

| Page key | Values | Effect |
|---|---|---|
| `theme` | `standard`, `company` | `company` uses the company backdrop and heading style |
| `layout` | `stack` (default), `grid` | `grid` is a 12-column grid; components then use `width` |
| `accent` | tone | colored bar beside headings |

| Component key | Values | Effect |
|---|---|---|
| `width` | `full` (default), `half`, `third`, `two-thirds` | column span in a `grid` page (always full width on phones) |
| `surface` | `default`, `plain`, `card`, `tinted` | wraps the component in a card or a tinted panel |
| `tone` | `neutral`, `brand`, `info`, `success`, `warning`, `danger` | the color of a `card` accent or a `tinted` panel |

Schools on a core older than 0.1.26 ignore `appearance`, so declaring it is safe for every `requiresCore` range. Those schools render the page with the default look.

## Adding a value

1. Add it to `backend/src/plugins/plugin-ui-appearance.ts` and to `packages/plugin-cli/src/commands/check.js` (in both repositories).
2. Map it in `frontend/lib/plugin-ui-appearance.ts`, writing every class out in full. Tailwind only compiles class names it can read in the source, so `` `bg-${tone}-50` `` silently produces no CSS.
3. Add a schema test, then ship a core release.
