/**
 * The kit's looks for Unframed's own shape parts (spec 12). tldraw draws the shapes, so
 * these are class recipes on plain elements rather than kit components.
 */

/** The label band above a shape's top-left corner: extra-small muted text, in the case it is written. */
export const shapeLabelClass =
  "pointer-events-none absolute bottom-full left-0 flex h-5.5 items-center whitespace-nowrap font-sans text-2xs leading-none text-(--shape-label-foreground)";

/** An empty media shape, a placeholder and a render placeholder: a card that asks for or awaits a file. */
export const mediaCardClass = "box-border rounded-lg border border-(--media-card-border) bg-(--media-card-surface) font-sans text-(--media-card-foreground)";

/** An empty page or motion, and a filled one's still: the kit's card with the larger radius. */
export const artifactCardClass = "box-border rounded-xl border border-(--artifact-card-border) bg-(--artifact-card-surface)";
