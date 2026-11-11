import { farOffscreen, isArtifactKind, liveArtifacts, LIVE_SELECTED_LIMIT, PIN_LIMIT, type DialsAnnouncement } from "@unframed/domain";
import type { RenderStatus } from "@unframed/contracts";
import { atom, computed, react, type Atom, type Computed, type Editor, type TLShapeId } from "tldraw";
import { isDeviceClient } from "../deviceMode.ts";

export const previewPort: Atom<number | undefined> = atom("preview port", undefined);

const pins = new Map<string, Atom<ReadonlyArray<string>>>();

export const pinnedAtom = (project: string): Atom<ReadonlyArray<string>> => {
  let found = pins.get(project);
  if (!found) {
    found = atom(`pinned ${project}`, []);
    pins.set(project, found);
  }
  return found;
};

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
  readonly project: Atom<string>;
  readonly editing: Atom<TLShapeId | undefined>;
  readonly tuning: Atom<TLShapeId | undefined>;
  readonly updatesOpen: Atom<TLShapeId | undefined>;
  readonly heard: Atom<ReadonlyMap<string, DialsAnnouncement>>;
  readonly posts: Map<string, (values: unknown) => void>;
  readonly hold: Atom<boolean>;
  readonly live: Computed<ReadonlySet<string>>;
  readonly problems: Atom<ReadonlyMap<string, string>>;
  readonly renders: Atom<ReadonlyMap<string, { readonly starting: boolean; readonly status?: RenderStatus }>>;
  readonly editPosts: Map<string, (message: unknown) => void>;
  readonly dropHit: Atom<DropHit | undefined>;
  readonly dropHolds: Atom<ReadonlySet<string>>;
}

export interface DropHit {
  readonly shapeId: string;
  readonly elementId: string;
  readonly target: "src" | "background";
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
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
    const tuning = atom<TLShapeId | undefined>("tuning artifact", undefined);
    const updatesOpen = atom<TLShapeId | undefined>("component updates open", undefined);
    const project = atom("artifact project", "");
    const dropHolds = atom<ReadonlySet<string>>("image drop holds", new Set());
    const live = computed<ReadonlySet<string>>("live artifacts", () => {
      if (editing.get() !== undefined) return new Set();
      const selected = editor.getSelectedShapeIds().filter((id) => hasFile(editor, id));
      const centreOf = (id: TLShapeId) => editor.getShapePageBounds(id)?.center ?? { x: 0, y: 0 };
      const found = liveArtifacts({
        selected: selected.map((id) => ({ id, centre: selected.length > LIVE_SELECTED_LIMIT ? centreOf(id) : { x: 0, y: 0 } })),
        pinned: pinnedAtom(project.get()).get().filter((id) => hasFile(editor, id as TLShapeId)),
        tuning: tuning.get(),
        viewportCentre: selected.length > LIVE_SELECTED_LIMIT ? editor.getViewportPageBounds().center : { x: 0, y: 0 },
      });
      for (const id of dropHolds.get()) if (hasFile(editor, id as TLShapeId)) found.add(id);
      return found;
    });
    found = {
      project,
      editing,
      tuning,
      updatesOpen,
      heard: atom("artifact announcements", new Map()),
      posts: new Map(),
      hold: atom("frame hold", false),
      live,
      problems: atom("artifact problems", new Map()),
      renders: atom("motion renders", new Map()),
      editPosts: new Map(),
      dropHit: atom<DropHit | undefined>("image drop hit", undefined),
      dropHolds,
    };
    canvases.set(editor, found);
  }
  return found;
};

export const isLive = (editor: Editor, id: TLShapeId): boolean => {
  if (isDeviceClient()) return false;
  const state = artifactsOf(editor);
  if (!state.live.get().has(id)) return false;
  if (state.tuning.get() === id) return true;
  const bounds = editor.getShapePageBounds(id);
  const viewport = editor.getViewportPageBounds();
  return !!bounds && !farOffscreen({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }, { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h });
};

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

const HOLD_MS = 500;

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

export const reachEdit = (editor: Editor, id: string, post: (message: unknown) => void): void => {
  artifactsOf(editor).editPosts.set(id, post);
};

export const forgetEdit = (editor: Editor, id: string): void => {
  const state = artifactsOf(editor);
  state.editPosts.delete(id);
  if (state.dropHit.get()?.shapeId === id) state.dropHit.set(undefined);
};

export const hearFrame = (editor: Editor, id: string, announcement: DialsAnnouncement): void => {
  artifactsOf(editor).heard.update((current) => new Map(current).set(id, announcement));
};

export const reachFrame = (editor: Editor, id: string, post: (values: unknown) => void): void => {
  artifactsOf(editor).posts.set(id, post);
};

export const forgetFrame = (editor: Editor, id: string): void => {
  const state = artifactsOf(editor);
  state.posts.delete(id);
  if (!state.heard.get().has(id)) return;
  state.heard.update((current) => {
    const next = new Map(current);
    next.delete(id);
    return next;
  });
};

export const toggleTuning = (editor: Editor, id: TLShapeId): void => {
  const { tuning } = artifactsOf(editor);
  tuning.set(tuning.get() === id ? undefined : id);
};

export const installTuningWatch = (editor: Editor): (() => void) => {
  const { tuning, editing } = artifactsOf(editor);
  const stop = react("tuning follows the selection", () => {
    const id = tuning.get();
    if (id === undefined) return;
    const selected = editor.getSelectedShapeIds();
    if (editing.get() !== undefined || selected.length !== 1 || selected[0] !== id || !hasFile(editor, id)) tuning.set(undefined);
  });
  return () => {
    stop();
    tuning.set(undefined);
  };
};
