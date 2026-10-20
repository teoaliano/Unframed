/** The markdown window on the canvas, loaded the first time a style opens. */
import { lazy, Suspense, useCallback } from "react";
import { useEditor, useValue } from "tldraw";
import { styleWindow } from "./state.ts";

const StyleWindow = lazy(() => import("./StyleWindow.tsx").then((module) => ({ default: module.StyleWindow })));

export const StylesHost = () => {
  const editor = useEditor();
  const open = useValue("style window", () => styleWindow(editor).get(), [editor]);
  const close = useCallback(() => styleWindow(editor).set(undefined), [editor]);
  if (open === undefined) return null;
  return (
    <Suspense fallback={null}>
      <StyleWindow key={open} shapeId={open} onClose={close} />
    </Suspense>
  );
};
