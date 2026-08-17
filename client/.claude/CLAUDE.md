# CLAUDE.md

Project-specific guidance for AI coding agents.

<!-- ASTRYX:START -->
Astryx v0.4.3 · 156 components
CLI: run every command as `npx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing, page frame included.
- Frame first: read `astryx docs layout` before writing any page or screen — page frame, region widths, breakpoint behavior.
- Dense data = rows (Table, List/Item), never Card-wrapped list items; Card is for standalone widgets. Status = StatusDot/Token; Badge = counts only.
- Custom styling: component props first; else style/className with tokens — var(--color-*|--spacing-*|--radius-*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent belongs in the theme (`astryx theme list` / `theme add <slug>`, or `astryx theme template` for a custom one) — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any raw <div>/<span> layout, imported .css/@apply, or hardcoded value (#hex, 16px) with the component or a token (var(--color-*|--spacing-*|…)). If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   156 components by category
  template --list    page + block recipes
  docs <topic>       color, elevation, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling, theme, tokens, typography
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any @astryxdesign/core bump
<!-- ASTRYX:END -->

<!-- Outside the ASTRYX markers on purpose: `astryx upgrade --apply` rewrites
     everything between them. -->

## The one sanctioned exception to "no <div>, components do all layout"

The parameter controls on the output nodes (`NativeSelect` in
`src/nodes/output/controls.jsx`) are raw `<select>` elements with hand-written CSS
in `src/styles.css`. Astryx popups are positioned purely by CSS anchor positioning,
and where the anchor fails to resolve they render at the viewport corner instead of
on their node — reproducible in the packaged Electron app and in Safari, not fixable
from this repo, and not fixed by the 0.4.3 upgrade. A native select's list is drawn
by the OS, so it cannot be mispositioned by any of that.

The exception is that one component, and it is not a precedent: **the CSS still uses
only tokens**, copied from the same `inputStyles` Astryx gives its own input wrapper,
so a theme change carries. Reach for a real component everywhere else, and take this
one back the day anchor positioning is reliable everywhere Unframed runs.
