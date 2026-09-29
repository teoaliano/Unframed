/**
 * The tab's poll of its render placeholders (spec 04). The engine's sweep is what lands a
 * render with no tab open; this only shortens the wait. The shape's own update from the
 * engine is what the tab shows.
 */
import { runMarkerOf, type RenderParams } from "@unframed/contracts";
import type { Editor, TLRecord } from "tldraw";
import type { EngineConnection } from "../rpc/engine.ts";

export const POLL_EVERY_MS = 4_000;
export const POLL_FOR_MS = 15 * 60_000;
export const LATE_CHECK_EVERY_MS = 2 * 60_000;

interface Loop {
  stop(): void;
}

/**
 * One loop per job id: a check at once, then every 4 s for 15 minutes, then one check every
 * 2 minutes, until the job ends or its marker goes. A transport error or an unreadable
 * answer counts as still pending: the engine may be restarting.
 */
const pollLoop = (engine: EngineConnection, project: string, jobId: string, params: RenderParams, onEnd: () => void): Loop => {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const check = async () => {
    timer = undefined;
    let ended = false;
    try {
      const answer = await engine.call("video.poll", { jobId, project, params });
      ended = answer.status === "completed" || answer.status === "failed";
    } catch {
      // Still pending.
    }
    if (stopped) return;
    if (ended) {
      stopped = true;
      onEnd();
      return;
    }
    timer = setTimeout(() => void check(), Date.now() - started < POLL_FOR_MS ? POLL_EVERY_MS : LATE_CHECK_EVERY_MS);
  };
  void check();
  return {
    stop: () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
};

const durableOf = (record: TLRecord | undefined) => {
  if (record?.typeName !== "shape") return undefined;
  const marker = runMarkerOf(record);
  return marker?.durable ? { jobId: marker.runId, params: marker.durable.params } : undefined;
};

/**
 * Polls every render placeholder of the open project: the ones already there when it opens
 * (the resume after a reload or a project switch) and every one that arrives later. Answers
 * a function that stops every loop.
 */
export const installRenderPolls = (editor: Editor, engine: EngineConnection, project: string): (() => void) => {
  const loops = new Map<string, Loop>();
  /** Which shapes carry which job's marker, so a loop ends when its last marker goes. */
  const markers = new Map<string, string>();

  const track = (record: TLRecord) => {
    const durable = durableOf(record);
    if (!durable) return untrack(record.id);
    markers.set(record.id, durable.jobId);
    if (loops.has(durable.jobId)) return;
    loops.set(
      durable.jobId,
      pollLoop(engine, project, durable.jobId, durable.params, () => loops.delete(durable.jobId)),
    );
  };

  const untrack = (id: string) => {
    const jobId = markers.get(id);
    if (jobId === undefined) return;
    markers.delete(id);
    if ([...markers.values()].includes(jobId)) return;
    loops.get(jobId)?.stop();
    loops.delete(jobId);
  };

  for (const shape of editor.getCurrentPageShapes()) track(shape as TLRecord);
  const stopListening = editor.store.listen(
    ({ changes }) => {
      for (const record of Object.values(changes.added)) track(record);
      for (const [, record] of Object.values(changes.updated)) track(record);
      for (const record of Object.values(changes.removed)) untrack(record.id);
    },
    { scope: "document" },
  );
  return () => {
    stopListening();
    for (const loop of loops.values()) loop.stop();
    loops.clear();
  };
};
