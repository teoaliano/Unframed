/**
 * The tokens an artifact file refers to (spec 19): by a CSS name (`var(--color-brand-primary)`,
 * a text style's sub-name included), by a former name a rename kept working, or through
 * `unframed.token("<path>")` or `unframed.token("--<css name>")` in script.
 */
import type { Kit, Token } from "./types.ts";
import { cssName } from "./runtime.ts";
import { TEXT_STYLE_SUFFIX } from "./types.ts";

/** Every CSS name a token makes, its former names included. */
const namesOf = (token: Token): string[] => {
  const bases = [cssName(token.path), ...(token.formerNames ?? [])];
  return bases.flatMap((base) => (token.type === "textStyle" ? Object.values(TEXT_STYLE_SUFFIX).map((sub) => `${base}-${sub}`) : [base]));
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The paths of the tokens `html` refers to, in kit order. */
export const tokenUses = (html: string, kit: Kit): string[] => {
  const used: string[] = [];
  for (const token of kit.tokens) {
    const names = namesOf(token);
    const css = names.some((name) => new RegExp(`var\\(\\s*${escape(name)}\\s*[,)]`).test(html));
    const script = new RegExp(`unframed\\.token\\(\\s*(["'])(?:${[token.path, ...names].map(escape).join("|")})\\1\\s*\\)`).test(html);
    if (css || script) used.push(token.path);
  }
  return used;
};
