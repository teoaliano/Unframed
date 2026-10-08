import type { Medium } from "@unframed/contracts";
import type { EngineConnection } from "../rpc/engine.ts";
import type { PropValue } from "./mediumRegistry.ts";

/** A medium's last-used values: the model (only when the person picked one) and the tray's props. */
export interface LastUsed {
  readonly model?: string;
  readonly props: Readonly<Record<string, PropValue>>;
  /** Spec 04: the share consent, stored beside the props; the tray holds it as one of them. */
  readonly shareLocalVideos?: boolean;
}

const keyOf = (medium: Medium) => `lastUsed.${medium}`;

/** A stored value, or `undefined` for a missing or unreadable one. */
const readLastUsed = (value: unknown): LastUsed | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { model, props, shareLocalVideos } = value as { model?: unknown; props?: unknown; shareLocalVideos?: unknown };
  const kept: Record<string, PropValue> = {};
  if (typeof props === "object" && props !== null) {
    for (const [key, each] of Object.entries(props)) if (typeof each === "string" || typeof each === "number" || typeof each === "boolean") kept[key] = each;
  }
  if (typeof shareLocalVideos === "boolean") kept.shareLocalVideos = shareLocalVideos;
  return { ...(typeof model === "string" && model !== "" ? { model } : {}), props: kept };
};

export const loadLastUsed = async (engine: EngineConnection, medium: Medium): Promise<LastUsed | undefined> => {
  try {
    const { values } = await engine.call("preferences.get", { keys: [keyOf(medium)] });
    return readLastUsed(values[keyOf(medium)]);
  } catch {
    return undefined;
  }
};

/** Written when a run is sent from the composer. */
export const saveLastUsed = (engine: EngineConnection, medium: Medium, value: LastUsed): Promise<unknown> =>
  engine.call("preferences.set", { key: keyOf(medium), value }).catch(() => undefined);
