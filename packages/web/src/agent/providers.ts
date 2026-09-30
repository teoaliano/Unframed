import type { AgentProvider, ProviderModel, ProviderStatuses } from "@unframed/contracts";
import { defaultModel } from "@unframed/domain";

export const PROVIDERS: ReadonlyArray<AgentProvider> = ["claude", "codex"];

export const providerName = (provider: AgentProvider): string => (provider === "claude" ? "Claude" : "Codex");

export const readyProviders = (statuses: ProviderStatuses | undefined): AgentProvider[] =>
  statuses === undefined ? [] : PROVIDERS.filter((provider) => statuses[provider].status === "ready");

/** Neither provider is ready, as far as the last check knows. Unknown until a check answers. */
export const noProviderReady = (statuses: ProviderStatuses | undefined): boolean => statuses !== undefined && readyProviders(statuses).length === 0;

/** What the Agent button's tooltip says when no provider is ready: the first provider's own message. */
export const providerMessage = (statuses: ProviderStatuses | undefined): string | undefined => {
  if (!statuses || !noProviderReady(statuses)) return undefined;
  return PROVIDERS.map((provider) => statuses[provider].message).find((message) => message !== undefined);
};

export const modelsOf = (statuses: ProviderStatuses | undefined, provider: AgentProvider): ReadonlyArray<ProviderModel> =>
  statuses?.[provider].status === "ready" ? (statuses[provider].models ?? []) : [];

/** The model a selection runs on: its own, or for an empty setting the provider's first non-legacy one. */
export const effectiveModel = (statuses: ProviderStatuses | undefined, provider: AgentProvider, model: string): ProviderModel | undefined => {
  const models = modelsOf(statuses, provider);
  const id = model === "" ? defaultModel(models.map((row) => ({ ...row, efforts: [...row.efforts] }))) : model;
  return models.find((row) => row.id === id);
};
