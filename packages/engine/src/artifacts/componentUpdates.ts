/**
 * `component.updates` (spec 20): the components a page or motion pins an older version of, one row
 * each, with the sentences of what the newer version changes for the instances in the artifact.
 */
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ComponentUpdate } from "@unframed/contracts";
import type { TLRecord } from "@tldraw/tlschema";
import { readComponentSheet, readPins, shapeKind, updateImpact, type ComponentDeclaration } from "@unframed/domain";
import { instanceUses } from "@unframed/domain/html";

const declarationOf = async (folder: string, sheet: string): Promise<ComponentDeclaration | undefined> => {
  const text = await readFile(join(folder, basename(sheet)), "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  const read = readComponentSheet(text);
  return read.ok ? read.sheet.declaration : undefined;
};

/** The updates of the artifact file `file`, against the components on the canvas. */
export const componentUpdatesOf = async (folder: string, records: ReadonlyArray<TLRecord>, file: string): Promise<ComponentUpdate[]> => {
  const html = await readFile(join(folder, basename(file)), "utf8").catch(() => undefined);
  if (html === undefined) return [];
  const current = new Map<string, { file: string; title: string }>();
  for (const record of records) {
    const shape = record as unknown as { typeName: string; type: string; props: Record<string, unknown> };
    if (shape.typeName !== "shape" || shapeKind(shape.type) !== "component") continue;
    if (typeof shape.props.tag === "string" && typeof shape.props.file === "string" && shape.props.file !== "") {
      current.set(shape.props.tag, { file: shape.props.file, title: typeof shape.props.title === "string" ? shape.props.title : "" });
    }
  }
  const updates: ComponentUpdate[] = [];
  const seen = new Set<string>();
  for (const pin of readPins(html)) {
    if (seen.has(pin.tag)) continue;
    seen.add(pin.tag);
    const now = current.get(pin.tag);
    if (now === undefined || now.file === pin.sheet) continue;
    const from = await declarationOf(folder, pin.sheet);
    const to = await declarationOf(folder, now.file);
    if (from === undefined || to === undefined) continue;
    const title = now.title === "" ? pin.tag : now.title;
    updates.push({ tag: pin.tag, title, from: pin.sheet, to: now.file, warnings: updateImpact(from, to, instanceUses(html, pin.tag, from), title) });
  }
  return updates;
};
