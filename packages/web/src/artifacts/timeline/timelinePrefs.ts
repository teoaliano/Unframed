import { useCallback, useEffect, useState } from "react";
import type { EngineConnection } from "../../rpc/engine.ts";

export const TIMELINE_PREFS_KEY = "editor.timeline";

export interface TimelinePrefs {
  readonly height: number;
  readonly open: boolean;
}

export const DEFAULT_TIMELINE_PREFS: TimelinePrefs = { height: 240, open: true };
export const TIMELINE_MIN_HEIGHT = 120;
export const TIMELINE_MAX_SHARE = 0.6;

export const clampTimelineHeight = (height: number, column: number): number => {
  const largest = column > 0 ? Math.max(TIMELINE_MIN_HEIGHT, Math.floor(column * TIMELINE_MAX_SHARE)) : Infinity;
  return Math.round(Math.min(largest, Math.max(TIMELINE_MIN_HEIGHT, height)));
};

const readPrefs = (value: unknown): TimelinePrefs | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { height, open } = value as { height?: unknown; open?: unknown };
  if (typeof height !== "number" || !Number.isFinite(height) || typeof open !== "boolean") return undefined;
  return { height: Math.max(TIMELINE_MIN_HEIGHT, height), open };
};

let known: TimelinePrefs | undefined;

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
