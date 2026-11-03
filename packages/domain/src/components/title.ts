/** A new component's title when the agent gives none (spec 20): the tag without `uf-`, hyphens as spaces, the first letter capitalised. */
export const componentTitleFromTag = (tag: string): string => {
  const words = tag.replace(/^uf-/, "").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
