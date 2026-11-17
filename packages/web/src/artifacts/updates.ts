import type { DocShape } from "../canvas/doc.ts";
import { pinsOf } from "./componentPins.ts";

export const updateTagsOf = (shapes: ReadonlyArray<DocShape>, project: string, file: string): string[] => {
  if (file === "") return [];
  const pins = pinsOf(project).get().get(file) ?? [];
  if (pins.length === 0) return [];
  const current = new Map<string, string>();
  for (const shape of shapes) {
    if (shape.type !== "component") continue;
    const props = shape.props as { tag?: unknown; file?: unknown };
    if (typeof props.tag === "string" && typeof props.file === "string") current.set(props.tag, props.file);
  }
  return pins.filter((pin) => current.has(pin.tag) && current.get(pin.tag) !== pin.sheet).map((pin) => pin.tag);
};
