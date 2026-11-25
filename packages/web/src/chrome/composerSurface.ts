/**
 * t3code's composer surface (spec 12): the composer surface token at its glass opacity,
 * over the glass blur. The Generate composer, the Agent tray and the panels attached to it
 * share it; each adds its own radius, padding and shadow.
 */
export const composerGlassClass =
  "bg-(--composer-surface)/(--composer-surface-opacity) backdrop-blur-(--effect-glass-blur) backdrop-saturate-(--effect-glass-saturation)";
