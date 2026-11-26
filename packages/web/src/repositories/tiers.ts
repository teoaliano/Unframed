import { emptyTiers, reduceTiers, tierOf, type ScreenTier, type TierEntry, type TierEvent, type TierState, type ViewScreen } from "@unframed/domain";
import type { ScreenShapeProps } from "@unframed/contracts";
import { atom, react, type Atom, type Editor, type TLShapeId } from "tldraw";
import { setTierCounts } from "../fps/screens.ts";
import { repositoryState } from "./store.ts";

const NEAR_MARGIN = 0.5;

const stores = new WeakMap<Editor, Atom<TierState>>();

export const tiersOf = (editor: Editor): Atom<TierState> => {
  let found = stores.get(editor);
  if (found === undefined) {
    found = atom("screen tiers", emptyTiers());
    stores.set(editor, found);
  }
  return found;
};

export const dispatchTier = (editor: Editor, event: TierEvent): void => {
  const store = tiersOf(editor);
  const next = reduceTiers(store.get(), event);
  if (next !== store.get()) store.set(next);
};

export const tierEntry = (editor: Editor, id: TLShapeId): TierEntry | undefined => tiersOf(editor).get().entries.get(id);

const pixelRatio = atom("device pixel ratio", typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

const watchPixelRatio = (): (() => void) => {
  let query: MediaQueryList | undefined;
  const listen = () => {
    query?.removeEventListener("change", changed);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query.addEventListener("change", changed);
  };
  const changed = () => {
    pixelRatio.set(window.devicePixelRatio || 1);
    listen();
  };
  listen();
  return () => query?.removeEventListener("change", changed);
};

export const screenView = (editor: Editor): ViewScreen[] => {
  const viewport = editor.getViewportPageBounds();
  const zoom = editor.getZoomLevel();
  const dpr = pixelRatio.get();
  const padX = viewport.w * NEAR_MARGIN;
  const padY = viewport.h * NEAR_MARGIN;
  const screens: ViewScreen[] = [];
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== "screen") continue;
    const bounds = editor.getShapePageBounds(shape.id);
    if (bounds === undefined) continue;
    const near = bounds.maxX >= viewport.minX - padX && bounds.minX <= viewport.maxX + padX && bounds.maxY >= viewport.minY - padY && bounds.minY <= viewport.maxY + padY;
    screens.push({ id: shape.id, width: (shape.props as ScreenShapeProps).w * zoom, dpr, near, distance: Math.round(Math.hypot(bounds.midX - viewport.midX, bounds.midY - viewport.midY)) });
  }
  return screens;
};

const countTiers = (state: TierState) => {
  const counts: Record<ScreenTier, number> = { live: 0, warming: 0, parked: 0, snapshot: 0, picture: 0 };
  for (const entry of state.entries.values()) counts[tierOf(entry)]++;
  setTierCounts(counts);
};

const nearestOf = (editor: Editor, state: TierState, instance: string): string | undefined => {
  let best: { id: string; distance: number } | undefined;
  for (const [id, entry] of state.entries) {
    if (!entry.near) continue;
    const shape = editor.getShape(id as TLShapeId);
    if (shape?.type !== "screen" || (shape.props as ScreenShapeProps).instance !== instance) continue;
    if (best === undefined || entry.distance < best.distance) best = { id, distance: entry.distance };
  }
  return best?.id;
};

export const installScreenTiers = (editor: Editor, project: string, options: { readonly live: boolean }): (() => void) => {
  const stops: Array<() => void> = [watchPixelRatio()];
  stops.push(react("screen camera", () => dispatchTier(editor, { type: "camera", moving: editor.getCameraState() === "moving" })));
  stops.push(
    react("screen view", () => {
      if (editor.getCameraState() === "moving") return;
      dispatchTier(editor, { type: "view", screens: screenView(editor) });
    }),
  );
  stops.push(react("screen tier counts", () => countTiers(tiersOf(editor).get())));
  if (options.live) {
    stops.push(
      react("screen activation", () => {
        const ids = editor.getSelectedShapeIds();
        const only = ids.length === 1 ? editor.getShape(ids[0]!) : undefined;
        if (only?.type === "screen") dispatchTier(editor, { type: "activate", id: only.id });
        else dispatchTier(editor, { type: "deactivate" });
      }),
    );
    const changes = new Map<string, number>();
    stops.push(
      react("screen edits", () => {
        for (const instance of repositoryState(project).instances.get().values()) {
          const before = changes.get(instance.id);
          changes.set(instance.id, instance.changes);
          if (before === undefined || before === instance.changes) continue;
          const id = nearestOf(editor, tiersOf(editor).__unsafe__getWithoutCapture(), instance.id);
          if (id !== undefined) dispatchTier(editor, { type: "edited", id });
        }
      }),
    );
    const onVisibility = () => dispatchTier(editor, { type: "hidden", hidden: document.visibilityState === "hidden" });
    document.addEventListener("visibilitychange", onVisibility);
    stops.push(() => document.removeEventListener("visibilitychange", onVisibility));
  }
  return () => {
    for (const stop of stops) stop();
    tiersOf(editor).set(emptyTiers());
  };
};
