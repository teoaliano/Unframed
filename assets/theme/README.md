Spec 12 replaced these values with t3code's default tokens. They stay here as history and are no longer the visual reference.

# Theme values

The old app's look, as values. Match these through the Tailwind theme (CSS variables on the root, a light and a dark value each). They are values, not code to port.

- `resolved-tokens.json`: every CSS custom property the old app resolved at runtime, captured from the running app. Colour values are `light-dark(<light>, <dark>)` pairs. Colours, radii, spacing, type sizes, borders and shadows all come from here. The old design system's variable names are kept as keys so related values stay grouped; rename them freely in the new theme.
- The values the old app chose itself, on top of its design system's neutral theme:

| Role | Light | Dark |
| --- | --- | --- |
| canvas background | `#f7f7f7` | `#1a1a1a` |
| shape card and floating chrome surface | `#ffffff` | `#2a2a2a` |
| menus and popovers (above the chrome) | `#ffffff` | `#333333` |
| modal scrim | `#00000026` | `#00000040` |

- Chrome constants (both schemes): backdrop blur on floating chrome `20px`; scrim filter `blur(10px) saturate(160%)`; gap between a shape's edge and its connection affordance `4px`; a film-grain overlay made from an SVG `feTurbulence` fractal noise tile (140px, base frequency 0.9, 2 octaves, desaturated, opacity 0.1).
- The canvas dot grid: dots 1.1px on screen at any zoom, grid gap 26 canvas units, doubling whenever the on-screen gap would fall below 16px, dot colour mixed from the text and background tokens.
- The chat rail's tab strip uses a folder-tab shape: rounded top corners only, open at the bottom, sitting on the rule under the strip; the selected tab has the emphasised border and the surface fill, which covers the rule and makes the notch.

Screenshots of every surface in both schemes are in `../screenshots/`.

## Library chips

Each preset card and row shows chips. Each chip uses one hue's background, border and icon tokens (`--color-background-<hue>`, `--color-border-<hue>`, `--color-icon-<hue>` in `resolved-tokens.json`):

| Chip | Hue |
| --- | --- |
| flow (now: recipe) | purple |
| block (now: group) | blue |
| image | teal |
| video | orange |
| text | cyan |
| custom | green |
| system | pink (not gray: gray sat at the same weight as the Add button beside it, and yellow would read as a warning) |

## Group box

A group draws a dashed `--border-width` (1px) border in `--color-border`, corner radius `--radius-container` (0.75rem), and a fill of `--color-border` mixed at 8% into transparent. Selected, the border turns solid in `--color-accent`.
