/**
 * How a page, a motion or a media shape is named where the agent's work is listed (chips,
 * mentions, recap rows, diffs): its title, else its original file name without `.html`.
 * `undefined` when it has neither; each caller has its own last resort.
 */
export const shapeLabel = (props: { readonly title?: unknown; readonly fileName?: unknown }): string | undefined => {
  if (typeof props.title === "string" && props.title.trim() !== "") return props.title;
  if (typeof props.fileName === "string" && props.fileName !== "") return props.fileName.replace(/\.html$/i, "");
  return undefined;
};
