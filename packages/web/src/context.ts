import type { Settings } from "@unframed/contracts";
import { createContext, useContext, useEffect, useState } from "react";
import type { ProjectActivation } from "./project/activation.ts";
import type { EngineConnection } from "./rpc/engine.ts";

export const EngineContext = createContext<EngineConnection | undefined>(undefined);
export const ActivationContext = createContext<ProjectActivation | undefined>(undefined);

export const useEngine = (): EngineConnection => {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error("useEngine needs an EngineContext provider.");
  return engine;
};

export const useActivation = (): ProjectActivation => {
  const activation = useContext(ActivationContext);
  if (!activation) throw new Error("useActivation needs an ActivationContext provider.");
  return activation;
};

/** The live settings, from `settings.subscribe`. `undefined` until the first value arrives. */
export const useSettings = (): Settings | undefined => {
  const engine = useEngine();
  const [settings, setSettings] = useState<Settings>();
  useEffect(() => engine.subscribe("settings.subscribe", undefined, setSettings), [engine]);
  return settings;
};
