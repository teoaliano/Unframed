import { gridGap } from "@unframed/domain";
import { useLayoutEffect, useRef } from "react";
import { react, useEditor, useValue } from "tldraw";

const positiveModulo = (value: number, by: number) => ((value % by) + by) % by;

/**
 * The canvas background: the canvas colour with a dot at every grid point. The component
 * re-renders on zoom only; panning moves the dots by writing the background position
 * straight to the element.
 */
export const DotGrid = () => {
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const zoom = useValue("grid zoom", () => editor.getZoomLevel(), [editor]);
  const screenGap = gridGap(zoom) * zoom;

  useLayoutEffect(
    () =>
      react("grid offset", () => {
        const { x, y, z } = editor.getCamera();
        const element = ref.current;
        if (!element) return;
        // Each dot sits in the middle of its tile, so the tiles start half a gap before a grid point.
        const left = positiveModulo(x * z - screenGap / 2, screenGap);
        const top = positiveModulo(y * z - screenGap / 2, screenGap);
        element.style.backgroundPosition = `${left}px ${top}px`;
      }),
    [editor, screenGap],
  );

  return <div ref={ref} className="tl-background unframed-dot-grid" style={{ backgroundSize: `${screenGap}px ${screenGap}px` }} />;
};
