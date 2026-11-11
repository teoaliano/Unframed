export const componentTitleFromTag = (tag: string): string => {
  const words = tag.replace(/^uf-/, "").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
