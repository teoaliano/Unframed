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
