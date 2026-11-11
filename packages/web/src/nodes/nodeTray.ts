import type { GenerationProvider, NodeMedium, NodeShapeProps } from "@unframed/contracts";
import { nodeCatalogueOf, providerOf, trayProvider, type ProviderKeys } from "@unframed/domain";
import { loadCatalogue } from "../generate/catalogue.ts";
import { loadLastUsed, rememberTray, storedModel } from "../generate/lastUsed.ts";
import { mediumDefinition, type PropValue } from "../generate/mediumRegistry.ts";
import { RUNS_KEY } from "../generate/runsProp.tsx";
import type { EngineConnection } from "../rpc/engine.ts";

export type NodeValues = Pick<NodeShapeProps, "model" | "params"> & { readonly runs: number | undefined; readonly provider: GenerationProvider | undefined };

const ANY_KEY: ProviderKeys = { hasKey: true, hasVercelKey: false };

export const isRoutedNode = (medium: NodeMedium): medium is "image" | "text" => medium === "image" || medium === "text";

export const nodeCatalogueProvider = (medium: NodeMedium, provider: GenerationProvider | undefined): GenerationProvider | undefined =>
  isRoutedNode(medium) && providerOf(provider) !== "openrouter" ? providerOf(provider) : undefined;

export const splitTray = (medium: NodeMedium, tray: Record<string, PropValue>): Pick<NodeValues, "params" | "runs"> => {
  const { [RUNS_KEY]: runs, ...params } = tray;
  return { params: params as NodeShapeProps["params"], runs: medium === "image" && typeof runs === "number" && runs > 1 ? runs : undefined };
};

export const nodeStartValues = async (
  engine: EngineConnection,
  keys: ProviderKeys | undefined,
  medium: NodeMedium,
  carry?: { readonly provider: GenerationProvider; readonly model: string; readonly tray: Record<string, PropValue> },
): Promise<NodeValues> => {
  const definition = mediumDefinition(nodeCatalogueOf(medium))!;
  const stored = await loadLastUsed(engine, definition.medium);
  const provider = isRoutedNode(medium) ? (carry?.provider ?? trayProvider({ medium, wanted: stored?.provider, settings: keys ?? ANY_KEY }).provider) : "openrouter";
  const list = await loadCatalogue(engine, nodeCatalogueOf(medium), nodeCatalogueProvider(medium, provider)).catch(() => undefined);
  const listed = (model: string | undefined) => (model !== undefined && model !== "" && list?.models.some((each) => each.id === model) ? model : undefined);
  const model = listed(carry?.model) ?? listed(isRoutedNode(medium) ? storedModel(stored, provider) : stored?.model) ?? "";
  const entry = list?.models.find((each) => each.id === (model || list.default));
  const tray = carry
    ? definition.reset(carry.tray, definition.params(entry))
    : stored
      ? definition.keep(stored.props, definition.params(entry, stored.props))
      : definition.defaults(definition.params(entry));
  const split = splitTray(medium, tray as Record<string, PropValue>);
  return { model, ...split, provider: nodeCatalogueProvider(medium, provider) };
};

export const rememberNode = (engine: EngineConnection, medium: NodeMedium, values: { readonly model: string; readonly picked: boolean; readonly provider: GenerationProvider | undefined; readonly tray: Record<string, PropValue> }) =>
  rememberTray(
    engine,
    mediumDefinition(nodeCatalogueOf(medium))!.medium,
    { model: values.model === "" ? undefined : values.model, picked: values.picked && values.model !== "", props: values.tray, provider: values.provider },
    values.tray,
  );
