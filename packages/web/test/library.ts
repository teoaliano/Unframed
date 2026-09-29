/** Browser-seam helpers for spec 06's library: presets written straight into `presets.json`, and the dialogs. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { canvasSchema } from "@unframed/contracts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { expect } from "./fixtures.ts";
import { groupRecord, inGroup, promptRecord } from "./media.ts";

export const presetsFile = (engine: TestEngine): string => join(engine.dataDir, "output", "presets.json");

/** Writes `entries` as the whole of `presets.json`, as another tab or an old app would. */
export const writePresets = async (engine: TestEngine, entries: unknown[] | string): Promise<void> => {
  await mkdir(join(engine.dataDir, "output"), { recursive: true });
  await writeFile(presetsFile(engine), typeof entries === "string" ? entries : JSON.stringify(entries, null, 2));
};

/** Content of one group named `name` holding one prompt, and anything else given. */
export const groupContent = (name: string, options: { recipe?: unknown; members?: unknown[]; assets?: unknown[]; text?: string } = {}) => {
  const group = { ...groupRecord("shape:preset-group", name, { x: 0, y: 0 }), meta: options.recipe ? { unframed: { recipe: options.recipe } } : {} };
  const members = options.members ?? [inGroup(promptRecord("shape:preset-prompt", "120", options.text ?? `the ${name} prompt`), "shape:preset-group", { x: 28, y: 56 })];
  return { schema: canvasSchema().serialize(), shapes: [group, ...members], rootShapeIds: [group.id], assets: options.assets ?? [], bindings: [] };
};

export const userPreset = (id: string, name: string, options: { savedAt?: string; summary?: string; needs?: string; recipe?: { medium: string }; content?: unknown } = {}) => ({
  format: 2,
  id,
  source: "user",
  ...(options.savedAt === undefined ? { savedAt: "2026-09-01T10:00:00.000Z" } : options.savedAt === "" ? {} : { savedAt: options.savedAt }),
  name,
  summary: options.summary ?? "",
  ...(options.needs === undefined ? {} : { needs: options.needs }),
  kind: options.recipe ? "recipe" : "group",
  ...(options.recipe ? { medium: options.recipe.medium } : {}),
  content: options.content ?? groupContent(name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), options.recipe ? { recipe: { ...options.recipe, model: "openai/gpt-image-2", params: {}, runs: 1 } } : {}),
});

export const libraryDialog = (page: Page): Locator => page.getByTestId("library");

/** Opens the Library from its button and waits for the list to be read. */
export const openLibrary = async (page: Page): Promise<Locator> => {
  await page.getByRole("button", { name: "Library" }).click();
  const dialog = libraryDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("preset").first()).toBeVisible();
  return dialog;
};

export const presetItem = (page: Page, name: string): Locator => libraryDialog(page).getByTestId("preset").filter({ has: page.getByTestId("preset-name").getByText(name, { exact: true }) });

export const shownNames = (page: Page): Promise<string[]> => libraryDialog(page).getByTestId("preset-name").allTextContents();
