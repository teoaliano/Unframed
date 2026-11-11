import { isSheetFileName } from "@unframed/contracts";
import { TOKENS_TAG } from "../artifacts/artifactRules.ts";
import { compiledFileName } from "./compile.ts";

export type Pin = { readonly tag: string; readonly sheet: string };

export type ComponentRegistry = {
  readonly current: ReadonlyMap<string, string>;
  readonly sheets: ReadonlyMap<string, string>;
};

export type PinInjection = {
  readonly html: string;
  readonly pinned: string[];
  readonly olderVersions: string[];
  readonly unknownTags: string[];
};

const PIN_TAG = /<script\b[^>]*>/gi;
const PIN_ELEMENT = /<script\b[^>]*\bdata-uf-component\s*=[^>]*>(?:\s*<\/script\s*>)?/gi;
const ATTRIBUTE_VALUE = (name: string) => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i");
const COMPILED_SRC = /^[A-Za-z0-9][A-Za-z0-9._-]*\.component\.js$/;

const USED_TAG = /<(uf-[a-z][a-z0-9-]*)[\s/>]/gi;

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

export const pinnedCompiledFile = (pin: Pin): string => compiledFileName(pin.sheet);

const pinTag = (tag: string, sheet: string): string => {
  if (!isSheetFileName(sheet)) throw new Error(`${sheet} is not a sheet file name`);
  return `<script src="${compiledFileName(sheet)}" data-uf-component="${tag}"></script>`;
};

const usedTags = (html: string): string[] => [...new Set([...html.matchAll(USED_TAG)].map((match) => match[1]!.toLowerCase()))];

const insertAt = (html: string, block: string): string => {
  if (html.includes(TOKENS_TAG)) {
    const end = html.indexOf(TOKENS_TAG) + TOKENS_TAG.length;
    return `${html.slice(0, end)}\n${block}${html.slice(end)}`;
  }
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) {
    const end = head.index + head[0].length;
    return `${html.slice(0, end)}\n${block}${html.slice(end)}`;
  }
  return `${block}\n${html}`;
};

const pinSheet = (element: string): { tag: string | undefined; src: string | undefined } => ({
  tag: ATTRIBUTE_VALUE("data-uf-component").exec(element)?.[1],
  src: ATTRIBUTE_VALUE("src").exec(element)?.[1],
});

export const injectPins = (html: string, registry: ComponentRegistry): PinInjection => {
  const current = new Map([...registry.current].filter(([, sheet]) => isSheetFileName(sheet)));
  const used = usedTags(html);
  const unknownTags = used.filter((tag) => !current.has(tag));
  const isValid = (element: string, tag: string) => {
    const { tag: pinnedTag, src } = pinSheet(element);
    return pinnedTag === tag && src !== undefined && COMPILED_SRC.test(src) && registry.sheets.get(src.replace(/\.component\.js$/, ".html")) === tag;
  };

  let out = html;
  const missing: string[] = [];
  for (const tag of used) {
    const sheet = current.get(tag);
    if (sheet === undefined) continue;
    const elements = [...out.matchAll(PIN_ELEMENT)].filter((match) => pinSheet(match[0]).tag === tag);
    if (elements.length === 0) {
      missing.push(tag);
      continue;
    }
    if (elements.some((match) => isValid(match[0], tag))) continue;
    const first = elements[0]!;
    out = `${out.slice(0, first.index)}${pinTag(tag, sheet)}${out.slice(first.index + first[0].length)}`;
  }
  if (missing.length > 0) {
    const block = missing.sort().map((tag) => pinTag(tag, current.get(tag)!)).join("\n");
    out = insertAt(out, block);
  }

  const pinned: string[] = [];
  const olderVersions: string[] = [];
  for (const pin of readPins(out)) {
    if (!used.includes(pin.tag) || !current.has(pin.tag) || pinned.includes(pin.tag)) continue;
    pinned.push(pin.tag);
    if (current.get(pin.tag) !== pin.sheet) olderVersions.push(pin.tag);
  }
  return { html: out, pinned, olderVersions, unknownTags };
};

export const setPin = (html: string, tag: string, sheet: string): string => {
  const elements = [...html.matchAll(PIN_ELEMENT)].filter((match) => pinSheet(match[0]).tag === tag);
  if (elements.length === 0) return insertAt(html, pinTag(tag, sheet));
  let out = html;
  for (const match of [...elements].reverse()) {
    const replacement = match === elements[0] ? pinTag(tag, sheet) : "";
    out = `${out.slice(0, match.index)}${replacement}${out.slice(match.index + match[0].length)}`;
  }
  return out;
};
