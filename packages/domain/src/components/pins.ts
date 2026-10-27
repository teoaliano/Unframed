/**
 * Pins (spec 20): the `<script src>` tag an artifact uses for one component tag. `readPins`
 * reads them from a document's source; pins are never stored on shapes.
 */
import { compiledFileName } from "./compile.ts";

export type Pin = { readonly tag: string; readonly sheet: string };

const PIN_TAG = /<script\b[^>]*>/gi;
const ATTRIBUTE_VALUE = (name: string) => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i");
const COMPILED_SRC = /^[A-Za-z0-9][A-Za-z0-9._-]*\.component\.js$/;

/** Every pin in a document, in source order: the tag it serves and the sheet file of its compiled src. */
export const readPins = (html: string): Pin[] => {
  const pins: Pin[] = [];
  for (const match of html.matchAll(PIN_TAG)) {
    const tag = ATTRIBUTE_VALUE("data-uf-component").exec(match[0])?.[1];
    const src = ATTRIBUTE_VALUE("src").exec(match[0])?.[1];
    if (tag === undefined || src === undefined || !COMPILED_SRC.test(src)) continue;
    pins.push({ tag, sheet: src.replace(/\.component\.js$/, ".html") });
  }
  return pins;
};

/** The compiled file a pin of this sheet names. */
export const pinnedCompiledFile = (pin: Pin): string => compiledFileName(pin.sheet);
