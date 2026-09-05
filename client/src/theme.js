/*
  The app's Astryx theme: neutral, with the surface colours replaced. Values were read
  by eye off reference screenshots, so the relationships below are the load-bearing
  part and the exact numbers are taste. Why they live here and not in styles.css: see
  CLAUDE.md.
*/
import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

// The folder silhouette, shared by a tab and by the overflow menu's trigger -- which IS
// a tab whenever the thread it names is the active one. Why it is here and not in a
// stylesheet: the comment on `components` below.
const folderTab = {
  minWidth: 0,
  overflow: 'hidden',
  paddingInline: 'var(--spacing-2)',
  borderRadius: 'var(--radius-element) var(--radius-element) 0 0',
  border: 'var(--border-width) solid transparent',
  borderBottom: 'none',
  marginBottom: 'calc(-1 * var(--border-width))',
};
const folderTabOpen = {
  borderColor: 'var(--color-border-emphasized)',
  background: 'var(--color-background-surface)',
};

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
  components: {
    /*
      Folder tabs, for the agent panel's thread strip (agent/AgentPanel.jsx): a box with
      a rounded top, open at the bottom, sitting ON the rule that separates the strip
      from the transcript it opens onto. Astryx's TabList marks the selected tab with an
      underline instead; the folder says "this tab IS that panel", which is what a strip
      of different conversations needs it to say. This is the whole app's TabList, not
      the panel's -- a second one anywhere inherits the shape.

      It lives here rather than in styles.css because Astryx's base styles come out of
      StyleX and only the theme's generated rules land in a layer above them (CLAUDE.md's
      `@scope` trap, a different mechanism, same lesson). Three details are load-bearing:
      `border-bottom: none` plus the negative bottom margin is what puts the tab's box
      OVER `.agent-tabs`'s rule rather than above it; the opaque fill on the selected tab
      is the only thing that then covers that 1px, and the notch it leaves is the join;
      and `overflow: hidden` clips Astryx's hover pill, an absolutely positioned child
      with its own all-corner radius, back to the folder silhouette.
    */
    'tab-list': {
      base: {
        gap: '2px',
        alignItems: 'flex-end',
      },
    },
    tab: {
      base: folderTab,
      selected: folderTabOpen,
    },
    // The overflow trigger takes the same shape, because Astryx makes it wear the active
    // tab's label when the active tab is one of the ones it holds. Its open state cannot
    // come from here -- it renders no `selected` marker of its own, only the indicator --
    // so styles.css picks it out by that indicator's presence.
    'tab-menu': {
      base: folderTab,
    },
    // The underline the folder shape replaces.
    'tab-indicator': {
      base: { display: 'none' },
    },
  },
});
