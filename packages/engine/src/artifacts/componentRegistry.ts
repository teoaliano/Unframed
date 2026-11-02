/**
 * The pins of a page or motion, written by the engine (spec 20): the project's component registry
 * read from the canvas and from the sheets the document pins, then `injectPins`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { injectPins, readComponentSheet, readPins, shapeKind, type ComponentRegistry, type PinInjection } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";

/** The registry for one document: the current sheet of each component shape, and every sheet the document pins, read for its tag. */
export const componentRegistry = async (folder: string, records: ReadonlyArray<TLRecord>, html: string): Promise<ComponentRegistry> => {
  const current = new Map<string, string>();
  for (const record of records) {
    if (record.typeName !== "shape" || shapeKind((record as { type: string }).type) !== "component") continue;
    const props = (record as unknown as { props: Record<string, unknown> }).props;
    if (typeof props.tag === "string" && typeof props.file === "string" && props.file !== "") current.set(props.tag, props.file);
  }
  const sheets = new Map<string, string>([...current].map(([tag, file]) => [file, tag] as const));
  for (const pin of readPins(html)) {
    if (sheets.has(pin.sheet)) continue;
    const text = await readFile(join(folder, pin.sheet), "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const read = readComponentSheet(text);
    if (read.ok) sheets.set(pin.sheet, read.sheet.declaration.tag);
  }
  return { current, sheets };
};

/** Injects the pins a page or motion needs for the components on its canvas. */
export const pinComponents = async (folder: string, records: ReadonlyArray<TLRecord>, html: string): Promise<PinInjection> =>
  injectPins(html, await componentRegistry(folder, records, html));
