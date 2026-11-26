import type { ScreenShapeProps } from "@unframed/contracts";
import type { ScreenLoadRank } from "@unframed/domain";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { atom, useValue, type Atom } from "tldraw";
import type { StoreOwner } from "../canvas/doc.ts";
import { CanvasProjectContext, useEngine } from "../context.ts";
import { isDeviceClient } from "../deviceMode.ts";
import { useFeature } from "../features.ts";
import { installFramesDemand } from "./demand.ts";
import { loadQueueOf } from "./loadQueue.ts";
import { useScreenFrame, type FrameStatus, type ScreenEditHooks } from "./ScreenView.tsx";

export interface ScreenSlot {
  readonly element: RefObject<HTMLElement | null>;
  readonly clip: () => Element | null;
  readonly owner: StoreOwner;
  readonly props: ScreenShapeProps;
  readonly interactive: boolean;
  readonly selected: boolean;
  readonly editor: boolean;
  readonly write: (next: ScreenShapeProps) => boolean;
  readonly rank: () => ScreenLoadRank;
  readonly edit?: ScreenEditHooks | undefined;
}

interface PoolEntry {
  readonly slots: Atom<ReadonlyArray<{ readonly token: object; readonly slot: ScreenSlot }>>;
  readonly status: Atom<FrameStatus>;
  readonly last: { current: ScreenSlot };
}

const NOT_LOADED: FrameStatus = { live: false, queued: false, painted: false };

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

const keep = (project: string, shapeId: string, entry: PoolEntry): void => {
  const pool = poolOf(project);
  if (pool.get().get(shapeId) !== entry) pool.update((entries) => new Map(entries).set(shapeId, entry));
};

export const forgetScreenFrame = (project: string, shapeId: string): void => {
  const pool = poolOf(project);
  if (!pool.get().has(shapeId)) return;
  pool.update((entries) => {
    const next = new Map(entries);
    next.delete(shapeId);
    return next;
  });
};

const activeSlot = (slots: ReadonlyArray<{ readonly slot: ScreenSlot }>): ScreenSlot | undefined => (slots.find((each) => each.slot.editor) ?? slots[0])?.slot;

export const useScreenSlot = (project: string, shapeId: string, slot: ScreenSlot): FrameStatus => {
  const [token] = useState(() => ({}));
  const [entry] = useState(() => entryOf(project, shapeId, slot));
  useLayoutEffect(() => {
    keep(project, shapeId, entry);
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
  const queue = loadQueueOf(project);
  const frame = useScreenFrame({
    owner: shown.owner,
    project,
    shapeId,
    props: shown.props,
    interactive: slot?.interactive === true,
    write: slot?.write ?? (() => false),
    edit: slot?.edit,
    queue,
    rank: () => activeSlot(entry.slots.get())?.rank() ?? { selected: false, distance: Number.POSITIVE_INFINITY },
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
      style={{ visibility: "hidden", transformOrigin: "0 0", pointerEvents: slot?.interactive === true ? "auto" : "none" }}
    >
      <div className="absolute inset-0" style={{ opacity: frame.status.painted ? 1 : 0 }}>
        {frame.content}
      </div>
      {frame.failure}
      {slot?.selected === true && <div className="pointer-events-none absolute inset-0 border border-(--selection-stroke)" data-screen-ring="" />}
    </div>
  );
};

const place = (layer: HTMLElement, hosts: ReadonlyMap<string, HTMLDivElement>, entries: ReadonlyMap<string, PoolEntry>) => {
  const origin = layer.getBoundingClientRect();
  const writes: Array<() => void> = [];
  for (const [shapeId, host] of hosts) {
    const slot = activeSlot(entries.get(shapeId)?.slots.get() ?? []);
    const element = slot?.element.current;
    if (slot === undefined || element === null || element === undefined || element.offsetWidth === 0) {
      writes.push(() => {
        host.style.visibility = "hidden";
      });
      continue;
    }
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
    writes.push(() => {
      host.style.width = `${w}px`;
      host.style.height = `${h}px`;
      host.style.transform = `translate(${rect.left - origin.left}px, ${rect.top - origin.top}px) scale(${scale})`;
      host.style.clipPath = `inset(${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px)`;
      host.style.visibility = visible ? "visible" : "hidden";
    });
  }
  for (const write of writes) write();
};

const ProjectFrames = ({ project }: { readonly project: string }) => {
  const engine = useEngine();
  const pool = poolOf(project);
  const entries = useValue("screen frames", () => pool.get(), [pool]);
  const layer = useRef<HTMLDivElement>(null);
  const hosts = useRef(new Map<string, HTMLDivElement>());
  const host = (shapeId: string, element: HTMLDivElement | null) => {
    if (element === null) hosts.current.delete(shapeId);
    else hosts.current.set(shapeId, element);
  };
  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      if (layer.current !== null) place(layer.current, hosts.current, pool.get());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [pool]);
  useEffect(() => installFramesDemand(engine, project, () => [...pool.get().values()].map((entry) => (activeSlot(entry.slots.get()) ?? entry.last.current).props.instance)), [engine, project, pool]);
  return (
    <CanvasProjectContext.Provider value={project}>
      <div ref={layer} className="pointer-events-none absolute inset-0 overflow-hidden" data-screen-frames={project}>
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
