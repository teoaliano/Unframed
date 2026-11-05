import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isBareFileName, ResultRecipe, type CostBasis } from "@unframed/contracts";
import * as Schema from "effect/Schema";

const decodeRecipe = Schema.decodeUnknownOption(ResultRecipe);

/**
 * A result's sidecar and the recipe in it, or `undefined` when the file is gone, is not
 * JSON, or holds no readable recipe.
 */
export const readResultSidecar = async (
  folder: string,
  name: string,
): Promise<{ readonly sidecar: Record<string, unknown>; readonly recipe: ResultRecipe } | undefined> => {
  if (!isBareFileName(name)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(folder, name), "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const recipe = decodeRecipe((parsed as { recipe?: unknown }).recipe);
  return recipe._tag === "Some" ? { sidecar: parsed as Record<string, unknown>, recipe: recipe.value } : undefined;
};

export const patchSidecarCost = async (folder: string, name: string, priced: { readonly cost: number | null; readonly costBasis?: CostBasis }): Promise<void> => {
  if (!isBareFileName(name)) return;
  const path = join(folder, name);
  const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const { costBasis: _old, ...rest } = parsed;
  const next = { ...rest, cost: priced.cost, ...(priced.costBasis === undefined ? {} : { costBasis: priced.costBasis }) };
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
};
