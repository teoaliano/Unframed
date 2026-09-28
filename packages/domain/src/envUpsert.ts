type Line = { readonly content: string; readonly ending: string };

const splitLines = (text: string): Line[] => {
  const lines: Line[] = [];
  const pattern = /([^\n]*?)(\r\n|\n|$)/g;
  for (const match of text.matchAll(pattern)) {
    const [whole, content = "", ending = ""] = match;
    if (whole === "") break;
    lines.push({ content, ending });
  }
  return lines;
};

const upsertOne = (lines: Line[], name: string, value: string | null): Line[] => {
  const prefix = `${name}=`;
  const next: Line[] = [];
  let replaced = false;
  for (const line of lines) {
    if (!line.content.startsWith(prefix)) {
      next.push(line);
    } else if (value !== null && !replaced) {
      next.push({ content: `${prefix}${value}`, ending: line.ending });
      replaced = true;
    }
    // Every other line for this name is dropped: dotenv keeps the last assignment, so a
    // later duplicate would let a stale value win.
  }
  if (value !== null && !replaced) {
    const last = next.at(-1);
    if (last !== undefined && last.ending === "") next[next.length - 1] = { ...last, ending: "\n" };
    next.push({ content: `${prefix}${value}`, ending: "\n" });
  }
  return next;
};

/**
 * Applies `changes` to `.env` text: a value replaces the first line for its name in
 * place (keeping that line's ending) or is appended; `null` deletes every line for the
 * name. Comments, blank lines and unknown variables stay byte for byte. Values are
 * written unquoted: the validators forbid quotes, `#` and line breaks.
 */
export const envUpsert = (text: string, changes: Readonly<Record<string, string | null>>): string => {
  let lines = splitLines(text);
  for (const [name, value] of Object.entries(changes)) lines = upsertOne(lines, name, value);
  return lines.map((line) => line.content + line.ending).join("");
};
