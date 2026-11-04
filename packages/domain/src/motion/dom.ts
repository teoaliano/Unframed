import { parseHTML } from "linkedom";

export const linkedomDocument = (html: string): unknown => (parseHTML(html) as unknown as { document: unknown }).document;

export const inlineScripts = (html: string): { textContent: string }[] =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]!))
    .map((match) => ({ textContent: match[2]! }));
