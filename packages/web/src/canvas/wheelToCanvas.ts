import { useEffect } from "react";
import type { Editor } from "tldraw";

/** A wheel over a floating bar or the composer moves the canvas, unless it is over something that scrolls itself. */
export const useWheelToCanvas = (editor: Editor, root: React.RefObject<HTMLDivElement | null>) => {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      for (let node = event.target as HTMLElement | null; node && node !== element; node = node.parentElement) {
        if (node.dataset.scrolls === "true" && node.scrollHeight > node.clientHeight) return;
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
  }, [editor, root]);
};
