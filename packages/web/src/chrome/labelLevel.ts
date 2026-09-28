import { labelLevel } from "@unframed/domain";
import { react, type Editor } from "tldraw";

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
