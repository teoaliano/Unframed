/**
 * The window's share of the live selection (spec 14, "The live selection"): it reports its
 * selection of this project to the engine when it changes, and selects what the engine asks.
 */
import type { Editor, TLShapeId } from "tldraw";
import { roomShapeId } from "@unframed/domain";
import type { EngineConnection } from "../rpc/engine.ts";

/** Reports wait this long after the last change, so a drag reports once. */
const REPORT_DEBOUNCE_MS = 150;

/** One id per window in this page's life: the engine keeps a report per window. */
const windowId = crypto.randomUUID();

export const installSelectionReporter = (editor: Editor, engine: EngineConnection, project: string): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: string | undefined;
  const report = (force = false) => {
    // Room ids, as the canvas holds them: the engine reads the selection against the room.
    const shapeIds: string[] = editor.getSelectedShapeIds().map((id) => String(id));
    const reported = shapeIds.join(" ");
    if (!force && reported === last) return;
    last = reported;
    void engine.call("selection.report", { project, windowId, shapeIds }).catch(() => undefined);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(report, REPORT_DEBOUNCE_MS);
  };
  const stopListening = editor.store.listen(schedule);
  const stopStream = engine.subscribe("selection.subscribe", { project, windowId }, (apply) => {
    const present = apply.shapeIds.map((id) => roomShapeId(id) as TLShapeId).filter((id) => editor.getShape(id) !== undefined);
    editor.setSelectedShapes(present);
    clearTimeout(timer);
    report(true);
  });
  const stopState = engine.onStateChange((state) => {
    if (state === "open") report(true);
  });
  report(true);
  return () => {
    clearTimeout(timer);
    stopState();
    stopListening();
    stopStream();
  };
};
