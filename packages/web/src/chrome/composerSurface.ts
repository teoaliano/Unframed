/**
 * t3code's composer surface (spec 12): `--card` in light and `--surface-raised` in dark at
 * the glass opacity, over the glass blur. The Generate composer, the Agent tray and the
 * panels attached to it share it; each adds its own radius, padding and shadow.
 */
export const composerGlassClass =
  "bg-card/(--glass-opacity) backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturation) dark:bg-surface-raised/(--glass-opacity)";
