import { emptyTiers, pictureLevel, reduceTiers, tierOf, type PictureLevel, type ScreenTier, type TierEntry, type TierEvent, type TierState, type ViewScreen } from "@unframed/domain";
import type { ScreenShapeProps } from "@unframed/contracts";
import { atom, react, unsafe__withoutCapture, type Atom, type Editor, type TLShapeId } from "tldraw";
import { setTierCounts } from "../fps/screens.ts";
import { pictureKeyOf } from "./ScreenPicture.tsx";
import { repositoryState } from "./store.ts";

const NEAR_MARGIN = 0.5;

const stores = new Map<string, Atom<TierState>>();

export const tiersOf = (project: string): Atom<TierState> => {
  let found = stores.get(project);
  if (found === undefined) {
    found = atom(`screen tiers ${project}`, emptyTiers());
    stores.set(project, found);
  }
  return found;
};

export const dispatchTier = (project: string, event: TierEvent): void => {
  const store = tiersOf(project);
  const next = reduceTiers(store.get(), event);
  if (next !== store.get()) store.set(next);
};

export const tierEntry = (project: string, id: string): TierEntry | undefined => tiersOf(project).get().entries.get(id);

export const forgetTiers = (project: string): void => {
  stores.get(project)?.set(emptyTiers());
};

export const holdScreen = (project: string, id: string): (() => void) => {
  dispatchTier(project, { type: "hold", id });
  return () => {
    if (tiersOf(project).get().held === id) dispatchTier(project, { type: "hold", id: undefined });
  };
};

export const watchTierVisibility = (project: string): (() => void) => {
  const onVisibility = () => dispatchTier(project, { type: "hidden", hidden: document.visibilityState === "hidden" });
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
};

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

const placed = new Map<string, Atom<boolean>>();

const placedOf = (project: string): Atom<boolean> => {
  let found = placed.get(project);
  if (found === undefined) {
    found = atom(`screen camera placed ${project}`, false);
    placed.set(project, found);
  }
  return found;
};

export const screenLevel = (editor: Editor, project: string, id: string, w: number): PictureLevel | undefined => {
  const entry = tierEntry(project, id);
  if (entry !== undefined) return entry.level;
  if (!placedOf(project).get()) return undefined;
  return unsafe__withoutCapture(() => pictureLevel(w * editor.getZoomLevel(), pixelRatio.get()));
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
    const props = shape.props as ScreenShapeProps;
    screens.push({ id: shape.id, width: props.w * zoom, dpr, near, pictured: pictureKeyOf(props) !== undefined, distance: Math.round(Math.hypot(bounds.midX - viewport.midX, bounds.midY - viewport.midY)) });
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
  placedOf(project).set(true);
  stops.push(react("screen camera", () => dispatchTier(project, { type: "camera", moving: editor.getCameraState() === "moving" })));
  stops.push(
    react("screen view", () => {
      if (editor.getCameraState() === "moving") return;
      dispatchTier(project, { type: "view", screens: screenView(editor) });
    }),
  );
  stops.push(react("screen tier counts", () => countTiers(tiersOf(project).get())));
  if (options.live) {
    stops.push(
      react("screen activation", () => {
        const ids = editor.getSelectedShapeIds();
        const only = ids.length === 1 ? editor.getShape(ids[0]!) : undefined;
        if (only?.type === "screen") dispatchTier(project, { type: "activate", id: only.id });
        else dispatchTier(project, { type: "deactivate" });
      }),
    );
    const changes = new Map<string, number>();
    stops.push(
      react("screen edits", () => {
        for (const instance of repositoryState(project).instances.get().values()) {
          const before = changes.get(instance.id);
          changes.set(instance.id, instance.changes);
          if (before === undefined || before === instance.changes) continue;
          const id = nearestOf(editor, tiersOf(project).__unsafe__getWithoutCapture(), instance.id);
          if (id !== undefined) dispatchTier(project, { type: "edited", id });
        }
      }),
    );
  }
  return () => {
    for (const stop of stops) stop();
    placedOf(project).set(false);
    dispatchTier(project, { type: "camera", moving: false });
  };
};
