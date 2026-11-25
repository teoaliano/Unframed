import { useEffect } from "react";
import type { Editor } from "tldraw";

/** A wheel over a floating bar or the composer moves the canvas, unless it is over something that scrolls itself. */
export const useWheelToCanvas = (editor: Editor, root: React.RefObject<HTMLElement | null>) => {
  useEffect(() => wheelToCanvas(editor, root.current), [editor, root]);
};

export const useWheelToCanvasOn = (editor: Editor, element: HTMLElement | null) => {
  useEffect(() => wheelToCanvas(editor, element), [editor, element]);
};

const scrollsItself = (node: HTMLElement): boolean => {
  if (node.scrollHeight <= node.clientHeight) return false;
  if (node.dataset.scrolls === "true") return true;
  const overflow = getComputedStyle(node).overflowY;
  return overflow === "auto" || overflow === "scroll";
};

const wheelToCanvas = (editor: Editor, element: HTMLElement | null): (() => void) | undefined => {
  if (!element) return;
  const onWheel = (event: WheelEvent) => {
    for (let node = event.target as HTMLElement | null; node && node !== element; node = node.parentElement) {
      if (scrollsItself(node)) return;
    }
    event.preventDefault();
    event.stopPropagation();
    const canvas = editor.getContainer().querySelector(".tl-canvas");
    canvas?.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      }),
    );
  };
  element.addEventListener("wheel", onWheel, { passive: false });
  return () => element.removeEventListener("wheel", onWheel);
};
