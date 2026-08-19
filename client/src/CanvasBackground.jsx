import { Background, useStore } from '@xyflow/react';

/*
  The canvas dot grid, zoom-compensated.

  React Flow scales BOTH halves of its pattern by the zoom (`scaledSize = size *
  zoom`, `scaledGap = gap * zoom`), which is why the dots vanish on the way out:
  at 30% a size-1 dot is a third of a pixel. The grid was scaling — that was the
  problem, not the absence of it.

  So the dot is divided by the zoom to hold a constant size on screen, and the gap
  doubles whenever the spacing it would draw falls under MIN_GAP. Without that
  doubling a constant-size dot at 10% zoom sits 2.6px from its neighbour and the
  canvas turns to noise — the opposite failure, and a worse one. Zooming IN is
  deliberately left alone: the spacing opens up and that is the part that already
  looked right.

  Its own component, and its own subscription to the zoom, because this rerenders
  on every frame of a pan. Reading the viewport up in App would rerender the whole
  canvas with it.
*/
const BASE_GAP = 26;
const MIN_GAP = 16; // px on screen, below which the grid reads as texture
const DOT = 1.1; // px on screen, constant at every zoom

/*
  `--color-border` alone was too close to the canvas to register on a 1px dot — a 10%
  white in dark mode, which composites to rgb(49,49,49). The emphasized border is the
  token that means "a hairline that has to be seen", which is what this is, but on its
  own it overshoots (rgb(82,82,82) in dark, 1.7x the old dot where 1.3x was wanted).
  So it is faded back part of the way TOWARDS THE CANVAS.

  Towards the canvas rather than towards transparent, deliberately: the dot stays
  opaque, so what it paints is exactly what this mix computes, and does not also
  depend on how a 1px circle's antialiasing lands.

  One expression covers both modes because BOTH tokens are already mode-aware, so the
  mix travels in whichever direction that mode needs — down from the canvas in dark
  (rgb(64,64,64) on rgb(26,26,26)), up from it in light (rgb(226,226,226) on white).
  A light-dark() pair here would restate what the tokens already know.

  React Flow passes `color` through to a CSS custom property that the dot's `fill`
  reads, so this is a real CSS value and the mix resolves — it is not an SVG
  presentation attribute, where these functions would be dropped.
*/
const DOT_COLOR =
  'color-mix(in srgb, var(--color-border-emphasized) 68%, var(--color-background-body))';

export default function CanvasBackground() {
  const zoom = useStore((s) => s.transform[2]);
  let gap = BASE_GAP;
  while (gap * zoom < MIN_GAP) gap *= 2;
  return <Background gap={gap} size={DOT / zoom} color={DOT_COLOR} />;
}
