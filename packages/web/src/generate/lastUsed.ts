import type { GenerationProvider, Medium } from "@unframed/contracts";
import type { EngineConnection } from "../rpc/engine.ts";
import type { PropValue, TrayValues } from "./mediumRegistry.ts";

/** A medium's last-used values: the model (only when the person picked one) and the tray's props. */
export interface LastUsed {
  readonly model?: string;
  readonly props: Readonly<Record<string, PropValue>>;
  /** Spec 04: the share consent, stored beside the props; the tray holds it as one of them. */
  readonly shareLocalVideos?: boolean;
  readonly voice?: { readonly id: string; readonly name: string };
  /** Spec 22: the provider last used, and the model picked for each provider. */
  readonly provider?: GenerationProvider;
  readonly models?: Partial<Record<GenerationProvider, string>>;
}

const keyOf = (medium: Medium) => `lastUsed.${medium}`;

const isProvider = (value: unknown): value is GenerationProvider => value === "openrouter" || value === "vercel";

/** A stored value, or `undefined` for a missing or unreadable one. */
const readLastUsed = (value: unknown): LastUsed | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { model, props, shareLocalVideos, voice, provider, models } = value as { model?: unknown; props?: unknown; shareLocalVideos?: unknown; voice?: unknown; provider?: unknown; models?: unknown };
  const kept: Record<string, PropValue> = {};
  if (typeof props === "object" && props !== null) {
    for (const [key, each] of Object.entries(props)) if (typeof each === "string" || typeof each === "number" || typeof each === "boolean") kept[key] = each;
  }
  if (typeof shareLocalVideos === "boolean") kept.shareLocalVideos = shareLocalVideos;
  const { id, name } = (typeof voice === "object" && voice !== null ? voice : {}) as { id?: unknown; name?: unknown };
  if (typeof id === "string" && id !== "") {
    kept.voice_id = id;
    kept.voice_name = typeof name === "string" && name !== "" ? name : id;
  }
  const byProvider: Partial<Record<GenerationProvider, string>> = {};
  if (typeof models === "object" && models !== null) {
    for (const [key, each] of Object.entries(models)) if (isProvider(key) && typeof each === "string" && each !== "") byProvider[key] = each;
  }
  return {
    ...(typeof model === "string" && model !== "" ? { model } : {}),
    props: kept,
    ...(isProvider(provider) ? { provider } : {}),
    ...(Object.keys(byProvider).length > 0 ? { models: byProvider } : {}),
  };
};

/** The model last picked for a provider: its own entry, else the plain model when that was the provider's. */
export const storedModel = (lastUsed: LastUsed | null | undefined, provider: GenerationProvider): string | undefined =>
  lastUsed?.models?.[provider] ?? ((lastUsed?.provider ?? "openrouter") === provider ? lastUsed?.model : undefined);

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

/**
 * Spec 22: an image or text tray's values. `model` is the current provider's pick; `models`
 * keeps the other provider's, and `provider` is written only for the gateway, so an
 * OpenRouter-only person's value is unchanged.
 */
export const rememberTray = async (engine: EngineConnection, medium: Medium, values: TrayValues, props: Readonly<Record<string, PropValue>>): Promise<void> => {
  const provider = values.provider ?? "openrouter";
  const before = await loadLastUsed(engine, medium);
  const model = values.picked && values.model !== undefined ? values.model : undefined;
  const others: Partial<Record<GenerationProvider, string>> = {};
  for (const each of ["openrouter", "vercel"] as const) {
    const kept = each === provider ? undefined : storedModel(before, each);
    if (kept !== undefined) others[each] = kept;
  }
  await saveLastUsed(engine, medium, {
    ...(model === undefined ? {} : { model }),
    props,
    ...(provider === "vercel" ? { provider } : {}),
    ...(Object.keys(others).length > 0 ? { models: others } : {}),
  });
};
