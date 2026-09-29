import { describe, expect, it } from "vitest";
import { readGroupRecipe, recipeChip, recipeEquals, recipeFromTray, trayFromRecipe, type GroupRecipe, type RecipeTray } from "../src/index.ts";

describe("recipeFromTray and trayFromRecipe", () => {
  it.each<[string, RecipeTray, GroupRecipe]>([
    [
      "image: the model-driven props are params, Runs is the recipe's runs",
      { medium: "image", model: "openai/gpt-image-2", props: { quality: "high", aspect_ratio: "2:3", runs: 3 } },
      { medium: "image", model: "openai/gpt-image-2", params: { quality: "high", aspect_ratio: "2:3" }, runs: 3 },
    ],
    [
      "image with no Runs in the tray makes one",
      { medium: "image", model: "openai/gpt-image-2", props: { resolution: "1K" } },
      { medium: "image", model: "openai/gpt-image-2", params: { resolution: "1K" }, runs: 1 },
    ],
    [
      "image in Free keeps View final prompt when it is on",
      { medium: "image", model: "openai/gpt-image-2", props: { runs: "free", viewFinalPrompt: true } },
      { medium: "image", model: "openai/gpt-image-2", params: { viewFinalPrompt: true }, runs: "free" },
    ],
    [
      "video: every tray value, the share consent included; always one run",
      { medium: "video", model: "google/veo-3", props: { inputMode: "reference", duration: "5", resolution: "720p", shareLocalVideos: false } },
      { medium: "video", model: "google/veo-3", params: { inputMode: "reference", duration: "5", resolution: "720p", shareLocalVideos: false }, runs: 1 },
    ],
    ["text: the model alone", { medium: "text", model: "google/gemini-3-flash", props: {} }, { medium: "text", model: "google/gemini-3-flash", params: {}, runs: 1 }],
  ])("%s", (_case, tray, recipe) => {
    expect(recipeFromTray(tray)).toEqual(recipe);
    expect(recipeFromTray(trayFromRecipe(recipe))).toEqual(recipe);
  });

  it("puts Runs back in the tray only when it is not 1", () => {
    expect(trayFromRecipe({ medium: "image", model: "m", params: { quality: "low" }, runs: 1 })).toEqual({ medium: "image", model: "m", props: { quality: "low" } });
    expect(trayFromRecipe({ medium: "image", model: "m", params: {}, runs: "free" })).toEqual({ medium: "image", model: "m", props: { runs: "free" } });
  });

  it("drops View final prompt once Runs is a count, and a stale off value", () => {
    expect(recipeFromTray({ medium: "image", model: "m", props: { runs: 4, viewFinalPrompt: true } }).params).toEqual({});
    expect(recipeFromTray({ medium: "image", model: "m", props: { runs: "free", viewFinalPrompt: false } }).params).toEqual({});
  });

  it("never carries an instruction or anything that is not medium, model, params and runs", () => {
    const recipe = recipeFromTray({ medium: "image", model: "m", props: { quality: "low" } });
    expect(Object.keys(recipe).sort()).toEqual(["medium", "model", "params", "runs"]);
    const stored = readGroupRecipe({ medium: "image", model: "m", params: {}, runs: 2, instruction: "a fox", references: [] });
    expect(stored).toEqual({ medium: "image", model: "m", params: {}, runs: 2 });
    expect(Object.keys(trayFromRecipe(stored!)).sort()).toEqual(["medium", "model", "props"]);
  });
});

describe("readGroupRecipe", () => {
  it.each<[string, unknown, GroupRecipe | undefined]>([
    ["a whole recipe", { medium: "text", model: "x/y", params: {}, runs: 1 }, { medium: "text", model: "x/y", params: {}, runs: 1 }],
    ["Free", { medium: "image", model: "x/y", params: { quality: "low" }, runs: "free" }, { medium: "image", model: "x/y", params: { quality: "low" }, runs: "free" }],
    ["runs out of range is clamped", { medium: "image", model: "x/y", params: {}, runs: 40 }, { medium: "image", model: "x/y", params: {}, runs: 10 }],
    ["video and text always make one", { medium: "video", model: "x/y", params: {}, runs: 3 }, { medium: "video", model: "x/y", params: {}, runs: 1 }],
    ["params that are not plain values are left out", { medium: "image", model: "x/y", params: { a: "1", b: { c: 1 } }, runs: 1 }, { medium: "image", model: "x/y", params: { a: "1" }, runs: 1 }],
    ["no medium", { model: "x/y", params: {}, runs: 1 }, undefined],
    ["no model", { medium: "image", params: {}, runs: 1 }, undefined],
    ["not a record", "image", undefined],
  ])("%s", (_case, value, expected) => {
    expect(readGroupRecipe(value)).toEqual(expected);
  });
});

describe("recipeEquals", () => {
  const recipe: GroupRecipe = { medium: "image", model: "openai/gpt-image-2", params: { quality: "high", aspect_ratio: "2:3" }, runs: 3 };

  it("is equal whatever the order of params", () => {
    expect(recipeEquals(recipe, { ...recipe, params: { aspect_ratio: "2:3", quality: "high" } })).toBe(true);
  });

  it.each<[string, GroupRecipe]>([
    ["another medium", { ...recipe, medium: "video" }],
    ["another model", { ...recipe, model: "google/gemini-3-pro-image" }],
    ["another value", { ...recipe, params: { quality: "low", aspect_ratio: "2:3" } }],
    ["a param more", { ...recipe, params: { ...recipe.params, background: "auto" } }],
    ["a param less", { ...recipe, params: { quality: "high" } }],
    ["other runs", { ...recipe, runs: 1 }],
    ["Free", { ...recipe, runs: "free" }],
  ])("differs with %s", (_case, other) => {
    expect(recipeEquals(recipe, other)).toBe(false);
  });

  it("reads a number and the same number as text as different values", () => {
    expect(recipeEquals({ ...recipe, params: { duration: 5 } }, { ...recipe, params: { duration: "5" } })).toBe(false);
  });
});

describe("recipeChip", () => {
  it.each<[string, GroupRecipe, string]>([
    ["the model without its provider, an exact square size and the runs", { medium: "image", model: "openai/gpt-image-2", params: { size: "1024x1024" }, runs: 3 }, "gpt-image-2 · 1024² · ×3"],
    ["an exact size that is not square", { medium: "image", model: "openai/gpt-image-2", params: { size: "1024x1536" }, runs: 1 }, "gpt-image-2 · 1024×1536"],
    ["the ratio when no exact size is set", { medium: "image", model: "openai/gpt-image-2", params: { aspect_ratio: "2:3", quality: "high" }, runs: 1 }, "gpt-image-2 · 2:3"],
    ["an exact size wins over the ratio", { medium: "image", model: "openai/gpt-image-2", params: { size: "512x512", aspect_ratio: "2:3" }, runs: 1 }, "gpt-image-2 · 512²"],
    ["nothing for size when neither is set", { medium: "image", model: "openai/gpt-image-2", params: { quality: "low" }, runs: 2 }, "gpt-image-2 · ×2"],
    ["Free", { medium: "image", model: "openai/gpt-image-2", params: { aspect_ratio: "1:1" }, runs: "free" }, "gpt-image-2 · 1:1 · Free"],
    ["a model with no provider prefix", { medium: "image", model: "local-model", params: {}, runs: 1 }, "local-model"],
    ["video: the duration then the resolution", { medium: "video", model: "google/veo-3", params: { duration: 5, resolution: "720p" }, runs: 1 }, "veo-3 · 5s · 720p"],
    ["video: a duration held as text", { medium: "video", model: "google/veo-3", params: { duration: "8" }, runs: 1 }, "veo-3 · 8s"],
    ["video: the resolution alone", { medium: "video", model: "google/veo-3", params: { resolution: "1080p", aspect_ratio: "16:9" }, runs: 1 }, "veo-3 · 1080p"],
    ["text: the model alone", { medium: "text", model: "google/gemini-3-flash", params: { aspect_ratio: "1:1" }, runs: 1 }, "gemini-3-flash"],
  ])("%s", (_case, recipe, chip) => {
    expect(recipeChip(recipe)).toBe(chip);
  });
});
