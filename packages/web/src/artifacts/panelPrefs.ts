import { readPanelPrefs, type PanelPrefs } from "@unframed/domain";
import { useCallback, useEffect, useState } from "react";
import type { EngineConnection } from "../rpc/engine.ts";

export const PANEL_PREFS_KEY = "parameters.panel";

let known: PanelPrefs | undefined;

export const usePanelPrefs = (engine: EngineConnection) => {
  const [prefs, setPrefs] = useState<PanelPrefs | undefined>(known);
  useEffect(() => {
    if (known !== undefined) return;
    let live = true;
    engine
      .call("preferences.get", { keys: [PANEL_PREFS_KEY] })
      .then(({ values }) => readPanelPrefs(values[PANEL_PREFS_KEY]))
      .catch(() => readPanelPrefs(undefined))
      .then((read) => {
        known ??= read;
        if (live) setPrefs(known);
      });
    return () => {
      live = false;
    };
  }, [engine]);
  const save = useCallback(
    (next: PanelPrefs) => {
      known = next;
      setPrefs(next);
      engine.call("preferences.set", { key: PANEL_PREFS_KEY, value: next }).catch(() => undefined);
    },
    [engine],
  );
  return [prefs, save] as const;
};
