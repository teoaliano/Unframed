import { Background, useStore } from '@xyflow/react';

/*
  React Flow scales BOTH the dot and the gap by the zoom, so a size-1 dot renders at
  0.17px at 34% and disappears. Hence dividing the dot by the zoom to hold its size on
  screen, and doubling the gap under MIN_GAP — a constant dot on the un-doubled gap
  sits 2.6px from its neighbour at 10% zoom and reads as noise. Zooming in is left
  alone. Its own component, and its own zoom subscription, because it rerenders on
  every frame of a pan.
*/
const BASE_GAP = 26;
const MIN_GAP = 16; // px on screen, below which the grid reads as texture
const DOT = 1.1; // px on screen, constant at every zoom

/*
  Faded towards the canvas rather than towards transparent, so the dot stays opaque and
  paints what this mix computes rather than also depending on how a 1px circle's
  antialiasing lands. One expression serves both modes because both tokens are
  mode-aware: the mix runs down from the canvas in dark, up from it in light.
*/
const DOT_COLOR =
  'color-mix(in srgb, var(--color-border-emphasized) 68%, var(--color-background-body))';

export default function CanvasBackground() {
  const zoom = useStore((s) => s.transform[2]);
  let gap = BASE_GAP;
  while (gap * zoom < MIN_GAP) gap *= 2;
  return <Background gap={gap} size={DOT / zoom} color={DOT_COLOR} />;
}
