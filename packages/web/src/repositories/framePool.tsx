import type { ScreenShapeProps } from "@unframed/contracts";
import type { ScreenLoadRank } from "@unframed/domain";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { atom, useValue, type Atom } from "tldraw";
import type { StoreOwner } from "../canvas/doc.ts";
import { CanvasProjectContext, useEngine } from "../context.ts";
import { isDeviceClient } from "../deviceMode.ts";
import { useFeature } from "../features.ts";
import { installFramesDemand } from "./demand.ts";
import { loadQueueOf } from "./loadQueue.ts";
import { ScreenStateNote, useScreenFrame, type FrameStatus, type ScreenEditHooks } from "./ScreenView.tsx";

interface ScreenSlot {
  readonly element: RefObject<HTMLElement | null>;
  readonly clip: () => Element | null;
  readonly upright?: () => boolean;
  readonly owner: StoreOwner;
  readonly props: ScreenShapeProps;
  readonly interactive: boolean;
  readonly selected: boolean;
  readonly editor: boolean;
  readonly write: (next: ScreenShapeProps) => boolean;
  readonly rank: () => ScreenLoadRank;
  readonly edit?: ScreenEditHooks | undefined;
  readonly overlay?: ReactNode;
}

interface PoolEntry {
  readonly slots: Atom<ReadonlyArray<{ readonly token: object; readonly slot: ScreenSlot }>>;
  readonly status: Atom<FrameStatus>;
  readonly last: { current: ScreenSlot };
}

const NOT_LOADED: FrameStatus = { live: false, queued: false, painted: false };
const NOWHERE: ScreenLoadRank = { selected: false, distance: Number.POSITIVE_INFINITY };

const pools = new Map<string, Atom<ReadonlyMap<string, PoolEntry>>>();

const poolOf = (project: string): Atom<ReadonlyMap<string, PoolEntry>> => {
  let pool = pools.get(project);
  if (pool === undefined) {
    pool = atom(`screen frames ${project}`, new Map());
    pools.set(project, pool);
  }
  return pool;
};

const entryOf = (project: string, shapeId: string, slot: ScreenSlot): PoolEntry =>
  poolOf(project).get().get(shapeId) ?? { slots: atom(`screen slots ${shapeId}`, []), status: atom(`screen status ${shapeId}`, NOT_LOADED), last: { current: slot } };

const register = (project: string, shapeId: string, entry: PoolEntry): void => {
  const pool = poolOf(project);
  if (pool.get().get(shapeId) !== entry) pool.update((entries) => new Map(entries).set(shapeId, entry));
};

export const forgetScreenFrame = (project: string, shapeId: string): void => {
  const pool = pools.get(project);
  if (pool === undefined || !pool.get().has(shapeId)) return;
  pool.update((entries) => {
    const next = new Map(entries);
    next.delete(shapeId);
    return next;
  });
};

export const pruneScreenFrames = (project: string, shapeIds: ReadonlySet<string>): void => {
  const pool = pools.get(project);
  if (pool === undefined || [...pool.get().keys()].every((shapeId) => shapeIds.has(shapeId))) return;
  pool.update((entries) => new Map([...entries].filter(([shapeId]) => shapeIds.has(shapeId))));
};

const activeSlot = (slots: ReadonlyArray<{ readonly slot: ScreenSlot }>): ScreenSlot | undefined => (slots.find((each) => each.slot.editor) ?? slots[0])?.slot;

export const useScreenSlot = (project: string, shapeId: string, slot: ScreenSlot): FrameStatus => {
  const [token] = useState(() => ({}));
  const entry = useMemo(() => entryOf(project, shapeId, slot), [project, shapeId]);
  useLayoutEffect(() => {
    register(project, shapeId, entry);
    entry.slots.update((slots) => {
      const at = slots.findIndex((each) => each.token === token);
      if (at === -1) return [...slots, { token, slot }];
      const next = [...slots];
      next[at] = { token, slot };
      return next;
    });
  });
  useLayoutEffect(
    () => () => {
      entry.slots.update((slots) => slots.filter((each) => each.token !== token));
    },
    [entry, token],
  );
  return useValue("screen frame status", () => entry.status.get(), [entry]);
};

const PooledScreen = ({ project, shapeId, entry, host }: { readonly project: string; readonly shapeId: string; readonly entry: PoolEntry; readonly host: (shapeId: string, element: HTMLDivElement | null) => void }) => {
  const slot = useValue("screen slot", () => activeSlot(entry.slots.get()), [entry]);
  if (slot !== undefined) entry.last.current = slot;
  const shown = slot ?? entry.last.current;
  const interactive = slot?.interactive === true;
  const frame = useScreenFrame({
    owner: shown.owner,
    project,
    shapeId,
    props: shown.props,
    interactive,
    write: slot?.write ?? (() => false),
    edit: slot?.edit,
    queue: loadQueueOf(project),
    rank: () => activeSlot(entry.slots.get())?.rank() ?? NOWHERE,
  });
  useLayoutEffect(() => {
    const current = entry.status.get();
    if (current.live !== frame.status.live || current.queued !== frame.status.queued || current.painted !== frame.status.painted) entry.status.set(frame.status);
  });
  useEffect(
    () => () => {
      entry.status.set(NOT_LOADED);
    },
    [entry],
  );
  return (
    <div
      ref={(element) => host(shapeId, element)}
      className="absolute top-0 left-0 overflow-hidden"
      data-screen-of={shapeId}
      data-painted={frame.status.painted ? "true" : undefined}
      style={{ visibility: "hidden", transformOrigin: "0 0", pointerEvents: interactive ? "auto" : "none" }}
    >
      <div className="absolute inset-0" inert={!interactive} style={{ opacity: frame.status.painted ? 1 : 0 }}>
        {frame.content}
      </div>
      {frame.failure}
      <ScreenStateNote project={project} shapeId={shapeId} live={frame.status.live} />
      {slot?.overlay}
      {slot?.selected === true && <div className="pointer-events-none absolute inset-0 border-(length:--screen-ring) border-(--selection-stroke)" data-screen-ring="" />}
    </div>
  );
};

const place = (layer: HTMLElement, hosts: ReadonlyMap<string, HTMLDivElement>, entries: ReadonlyMap<string, PoolEntry>) => {
  let origin: DOMRect | undefined;
  const writes: Array<() => void> = [];
  for (const [shapeId, host] of hosts) {
    const slot = activeSlot(entries.get(shapeId)?.slots.get() ?? []);
    const element = slot?.element.current;
    if (slot === undefined || !element || element.offsetWidth === 0 || slot.upright?.() === false) {
      if (host.style.visibility !== "hidden")
        writes.push(() => {
          host.style.visibility = "hidden";
        });
      continue;
    }
    origin ??= layer.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const clip = slot.clip()?.getBoundingClientRect() ?? origin;
    const w = element.offsetWidth;
    const h = element.offsetHeight;
    const scale = rect.width / w;
    const inset = {
      top: Math.max(0, clip.top - rect.top) / scale,
      left: Math.max(0, clip.left - rect.left) / scale,
      bottom: Math.max(0, rect.bottom - clip.bottom) / scale,
      right: Math.max(0, rect.right - clip.right) / scale,
    };
    const visible = inset.top + inset.bottom < h && inset.left + inset.right < w;
    const at = { x: rect.left - origin.left, y: rect.top - origin.top };
    writes.push(() => {
      host.style.width = `${w}px`;
      host.style.height = `${h}px`;
      host.style.transform = `translate(${at.x}px, ${at.y}px) scale(${scale})`;
      host.style.clipPath = `inset(${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px)`;
      host.style.setProperty("--screen-ring", `${1 / scale}px`);
      host.style.visibility = visible ? "visible" : "hidden";
    });
  }
  for (const write of writes) write();
};

const ProjectFrames = ({ project }: { readonly project: string }) => {
  const engine = useEngine();
  const pool = poolOf(project);
  const entries = useValue("screen frames", () => pool.get(), [pool]);
  const editing = useValue("screen frames editing", () => [...pool.get().values()].some((entry) => activeSlot(entry.slots.get())?.editor === true), [pool]);
  const layer = useRef<HTMLDivElement>(null);
  const hosts = useRef(new Map<string, HTMLDivElement>());
  const host = (shapeId: string, element: HTMLDivElement | null) => {
    if (element === null) hosts.current.delete(shapeId);
    else hosts.current.set(shapeId, element);
  };
  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      if (layer.current !== null && hosts.current.size > 0) place(layer.current, hosts.current, pool.get());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [pool]);
  useEffect(() => installFramesDemand(engine, project, () => [...pool.get().values()].map((entry) => (activeSlot(entry.slots.get()) ?? entry.last.current).props.instance)), [engine, project, pool]);
  useEffect(() => {
    pools.set(project, pool);
    return () => {
      if (pools.get(project) === pool) pools.delete(project);
    };
  }, [project, pool]);
  return (
    <CanvasProjectContext.Provider value={project}>
      <div ref={layer} className={`pointer-events-none absolute inset-0 overflow-hidden ${editing ? "z-[701]" : ""}`} data-screen-frames={project}>
        {[...entries].map(([shapeId, entry]) => (
          <PooledScreen key={shapeId} project={project} shapeId={shapeId} entry={entry} host={host} />
        ))}
      </div>
    </CanvasProjectContext.Provider>
  );
};

export const ScreenFrames = ({ projects }: { readonly projects: ReadonlyArray<string> }) => {
  const repositories = useFeature("repositories");
  if (!repositories || isDeviceClient()) return null;
  return (
    <>
      {projects.map((project) => (
        <ProjectFrames key={project} project={project} />
      ))}
    </>
  );
};
