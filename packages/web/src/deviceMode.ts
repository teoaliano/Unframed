import { useSyncExternalStore } from "react";
import { setFeatures } from "./features.ts";
import { isConnectionFailure, type EngineConnection } from "./rpc/engine.ts";

let device = false;
const listeners = new Set<() => void>();

export const isDeviceClient = (): boolean => device;

export const setDeviceClient = (on: boolean): void => {
  if (on === device) return;
  device = on;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useIsDevice = (): boolean => useSyncExternalStore(subscribe, isDeviceClient);

export const readClientMode = async (engine: EngineConnection): Promise<boolean> => {
  for (;;) {
    try {
      const health = await engine.call("server.health");
      setDeviceClient(health.client === "device");
      setFeatures(health.features);
      return isDeviceClient();
    } catch (error) {
      if (!isConnectionFailure(error)) throw error;
    }
  }
};
