import { designPanelPreference } from "@unframed/domain";
import { useCallback, useContext, useEffect } from "react";
import { atom, useValue } from "tldraw";
import { EngineContext } from "../context.ts";

const DESIGN_PANEL_KEY = "design.panel";

const open = atom<boolean | undefined>("design panel open", undefined);
let loading = false;

export const useDesignPanelOpen = (): readonly [boolean, (next: boolean) => void] => {
  const engine = useContext(EngineContext);
  const value = useValue("design panel open", () => open.get(), []);
  useEffect(() => {
    if (engine === undefined || open.get() !== undefined || loading) return;
    loading = true;
    engine
      .call("preferences.get", { keys: [DESIGN_PANEL_KEY] })
      .then(({ values }) => designPanelPreference(values[DESIGN_PANEL_KEY]).open)
      .catch(() => false)
      .then((read) => {
        if (open.get() === undefined) open.set(read);
      })
      .finally(() => {
        loading = false;
      });
  }, [engine]);
  const set = useCallback(
    (next: boolean) => {
      open.set(next);
      engine?.call("preferences.set", { key: DESIGN_PANEL_KEY, value: { open: next } }).catch(() => undefined);
    },
    [engine],
  );
  return [value === true, set] as const;
};
