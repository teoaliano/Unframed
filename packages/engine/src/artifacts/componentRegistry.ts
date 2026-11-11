import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { injectPins, readComponentSheet, readPins, shapeKind, type ComponentDeclaration, type ComponentRegistry, type PinInjection } from "@unframed/domain";
import type { InstanceDeclarations } from "@unframed/domain/html";
import type { TLRecord } from "@tldraw/tlschema";

export const sheetDeclaration = async (folder: string, sheet: string): Promise<ComponentDeclaration | undefined> => {
  const text = await readFile(join(folder, basename(sheet)), "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  const read = readComponentSheet(text);
  return read.ok ? read.sheet.declaration : undefined;
};

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
    const declaration = await sheetDeclaration(folder, pin.sheet);
    if (declaration !== undefined) sheets.set(pin.sheet, declaration.tag);
  }
  return { current, sheets };
};

export const pinComponents = async (folder: string, records: ReadonlyArray<TLRecord>, html: string): Promise<PinInjection> =>
  injectPins(html, await componentRegistry(folder, records, html));

export const instanceDeclarations = async (folder: string, records: ReadonlyArray<TLRecord>, html: string): Promise<InstanceDeclarations> => {
  const found = new Map<string, { title: string; declaration: ComponentDeclaration }>();
  for (const pin of readPins(html)) {
    if (found.has(pin.tag)) continue;
    const declaration = await sheetDeclaration(folder, pin.sheet);
    if (declaration === undefined) continue;
    const shape = records.find((record) => {
      const props = (record as unknown as { props?: Record<string, unknown> }).props;
      return record.typeName === "shape" && shapeKind((record as { type: string }).type) === "component" && props?.tag === pin.tag;
    });
    const title = (shape as unknown as { props: { title?: unknown } } | undefined)?.props.title;
    found.set(pin.tag, { title: typeof title === "string" && title !== "" ? title : pin.tag, declaration });
  }
  return found;
};
