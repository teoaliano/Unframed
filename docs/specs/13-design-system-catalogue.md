# 13 · Design-system catalogue

Depends on: 00-index, 12

## Problem Statement

Spec 12 put every surface on one kit, but nothing shows the kit as a whole. To judge a component, a person has to find a screen that happens to show it. To change one, they have to search the code to learn where else it appears. So components get fixed one screen at a time, and nobody can see which variants exist, which go unused, or when a new component is needed.

## Solution

A read-only catalogue page in the web dev server, in the style of a light Storybook. A menu lists the tokens, every kit component and Unframed's own style recipes. Each entry's page shows the component in every variant, size and state, its API read from its source, and every line in the product that uses it. The page never changes styles. Changes happen in the code, and the page shows the result on the next reload.

## User Stories

1. As a maintainer, I want one page listing every kit component, so that I can see the whole kit at once.
2. As a maintainer, I want each component shown in every variant, size and state, so that I can judge it without hunting for a screen that uses it.
3. As a maintainer, I want each component's variants, defaults and parts read from its source, so that the documented API never drifts from the code.
4. As a maintainer, I want every file and line that uses a component, so that I know the blast radius of a change before I make it.
5. As a maintainer, I want components no product file uses marked as such, so that I can prune the kit.
6. As a maintainer, I want every theme token shown with its value in the current scheme, so that I can see the primitives the components are built from.
7. As a maintainer, I want a component added to the kit folder to appear in the menu before anyone writes its demo, so that the catalogue cannot silently miss one.
8. As a person using the desktop app, I want none of this in the app I install, so that it costs nothing.

## Implementation Decisions

**Where it lives.** `packages/web/design-system/`, with its own `index.html`. The web dev server (`pnpm dev`, `pnpm web`) serves it at `/design-system/`. The production build's only input is the app's `index.html`, so the published bundle and the desktop app carry none of it.

**Menu.** Three groups: Foundations (Tokens), Kit components (one entry per `.tsx` file in `src/components/ui/`, found by listing the folder), and Unframed recipes (a fixed list: message action, corner card and Tip, listbox, composer surface, label hues, shape looks). The URL hash names the entry, so a link opens it. An entry with no demo reads "no demo" in the menu.

**Entry page.** The title, the module path (a link that opens it in the editor), and a count of the product lines and files that use it, or "Not used in the product". Then:

- Examples: the entry's demo, `design-system/demos/<id>.tsx`, rendering every variant, size and meaningful state. Overlays open from a trigger.
- API, read from the module's source text when the page loads: its value exports; each `cva` recipe with its props, their options and default; the `data-slot` parts it renders.
- Used in the product: every line in `src/`, outside the module, that uses a name imported from it, grouped by file, each a link that opens the editor at that line. Uses inside the kit (`src/components/ui/`, `src/lib/`, `src/hooks/`) are listed apart.

**Tokens.** Every custom property the theme stylesheet defines, grouped as radius, shadows, type and colours, each with a sample and its value in the current scheme.

**Scheme.** The page follows the system scheme, as the app does. The tokens redefine on the root only, so it cannot show both schemes side by side.

**Opening files.** The links call the Vite dev server's own open-in-editor endpoint.

**Read only.** The page has no controls that change styles, tokens or props. It is not a design tool.

**Kit rules.** The page is held to spec 12's lint like the product: it uses kit components without restyling them.

## Testing Decisions

The browser seam, with the page served by the web dev server, which a test starts on a free port: the menu lists the tokens, every kit file and the recipes; a component's page shows its examples, the variants from its source and a known product usage; the tokens page resolves a token. The build the other browser specs serve holds no trace of the catalogue.

## Tasks

1. The page, its menu from the kit folder and the recipe list, hash navigation, and the tokens entry. Seam: browser.
2. The API and usage sections read from the source. Seam: browser.
3. A demo for every kit component and recipe. Seam: browser (the sweep that each page renders).
4. The production build carries none of it. Seam: browser.

## Out of Scope

- Editing styles, tokens or props from the page.
- Both schemes side by side.
- Documenting tldraw's own UI, which spec 12 themes but does not own.
- Publishing the catalogue anywhere.
