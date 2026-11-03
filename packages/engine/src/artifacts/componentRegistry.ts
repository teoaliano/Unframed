/**
 * The pins of a page or motion, written by the engine (spec 20): the project's component registry
 * read from the canvas and from the sheets the document pins, then `injectPins`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { injectPins, readComponentSheet, readPins, shapeKind, type ComponentDeclaration, type ComponentRegistry, type PinInjection } from "@unframed/domain";
import type { InstanceDeclarations } from "@unframed/domain/html";
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

/** The pinned declaration of each instance a document holds, by tag, with the title of its component on the canvas (spec 20). */
export const instanceDeclarations = async (folder: string, records: ReadonlyArray<TLRecord>, html: string): Promise<InstanceDeclarations> => {
  const found = new Map<string, { title: string; declaration: ComponentDeclaration }>();
  for (const pin of readPins(html)) {
    if (found.has(pin.tag)) continue;
    const text = await readFile(join(folder, pin.sheet), "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const read = readComponentSheet(text);
    if (!read.ok) continue;
    const shape = records.find((record) => {
      const props = (record as unknown as { props?: Record<string, unknown> }).props;
      return record.typeName === "shape" && shapeKind((record as { type: string }).type) === "component" && props?.tag === pin.tag;
    });
    const title = (shape as unknown as { props: { title?: unknown } } | undefined)?.props.title;
    found.set(pin.tag, { title: typeof title === "string" && title !== "" ? title : pin.tag, declaration: read.sheet.declaration });
  }
  return found;
};
