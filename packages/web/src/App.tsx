import { useEffect, useMemo, useRef } from "react";
import { CanvasHost } from "./canvas/CanvasHost.tsx";
import { TopCorners } from "./chrome/Corners.tsx";
import { connectionMonitor } from "./connection/monitor.ts";
import { ActivationContext, EngineContext, useActivation, useSettings } from "./context.ts";
import { ImportGate } from "./legacy/ImportGate.tsx";
import { LicenseKeyContext, tldrawLicenseKey } from "./license.ts";
import { ProjectActivation, useTabState } from "./project/activation.ts";
import { DeviceTabs } from "./project/deviceTabs.ts";
import { readClientMode } from "./deviceMode.ts";
import { OPEN_PROJECT_LIST } from "./chrome/tabEvents.ts";
import { Button } from "~/components/ui/button";
import type { EngineConnection } from "./rpc/engine.ts";
import { reportIpadAvailability } from "./settings/ipadAvailability.ts";
import { SettingsHost } from "./settings/SettingsHost.tsx";
import { setThemeChoice, THEME_KEY, themeChoiceOf } from "./theme/theme.ts";
import { Toasts } from "./toasts.tsx";

/** Feeds the RPC socket's state to the connection monitor. */
const useRpcHealth = (engine: EngineConnection) => {
  useEffect(() => {
    connectionMonitor.setRpc(engine.state === "open" ? "up" : "down");
    return engine.onStateChange((state) => connectionMonitor.setRpc(state === "open" ? "up" : "down"));
  }, [engine]);
};

const useThemePreference = (engine: EngineConnection) => {
  useEffect(() => engine.subscribe("preferences.subscribe", { keys: [THEME_KEY] }, ({ value }) => setThemeChoice(themeChoiceOf(value))), [engine]);
};

/**
 * The app frame: the canvas of the active project under the two floating chrome cards
 * the desktop shell targets.
 */
const Frame = () => {
  // Holds the app's settings.subscribe open from the start, through every reconnect.
  useSettings();
  const activation = useActivation();
  const { active: project, loaded } = useTabState(activation);
  // isolate: the canvas and its chrome stack below every kit popup, which portals to <body> at t3code's z-50 to 140.
  return (
    <main className="relative isolate h-full w-full overflow-hidden bg-(--app-surface) text-(--app-foreground)">
      {project !== undefined && (
        <ImportGate key={project} project={project}>
          <CanvasHost project={project} activation={activation} />
        </ImportGate>
      )}
      {project === undefined && loaded && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="grid justify-items-center gap-3 rounded-2xl border border-(--no-project-border) bg-(--no-project-surface) p-8 text-center text-(--no-project-foreground) shadow-lg/5">
            <p className="m-0 text-sm text-(--no-project-description)">No project is open.</p>
            <Button onClick={() => window.dispatchEvent(new Event(OPEN_PROJECT_LIST))}>Open project</Button>
          </div>
        </div>
      )}
      <TopCorners />
      <SettingsHost />
    </main>
  );
};

export const App = ({ engine }: { readonly engine: EngineConnection }) => {
  const activation = useMemo(() => new ProjectActivation(engine), [engine]);
  useRpcHealth(engine);
  useThemePreference(engine);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const onMac = () => {
      void activation.initialLoad();
      void reportIpadAvailability(engine).catch(() => undefined);
    };
    void readClientMode(engine).then((device) => {
      if (device) new DeviceTabs(activation, engine).start();
      else onMac();
    }, onMac);
  }, [activation, engine]);
  return (
    <EngineContext.Provider value={engine}>
      <ActivationContext.Provider value={activation}>
        <LicenseKeyContext.Provider value={tldrawLicenseKey}>
          <Toasts>
            <Frame />
          </Toasts>
        </LicenseKeyContext.Provider>
      </ActivationContext.Provider>
    </EngineContext.Provider>
  );
};
