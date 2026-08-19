/*
  The app's Astryx theme: neutral, with the surface colours replaced. Values were read
  by eye off reference screenshots, so the relationships below are the load-bearing
  part and the exact numbers are taste. Why they live here and not in styles.css: see
  CLAUDE.md.
*/
import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

export const unframedTheme = defineTheme({
  name: 'unframed',
  extends: neutralTheme,
  tokens: {
    // [light, dark]
    // `card` is the node fill and has to differ from `body`, the canvas. Neutral had
    // both at #1b1b1b in dark, leaving a node distinguishable by its border alone.
    '--color-background-body': ['#f7f7f7', '#1a1a1a'],
    // Nodes (Astryx Card) and the floating chrome share one lifted surface.
    '--color-background-card': ['#ffffff', '#2a2a2a'],
    '--color-background-surface': ['#ffffff', '#2a2a2a'],
    // Menus open ON TOP of that chrome, so this has to stay above whatever card and
    // surface are, or a menu reads as sunk into the panel it opened from.
    '--color-background-popover': ['#ffffff', '#333333'],
    // The modal scrim, against neutral's 50%/80%. It is what a dialog's own
    // translucency is read THROUGH: at 80% black the canvas behind is gone, so the
    // glass has nothing to transmit and reads solid however thin its fill is.
    '--color-overlay': ['#00000026', '#00000040'],
  },
});
