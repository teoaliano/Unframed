import type { ProjectActivity } from "@unframed/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

/** How often the engine looks at live work. A change reaches the strip within one tick. */
export const ACTIVITY_TICK_MS = 250;

export interface ActivitySource {
  readonly list: Effect.Effect<ReadonlyArray<string>, unknown>;
  readonly live: (project: string) => Effect.Effect<{ readonly running: number; readonly needsYou: number }, unknown>;
}

/**
 * The changes since the last tick. A project is sent when its counts change, so the
 * first tick sends every project with work; a project whose work ends is sent once with zeros.
 * Quiet projects are never sent.
 */
export const activityChanges = async (source: ActivitySource, last: Map<string, string>): Promise<ProjectActivity[]> => {
  const names = await Effect.runPromise(source.list);
  const now = new Map<string, ProjectActivity>();
  for (const project of names) {
    const counts = await Effect.runPromise(source.live(project));
    if (counts.running > 0 || counts.needsYou > 0) now.set(project, { project, ...counts });
  }
  const out: ProjectActivity[] = [];
  for (const [project, item] of now) {
    const key = `${item.running}/${item.needsYou}`;
    if (last.get(project) !== key) out.push(item);
    last.set(project, key);
  }
  for (const project of [...last.keys()]) {
    if (!now.has(project)) {
      last.delete(project);
      out.push({ project, running: 0, needsYou: 0 });
    }
  }
  return out;
};

/**
 * The activity stream for one socket: a timer reads the projects every `ACTIVITY_TICK_MS`, and
 * only changes go out. The timer lives while the socket does. A read that fails ends the stream,
 * and the web opens it again on its next connection.
 */
export const projectActivityStream = (source: ActivitySource): Stream.Stream<ProjectActivity, unknown> =>
  Stream.callback<ProjectActivity, unknown>((queue) =>
    Effect.sync(() => {
      const last = new Map<string, string>();
      let reading = false;
      const timer = setInterval(() => {
        if (reading) return;
        reading = true;
        activityChanges(source, last).then(
          (items) => {
            reading = false;
            for (const item of items) Queue.offerUnsafe(queue, item);
          },
          () => {
            clearInterval(timer);
            Queue.endUnsafe(queue);
          },
        );
      }, ACTIVITY_TICK_MS);
      return () => clearInterval(timer);
    }),
  );
