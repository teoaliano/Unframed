import { useLayoutEffect, useRef, useState } from "react";
import { GeoShapeGeoStyle, useEditor, useValue, type Editor } from "tldraw";
import { useWheelToCanvas } from "./wheelToCanvas.ts";
import { useDesignPanelOpen } from "./designPanelPref.ts";
import { toolTarget, toolType, useDesignTarget } from "./designTarget.ts";
import { StyleControls, useOpenPopupEscape } from "./StyleRow.tsx";

const toolButtonOf = (editor: Editor): HTMLElement | null => {
  const tool = editor.getCurrentToolId();
  const name = tool === "geo" ? String(editor.getStyleForNextShape(GeoShapeGeoStyle)) : tool;
  return editor.getContainer().querySelector<HTMLElement>(`[data-testid="bottom-toolbar"] [data-testid="tools.${name}"]`);
};

const GAP = 8;
const EDGE = 8;

export const ToolTray = () => {
  const editor = useEditor();
  const [panelOpen] = useDesignPanelOpen();
  const tool = useValue("tray tool", () => (toolType(editor) === undefined ? undefined : `${editor.getCurrentToolId()}:${String(editor.getStyleForNextShape(GeoShapeGeoStyle))}`), [editor]);
  return tool === undefined || panelOpen ? null : <Tray key={tool} />;
};

const Tray = () => {
  const editor = useEditor();
  const target = useDesignTarget(editor, toolTarget);
  const root = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number }>();
  useWheelToCanvas(editor, root);
  useOpenPopupEscape(root);

  useLayoutEffect(() => {
    const measure = () => {
      const tray = root.current;
      const button = toolButtonOf(editor);
      const container = editor.getContainer().getBoundingClientRect();
      if (tray !== null && button !== null) {
        const anchor = button.getBoundingClientRect();
        const centre = anchor.left + anchor.width / 2 - container.left;
        const left = Math.min(Math.max(EDGE, centre - tray.offsetWidth / 2), container.width - tray.offsetWidth - EDGE);
        const top = Math.max(EDGE, anchor.top - container.top - GAP - tray.offsetHeight);
        setPlace((previous) => (previous?.left === left && previous.top === top ? previous : { left, top }));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    const bar = editor.getContainer().querySelector<HTMLElement>('[data-testid="bottom-toolbar"]');
    if (bar !== null) observer.observe(bar);
    if (root.current !== null) observer.observe(root.current);
    observer.observe(editor.getContainer());
    return () => observer.disconnect();
  }, [editor]);

  if (target.subjects.length === 0) return null;
  return (
    <div
      ref={root}
      role="group"
      aria-label="Next shape style"
      data-unframed-tool-tray=""
      data-testid="tool-tray"
      className="pointer-events-auto absolute z-[500] flex items-center gap-0.5 rounded-xl border p-1 font-sans text-foreground shadow-lg/5 surface-glass"
      style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place === undefined ? "hidden" : "visible" }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <StyleControls target={target} />
    </div>
  );
};
