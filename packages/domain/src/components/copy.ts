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

/** The declaration element, whatever order its attributes come in, as the reader finds it (comments blanked, so offsets match). */
const DECLARATION = /(<script\b(?=[^>]*\btype\s*=\s*"application\/json")(?=[^>]*\sdata-uf-component(?=[\s=>]))[^>]*>)([\s\S]*?)(<\/script>)/i;

/** The sheet with its declaration's tag replaced (spec 20's copy): every other byte of the sheet is kept. The sheet must be valid. */
export const retagSheet = (html: string, tag: string): string => {
  const blanked = html.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
  const match = DECLARATION.exec(blanked);
  if (!match) return html;
  const [whole, open, body, close] = match;
  const start = match.index;
  return `${html.slice(0, start)}${open}${JSON.stringify({ ...JSON.parse(html.slice(start + open!.length, start + open!.length + body!.length)), tag })}${close}${html.slice(start + whole.length)}`;
};
