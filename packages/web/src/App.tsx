import { useEffect, useMemo, useRef } from "react";
import { CanvasHost } from "./canvas/CanvasHost.tsx";
import { TopCorners } from "./chrome/Corners.tsx";
import { connectionMonitor } from "./connection/monitor.ts";
import { ActivationContext, EngineContext, useActivation, useSettings } from "./context.ts";
import { LicenseKeyContext, tldrawLicenseKey } from "./license.ts";
import { ProjectActivation, useActiveProject } from "./project/activation.ts";
import type { EngineConnection } from "./rpc/engine.ts";
import { Toasts } from "./toasts.tsx";

/** Feeds the RPC socket's state to the connection monitor. */
const useRpcHealth = (engine: EngineConnection) => {
  useEffect(() => {
    connectionMonitor.setRpc(engine.state === "open" ? "up" : "down");
    return engine.onStateChange((state) => connectionMonitor.setRpc(state === "open" ? "up" : "down"));
  }, [engine]);
};

/**
 * The app frame: the canvas of the active project under the two floating chrome cards
 * the desktop shell targets.
 */
const Frame = () => {
  // Holds the app's settings.subscribe open from the start, through every reconnect.
  useSettings();
  const activation = useActivation();
  const project = useActiveProject(activation);
  return (
    <main className="relative h-full w-full overflow-hidden bg-canvas text-primary">
      {project !== undefined && <CanvasHost key={project} project={project} activation={activation} />}
      <TopCorners />
    </main>
  );
};

export const App = ({ engine }: { readonly engine: EngineConnection }) => {
  const activation = useMemo(() => new ProjectActivation(engine), [engine]);
  useRpcHealth(engine);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void activation.initialLoad();
  }, [activation]);
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
