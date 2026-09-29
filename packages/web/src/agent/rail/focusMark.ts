import { roomShapeId } from "@unframed/domain";
import { useEffect } from "react";
import { react, type Editor } from "tldraw";

/**
 * The active chat's artifacts wear the focus mark: `data-agent-focus` on their shape
 * elements, which CSS turns into a filled label with a live dot. Written straight to the
 * DOM, as the label activity is, so it re-renders no shape.
 */
export const useFocusMark = (editor: Editor | null, tags: ReadonlyArray<string> | undefined) => {
  const key = (tags ?? []).join(" ");
  useEffect(() => {
    if (!editor || key === "") return;
    const ids = key.split(" ").map(roomShapeId);
    let marked: Element[] = [];
    const apply = () => {
      const now = ids.filter((id) => editor.getShape(id as never) !== undefined).flatMap((id) => [...editor.getContainer().querySelectorAll(`.tl-shape[data-shape-id="${CSS.escape(id)}"]`)]);
      for (const element of marked) if (!now.includes(element)) element.removeAttribute("data-agent-focus");
      for (const element of now) element.setAttribute("data-agent-focus", "");
      marked = now;
    };
    const stop = react("agent focus mark", () => {
      for (const id of ids) editor.getShape(id as never);
      apply();
      // A shape that lands with the chat has no element yet; mark it once it has.
      editor.timers.requestAnimationFrame(apply);
    });
    return () => {
      stop();
      for (const element of marked) element.removeAttribute("data-agent-focus");
    };
  }, [editor, key]);
};
