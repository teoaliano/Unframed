import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isBareFileName, ResultRecipe } from "@unframed/contracts";
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
