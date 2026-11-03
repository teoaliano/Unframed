/**
 * Component updates on screen (spec 20): the tags a page or motion pins at an older sheet than the
 * component shape on this canvas holds. The pins come from the engine's stream; the shapes are the store's.
 */
import type { Editor } from "tldraw";
import { pinsOf } from "./componentPins.ts";

/** The tags a file pins whose component shape now points at another sheet, in the file's pin order. */
export const updateTagsOf = (editor: Editor, project: string, file: string): string[] => {
  if (file === "") return [];
  const pins = pinsOf(project).get().get(file) ?? [];
  if (pins.length === 0) return [];
  const current = new Map<string, string>();
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== "component") continue;
    const props = shape.props as { tag?: unknown; file?: unknown };
    if (typeof props.tag === "string" && typeof props.file === "string") current.set(props.tag, props.file);
  }
  return pins.filter((pin) => current.has(pin.tag) && current.get(pin.tag) !== pin.sheet).map((pin) => pin.tag);
};
