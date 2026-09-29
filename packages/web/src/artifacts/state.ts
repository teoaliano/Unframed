/**
 * What the canvas knows about its artifacts beyond their records (spec 09): which are pinned
 * with "Keep playing", which one is open in the editor, which ones run a live frame, the
 * preview origin's port and each shape's status line. Every fact a shape component reads is
 * a computed value keyed to that shape and answers in primitives, so panning re-renders no
 * shape.
 */
import { farOffscreen, isArtifactKind, liveArtifacts, LIVE_SELECTED_LIMIT, PIN_LIMIT } from "@unframed/domain";
import { atom, computed, type Atom, type Computed, type Editor, type TLShapeId } from "tldraw";

/** The preview origin's port, from the engine's settings. Unknown until they arrive. */
export const previewPort: Atom<number | undefined> = atom("preview port", undefined);

/** Pinned artifacts per project. Kept in memory: pinning is for the session at hand. */
const pins = new Map<string, Atom<ReadonlyArray<string>>>();

export const pinnedAtom = (project: string): Atom<ReadonlyArray<string>> => {
  let found = pins.get(project);
  if (!found) {
    found = atom(`pinned ${project}`, []);
    pins.set(project, found);
  }
  return found;
};

/** Toggles "Keep playing". Answers false, changing nothing, when three are already pinned. */
export const togglePin = (project: string, id: string): boolean => {
  const pinned = pinnedAtom(project);
  const current = pinned.get();
  if (current.includes(id)) {
    pinned.set(current.filter((known) => known !== id));
    return true;
  }
  if (current.length >= PIN_LIMIT) return false;
  pinned.set([...current, id]);
  return true;
};

interface CanvasArtifacts {
  /** The project this canvas shows, which the pins are kept under. */
  readonly project: Atom<string>;
  /** The artifact open in the editor. */
  readonly editing: Atom<TLShapeId | undefined>;
  /**
   * Set from a press on the canvas until the double-click window after it has passed, so a
   * frame never takes the second click of a double-click that selected it.
   */
  readonly hold: Atom<boolean>;
  readonly live: Computed<ReadonlySet<string>>;
  /** Upload and render errors, under their shape, until the next upload or render starts. */
  readonly problems: Atom<ReadonlyMap<string, string>>;
}

const canvases = new WeakMap<Editor, CanvasArtifacts>();

const hasFile = (editor: Editor, id: TLShapeId): boolean => {
  const shape = editor.getShape(id);
  return !!shape && isArtifactKind(shape.type) && (shape.props as { file?: string }).file !== "";
};

export const artifactsOf = (editor: Editor): CanvasArtifacts => {
  let found = canvases.get(editor);
  if (!found) {
    const editing = atom<TLShapeId | undefined>("editing artifact", undefined);
    const project = atom("artifact project", "");
    const live = computed<ReadonlySet<string>>("live artifacts", () => {
      // The editor unloads the canvas's frames: at most one artifact document runs while editing.
      if (editing.get() !== undefined) return new Set();
      const selected = editor.getSelectedShapeIds().filter((id) => hasFile(editor, id));
      const centreOf = (id: TLShapeId) => editor.getShapePageBounds(id)?.center ?? { x: 0, y: 0 };
      return liveArtifacts({
        selected: selected.map((id) => ({ id, centre: selected.length > LIVE_SELECTED_LIMIT ? centreOf(id) : { x: 0, y: 0 } })),
        pinned: pinnedAtom(project.get()).get().filter((id) => hasFile(editor, id as TLShapeId)),
        viewportCentre: selected.length > LIVE_SELECTED_LIMIT ? editor.getViewportPageBounds().center : { x: 0, y: 0 },
      });
    });
    found = { project, editing, hold: atom("frame hold", false), live, problems: atom("artifact problems", new Map()) };
    canvases.set(editor, found);
  }
  return found;
};

/** Whether this artifact runs a live frame: it is live and not more than a viewport width off screen. */
export const isLive = (editor: Editor, id: TLShapeId): boolean => {
  if (!artifactsOf(editor).live.get().has(id)) return false;
  const bounds = editor.getShapePageBounds(id);
  const viewport = editor.getViewportPageBounds();
  return !!bounds && !farOffscreen({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }, { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h });
};

/** Whether the frame takes the pointer: the shape is selected, nothing is being dragged or resized, and no click is in flight. */
export const isInteractive = (editor: Editor, id: TLShapeId): boolean =>
  editor.getSelectedShapeIds().includes(id) &&
  !artifactsOf(editor).hold.get() &&
  !editor.isInAny("select.translating", "select.resizing", "select.rotating", "select.dragging_handle", "select.pointing_shape", "select.pointing_selection", "select.pointing_resize_handle");

export const setProblem = (editor: Editor, id: string, message: string | undefined): void => {
  artifactsOf(editor).problems.update((current) => {
    const next = new Map(current);
    if (message === undefined) next.delete(id);
    else next.set(id, message);
    return next;
  });
};

/** How long after a press a frame stays out of the pointer's way: past a double-click. */
const HOLD_MS = 500;

/** Holds every frame off the pointer from a press until the double-click window after it has passed. */
export const installFrameHold = (editor: Editor): (() => void) => {
  const { hold } = artifactsOf(editor);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onEvent = (info: { type: string; name: string }) => {
    if (info.type !== "pointer") return;
    if (info.name === "pointer_down") {
      clearTimeout(timer);
      if (!hold.get()) hold.set(true);
    } else if (info.name === "pointer_up") {
      clearTimeout(timer);
      timer = setTimeout(() => hold.set(false), HOLD_MS);
    }
  };
  editor.on("event", onEvent);
  return () => {
    clearTimeout(timer);
    editor.off("event", onEvent);
  };
};
