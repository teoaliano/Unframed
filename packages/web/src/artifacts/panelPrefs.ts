import { readPanelPrefs, type PanelPrefs } from "@unframed/domain";
import { useCallback, useEffect, useState } from "react";
import type { EngineConnection } from "../rpc/engine.ts";

export const PANEL_PREFS_KEY = "parameters.panel";

export const panelPrefsHook = (key: string, read: (value: unknown) => PanelPrefs) => {
  let known: PanelPrefs | undefined;
  return (engine: EngineConnection) => {
    const [prefs, setPrefs] = useState<PanelPrefs | undefined>(known);
    useEffect(() => {
      if (known !== undefined) return;
      let live = true;
      engine
        .call("preferences.get", { keys: [key] })
        .then(({ values }) => read(values[key]))
        .catch(() => read(undefined))
        .then((value) => {
          known ??= value;
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
        engine.call("preferences.set", { key, value: next }).catch(() => undefined);
      },
      [engine],
    );
    return [prefs, save] as const;
  };
};

export const usePanelPrefs = panelPrefsHook(PANEL_PREFS_KEY, readPanelPrefs);
