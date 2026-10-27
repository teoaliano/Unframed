/**
 * The tag a pasted or duplicated component gets (spec 20): `<tag>-copy`, then `<tag>-copy-2`,
 * and so on, the first name the destination does not hold.
 */
export const copiedTag = (tag: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(`${tag}-copy`)) return `${tag}-copy`;
  for (let n = 2; ; n++) {
    const candidate = `${tag}-copy-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
};

const DECLARATION = /(<script\b[^>]*data-uf-component>)([\s\S]*?)(<\/script>)/i;

/** The sheet with its declaration's tag replaced (spec 20's copy): every other byte of the sheet is kept. The sheet must be valid. */
export const retagSheet = (html: string, tag: string): string =>
  html.replace(DECLARATION, (_all, open: string, body: string, close: string) => `${open}${JSON.stringify({ ...JSON.parse(body), tag })}${close}`);
