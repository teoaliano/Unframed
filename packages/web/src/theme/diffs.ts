/**
 * t3code's injected diff CSS (its DIFF_SURFACE_THEME_UNSAFE_CSS, MIT): every surface the
 * `@pierre/diffs` renderer paints, mapped onto the diff panel's tokens. The renderer
 * draws in a shadow root, which the app's stylesheets cannot reach, so this goes in through
 * its `unsafeCSS` option; the tokens it reads inherit into the shadow root.
 */
export const DIFF_SURFACE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: var(--diff-panel-code-surface) !important;
  --diffs-light-bg: var(--diff-panel-code-surface) !important;
  --diffs-dark-bg: var(--diff-panel-code-surface) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--diff-panel-code-surface), var(--diff-panel-context-line-tint) var(--diff-panel-context-line-tint-opacity));
  --diffs-bg-hover-override: color-mix(in srgb, var(--diff-panel-code-surface), var(--diff-panel-hover-line-tint) var(--diff-panel-hover-line-tint-opacity));
  --diffs-bg-separator-override: color-mix(in srgb, var(--diff-panel-code-surface), var(--diff-panel-separator-line-tint) var(--diff-panel-separator-line-tint-opacity));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--diff-panel-code-surface), var(--diff-panel-buffer-line-tint) var(--diff-panel-buffer-line-tint-opacity));

  --diffs-bg-addition-override: color-mix(in srgb, var(--diff-panel-code-surface), var(--diff-panel-addition-line-tint) var(--diff-panel-addition-line-tint-opacity));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--diff-panel-code-surface), var(--diff-panel-addition-line-tint) var(--diff-panel-addition-number-tint-opacity));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--diff-panel-code-surface), var(--diff-panel-addition-line-tint) var(--diff-panel-addition-line-tint-hover-opacity));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--diff-panel-code-surface), var(--diff-panel-addition-line-tint) var(--diff-panel-addition-emphasis-opacity));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--diff-panel-code-surface), var(--diff-panel-deletion-line-tint) var(--diff-panel-deletion-line-tint-opacity));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--diff-panel-code-surface), var(--diff-panel-deletion-line-tint) var(--diff-panel-deletion-number-tint-opacity));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--diff-panel-code-surface), var(--diff-panel-deletion-line-tint) var(--diff-panel-deletion-line-tint-hover-opacity));
  --diffs-bg-deletion-emphasis-override: color-mix(in srgb, var(--diff-panel-code-surface), var(--diff-panel-deletion-line-tint) var(--diff-panel-deletion-emphasis-opacity));

  background-color: var(--diffs-bg) !important;
  color: var(--diff-panel-code-foreground) !important;
}
`;
