/*
  The app's Astryx theme: neutral, with the surface colours replaced.

  Values were read off the reference screenshots — a dark page with the composer
  lifted off it; a white page with a white input, a hairline border and a soft
  shadow. Read by eye, so treat them as approximate: the first pass came out a
  step and a half too dark because the reference shots were all-dark edge to edge
  with no white in frame to anchor against, and the surface being copied is itself
  translucent, which means it has no one true colour to copy. The RELATIONSHIPS
  below are the load-bearing part; the exact values are taste.

  They live here rather than in styles.css
  because Astryx declares its tokens on the <Theme> wrapper via @scope, so a
  `:root` override in a stylesheet loses to the wrapper's own declaration for
  everything inside it. defineTheme is also the only place a raw colour belongs;
  everything downstream reads the token.

  The pairing that matters: `card` is the node fill and it has to differ from
  `body`, the canvas. Neutral's dark mode had both at #1b1b1b, which left a node
  distinguishable from the canvas by its border alone. Light mode started out with
  both at white, following the reference literally, and read too flat on a canvas —
  where a node has to look like an object sitting on a surface, not a bordered patch
  of it. The canvas is now a step off white and the nodes keep it, so the step plus
  each node Card's `elevation="low"` does the separating.
*/
import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

export const unframedTheme = defineTheme({
  name: 'unframed',
  extends: neutralTheme,
  tokens: {
    // [light, dark]
    '--color-background-body': ['#f7f7f7', '#1a1a1a'],
    // Nodes (Astryx Card) and the floating chrome share one lifted surface, the
    // way the reference's input and its "Outputs" card do.
    '--color-background-card': ['#ffffff', '#2a2a2a'],
    '--color-background-surface': ['#ffffff', '#2a2a2a'],
    // Menus open ON TOP of that chrome, so they take the next step up rather than
    // matching it. This one is not free to choose: it has to stay above whatever
    // card/surface is, or a menu reads as sunk into the panel it opened from.
    '--color-background-popover': ['#ffffff', '#333333'],
    // The modal scrim, now 15%/25% against neutral's 50%/80%. It is what a dialog's
    // own translucency is read THROUGH, and a dialog here is meant to look like a
    // pane of glass: at 80% black the canvas behind it was already gone, so the
    // glass had nothing to transmit and read as a solid panel however thin its fill
    // was. What separates a modal from the canvas is now the blur and the dialog's
    // lit edge rather than darkness, which is what lets this go this light.
    '--color-overlay': ['#00000026', '#00000040'],
  },
});
