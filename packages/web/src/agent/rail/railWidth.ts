import { useCallback, useEffect, useState } from "react";
import type { EngineConnection } from "../../rpc/engine.ts";

export const RAIL_PREFS_KEY = "agent.rail";
export const RAIL_WIDTH_VAR = "--agent-rail-width";

const readWidth = (value: unknown): number | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { w } = value as { w?: unknown };
  return typeof w === "number" && Number.isFinite(w) ? w : undefined;
};

let known: number | undefined;

export const useRailWidth = (engine: EngineConnection) => {
  const [width, setWidth] = useState<number | undefined>(known);
  useEffect(() => {
    if (known !== undefined) return;
    let live = true;
    engine
      .call("preferences.get", { keys: [RAIL_PREFS_KEY] })
      .then(({ values }) => {
        const read = readWidth(values[RAIL_PREFS_KEY]);
        if (read === undefined) return;
        known ??= read;
        if (live) setWidth(known);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [engine]);
  const save = useCallback(
    (next: number) => {
      known = next;
      setWidth(next);
      engine.call("preferences.set", { key: RAIL_PREFS_KEY, value: { w: next } }).catch(() => undefined);
    },
    [engine],
  );
  return [width, save] as const;
};
