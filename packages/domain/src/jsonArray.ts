/**
 * The text of each element of a JSON array, exactly as written. The preset store rewrites
 * `presets.json` whole but keeps every entry it does not change byte for byte, so an entry
 * this version does not understand survives every save and delete.
 */

const WHITESPACE = /\s/;

/** Each top-level element's source text, trimmed. `text` must already parse as JSON; anything but an array answers `undefined`. */
export const splitJsonArray = (text: string): string[] | undefined => {
  let at = 0;
  const skip = () => {
    while (at < text.length && WHITESPACE.test(text[at]!)) at++;
  };
  skip();
  if (text[at] !== "[") return undefined;
  at++;
  const elements: string[] = [];
  let depth = 0;
  let inString = false;
  let start = -1;
  for (; at < text.length; at++) {
    const char = text[at]!;
    if (inString) {
      if (char === "\\") at++;
      else if (char === '"') inString = false;
      continue;
    }
    if (start < 0 && !WHITESPACE.test(char) && char !== "," && !(char === "]" && depth === 0)) start = at;
    if (char === '"') inString = true;
    else if (char === "[" || char === "{") depth++;
    else if ((char === "]" || char === "}") && depth > 0) depth--;
    else if (depth === 0 && (char === "," || char === "]")) {
      if (start >= 0) elements.push(text.slice(start, at).trim());
      start = -1;
      if (char === "]") return elements;
    }
  }
  return undefined;
};

/** A JSON array of the given element texts, one per line. */
export const joinJsonArray = (elements: ReadonlyArray<string>): string => (elements.length === 0 ? "[]\n" : `[\n${elements.join(",\n")}\n]\n`);
