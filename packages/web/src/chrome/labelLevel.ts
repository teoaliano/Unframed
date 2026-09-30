import { labelLevel } from "@unframed/domain";
import { react, type Editor, type TLShapeId } from "tldraw";

/**
 * Keeps the canvas container's `data-label-level` attribute on the level for the current
 * zoom. CSS reads it, so a zoom change touches one attribute and re-renders no shape.
 */
export const installLabelLevel = (editor: Editor): (() => void) =>
  react("label level", () => {
    const level = labelLevel(editor.getZoomLevel());
    const container = editor.getContainer();
    if (container.dataset.labelLevel !== level) container.dataset.labelLevel = level;
  });

/**
 * Marks the hovered and selected shapes' elements with `data-label-active`, which the
 * `hover` label level shows labels by. Written straight to the DOM, so a hover change
 * (which panning causes under a still pointer) re-renders no shape.
 */
export const installLabelActivity = (editor: Editor): (() => void) => {
  let marked = new Set<TLShapeId>();
  const element = (id: TLShapeId) => editor.getContainer().querySelector(`.tl-shape[data-shape-id="${CSS.escape(id)}"]`);
  const apply = (active: Set<TLShapeId>) => {
    for (const id of marked) if (!active.has(id)) element(id)?.removeAttribute("data-label-active");
    for (const id of active) element(id)?.setAttribute("data-label-active", "true");
    marked = active;
  };
  return react("label activity", () => {
    const active = new Set(editor.getSelectedShapeIds());
    const hovered = editor.getHoveredShapeId();
    if (hovered) active.add(hovered);
    apply(active);
    // A shape selected as it is created has no element yet; mark it once it has.
    editor.timers.requestAnimationFrame(() => apply(active));
  });
};
