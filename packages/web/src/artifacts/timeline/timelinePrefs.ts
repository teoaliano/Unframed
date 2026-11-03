/**
 * The motion timeline's preferences (spec 21): its height and whether it is open. One store key
 * is shared by every motion. The engine keeps it; the editor keeps a copy for the session, so a
 * second editor opens without waiting for the engine.
 */
import { useCallback, useEffect, useState } from "react";
import type { EngineConnection } from "../../rpc/engine.ts";

export const TIMELINE_PREFS_KEY = "editor.timeline";

export interface TimelinePrefs {
  readonly height: number;
  readonly open: boolean;
}

export const DEFAULT_TIMELINE_PREFS: TimelinePrefs = { height: 240, open: true };
/** The smallest the rows can be dragged to: 120 px. */
export const TIMELINE_MIN_HEIGHT = 120;
/** The largest, as a share of the centre column. */
export const TIMELINE_MAX_SHARE = 0.6;

/** A dragged or stored height within 120 px and 60 % of the column; the column's height is unknown until it is measured. */
export const clampTimelineHeight = (height: number, column: number): number => {
  const largest = column > 0 ? Math.max(TIMELINE_MIN_HEIGHT, Math.floor(column * TIMELINE_MAX_SHARE)) : Infinity;
  return Math.round(Math.min(largest, Math.max(TIMELINE_MIN_HEIGHT, height)));
};

/** A stored value, or `undefined` for a missing or unreadable one. */
const readPrefs = (value: unknown): TimelinePrefs | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { height, open } = value as { height?: unknown; open?: unknown };
  if (typeof height !== "number" || !Number.isFinite(height) || typeof open !== "boolean") return undefined;
  return { height: Math.max(TIMELINE_MIN_HEIGHT, height), open };
};

/** The session's copy, shared by every editor this page opens. */
let known: TimelinePrefs | undefined;

/** The timeline's preferences and a way to save them. A save is written to the engine at once. */
export const useTimelinePrefs = (engine: EngineConnection) => {
  const [prefs, setPrefs] = useState<TimelinePrefs>(known ?? DEFAULT_TIMELINE_PREFS);
  useEffect(() => {
    if (known !== undefined) return;
    let live = true;
    engine
      .call("preferences.get", { keys: [TIMELINE_PREFS_KEY] })
      .then(({ values }) => {
        const read = readPrefs(values[TIMELINE_PREFS_KEY]);
        if (read === undefined) return;
        known = read;
        if (live) setPrefs(read);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [engine]);
  const save = useCallback(
    (next: TimelinePrefs) => {
      known = next;
      setPrefs(next);
      engine.call("preferences.set", { key: TIMELINE_PREFS_KEY, value: next }).catch(() => undefined);
    },
    [engine],
  );
  return [prefs, save] as const;
};
