import type { Settings } from "@unframed/contracts";
import { createContext, useContext, useEffect, useState } from "react";
import { LicenseKeyContext, tldrawLicenseKey } from "./license.ts";
import type { EngineConnection } from "./rpc/engine.ts";

export const EngineContext = createContext<EngineConnection | undefined>(undefined);

export const useEngine = (): EngineConnection => {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error("useEngine needs an EngineContext provider.");
  return engine;
};

/** The live settings, from `settings.subscribe`. `undefined` until the first value arrives. */
export const useSettings = (): Settings | undefined => {
  const engine = useEngine();
  const [settings, setSettings] = useState<Settings>();
  useEffect(() => engine.subscribe("settings.subscribe", undefined, setSettings), [engine]);
  return settings;
};

/**
 * The app frame: the two floating chrome cards the desktop shell targets, over the
 * canvas background. Spec 02 fills the cards and puts the canvas under them.
 */
const Frame = () => {
  useSettings();
  return (
    <main className="relative h-full w-full overflow-hidden bg-canvas text-primary">
      <div className="unframed-chrome-left" />
      <div className="unframed-chrome-right" />
    </main>
  );
};

export const App = ({ engine }: { readonly engine: EngineConnection }) => (
  <EngineContext.Provider value={engine}>
    <LicenseKeyContext.Provider value={tldrawLicenseKey}>
      <Frame />
    </LicenseKeyContext.Provider>
  </EngineContext.Provider>
);
