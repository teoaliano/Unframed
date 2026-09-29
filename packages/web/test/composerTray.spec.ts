import type { Page } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { clickShape, composer, expect, openAndEscape, openComposer, sendRun, startGeneration, test, toolbar } from "./generation.ts";

const openOnSubject = async (page: Page) => {
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
};

const tray = (page: Page) => composer(page).getByTestId("composer-tray");
const chips = (page: Page) => tray(page).locator("[data-prop]");
const dialog = (page: Page) => page.getByRole("dialog");

const pickModel = async (page: Page, part: string) => {
  await tray(page).getByTestId("model-chip").click();
  await dialog(page).getByRole("button", { name: part, exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
};

test("the tray: the model chip, the default props the model declares, value menus with Remove, and + add prop", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await openOnSubject(page);
  await expect(tray(page).getByTestId("model-chip")).toHaveText("gpt-image-2");
  await tray(page).getByTestId("model-chip").hover();
  await expect(page.getByText("openai/gpt-image-2", { exact: true })).toBeVisible();
  await expect(chips(page)).toHaveText(["1K", "1:1", "low"]);

  // A chip's menu checks its value; picking another changes it.
  await chips(page).filter({ hasText: "low" }).click();
  const quality = page.getByRole("menu", { name: "Quality" });
  await expect(quality.getByRole("menuitemradio")).toHaveText(["low", "medium", "high", "auto"]);
  await expect(quality.getByRole("menuitemradio", { name: "low" })).toHaveAttribute("aria-checked", "true");
  await quality.getByRole("menuitemradio", { name: "high" }).click();
  await expect(chips(page)).toHaveText(["1K", "1:1", "high"]);

  // Remove takes it out of the tray.
  await chips(page).filter({ hasText: "1:1" }).click();
  await page.getByRole("menu", { name: "Ratio" }).getByRole("menuitem", { name: "Remove" }).click();
  await expect(chips(page)).toHaveText(["1K", "high"]);

  // + add prop lists the declared props not in the tray, with their values; picking one adds it and opens its menu.
  await tray(page).getByRole("button", { name: "+ add prop" }).click();
  const add = page.getByRole("menu", { name: "Add prop" });
  await expect(add.getByRole("menuitem")).toHaveText([/Ratio\s*1:1/, /Background\s*auto/, /Format\s*png/, /Runs\s*1/]);
  await add.getByRole("menuitem", { name: "Background auto" }).click();
  await expect(chips(page)).toHaveText(["1K", "high", "auto"]);
  await expect(page.getByRole("menu", { name: "Background" })).toBeVisible();
  await page.getByRole("menu", { name: "Background" }).getByRole("menuitemradio", { name: "transparent" }).click();
  await expect(chips(page)).toHaveText(["1K", "high", "transparent"]);

  // Esc closes an open menu first and leaves the composer open.
  await chips(page).filter({ hasText: "1K" }).click();
  await expect(page.getByRole("menu", { name: "Size" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Size" })).toHaveCount(0);
  await expect(composer(page)).toBeVisible();

  // With every declared prop in the tray, + add prop lists only Runs (spec 05), which is not a model trait.
  for (const [label, menu] of [
    ["Ratio 1:1", "Ratio"],
    ["Format png", "Format"],
  ] as const) {
    await tray(page).getByRole("button", { name: "+ add prop" }).click();
    await page.getByRole("menu", { name: "Add prop" }).getByRole("menuitem", { name: label }).click();
    // Picking a prop opens its value menu; Esc closes that menu, not the composer.
    const values = page.getByRole("menu", { name: menu });
    await expect(values).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(values).toHaveCount(0);
  }
  await tray(page).getByRole("button", { name: "+ add prop" }).click();
  await expect(page.getByRole("menu", { name: "Add prop" }).getByRole("menuitem")).toHaveText([/Runs\s*1/]);
  await page.keyboard.press("Escape");
});

test("a model that declares a single format still offers Format, and props reset on a model change", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await openOnSubject(page);
  await chips(page).filter({ hasText: "low" }).click();
  await page.getByRole("menu", { name: "Quality" }).getByRole("menuitemradio", { name: "high" }).click();
  await expect(chips(page)).toHaveText(["1K", "1:1", "high"]);

  await pickModel(page, "gemini-3-pro-image");
  await expect(tray(page).getByTestId("model-chip")).toHaveText("gemini-3-pro-image");
  await expect(chips(page)).toHaveText(["1:1"]);

  await pickModel(page, "recraft-v4");
  await expect(chips(page)).toHaveText([]);
  await tray(page).getByRole("button", { name: "+ add prop" }).click();
  await expect(page.getByRole("menu", { name: "Add prop" }).getByRole("menuitem")).toHaveText([/Format\s*svg/, /Runs\s*1/]);
  await page.keyboard.press("Escape");

  await pickModel(page, "gpt-image-2");
  await expect(chips(page)).toHaveText(["1K", "1:1", "low"]);
});

test("the model dialog: title, link, newest first, sorts, search, provider tokens, the current model, pick and close", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await openOnSubject(page);
  await tray(page).getByTestId("model-chip").click();
  const box = dialog(page);
  await expect(box.getByRole("heading", { name: "Image models" })).toBeVisible();
  await expect(box.getByRole("link", { name: "Browse on OpenRouter" })).toHaveAttribute("href", "https://openrouter.ai/models?output_modalities=image");
  await expect(box.getByRole("link", { name: "Browse on OpenRouter" })).toHaveAttribute("target", "_blank");

  const names = box.locator("tbody tr td:first-child");
  await expect(names).toHaveText(["gemini-3-pro-image", "gpt-image-2", "recraft-v4", "flux-2", "gpt-image-1-mini"]);
  await expect(box.locator('tr[data-model="openai/gpt-image-2"]').getByLabel("Current model")).toBeVisible();
  await expect(box.locator('tr[data-model="openai/gpt-image-1-mini"] td').nth(2)).toHaveText("");

  // Providers: the label from a colon name, the key without its ~, one hue each in key order.
  const tokens = box.locator("tbody tr td:nth-child(2) span");
  await expect(tokens).toHaveText(["Google", "OpenAI", "Recraft", "Black Forest Labs", "OpenAI"]);
  await expect(box.locator('tr[data-model="~black-forest-labs/flux-2"] [data-hue]')).toHaveAttribute("data-hue", "blue");
  await expect(box.locator('tr[data-model="google/gemini-3-pro-image"] [data-hue]')).toHaveAttribute("data-hue", "orange");
  await expect(box.locator('tr[data-model="openai/gpt-image-2"] [data-hue]')).toHaveAttribute("data-hue", "purple");
  await expect(box.locator('tr[data-model="recraft/recraft-v4"] [data-hue]')).toHaveAttribute("data-hue", "green");

  await box.getByRole("button", { name: "Model", exact: true }).click();
  await expect(names).toHaveText(["flux-2", "gemini-3-pro-image", "gpt-image-1-mini", "gpt-image-2", "recraft-v4"]);
  await box.getByRole("button", { name: "Model", exact: true }).click();
  await expect(names).toHaveText(["recraft-v4", "gpt-image-2", "gpt-image-1-mini", "gemini-3-pro-image", "flux-2"]);
  await box.getByRole("button", { name: "Provider", exact: true }).click();
  await expect(tokens).toHaveText(["Black Forest Labs", "Google", "OpenAI", "OpenAI", "Recraft"]);
  await box.getByRole("button", { name: "Released", exact: true }).click();
  await expect(names.first()).toHaveText("gemini-3-pro-image");

  const search = box.getByPlaceholder("Search models…");
  await expect(box.getByLabel("Search models")).toBeVisible();
  await search.fill("OPENAI/");
  await expect(names).toHaveText(["gpt-image-2", "gpt-image-1-mini"]);
  await search.fill("forest labs");
  await expect(names).toHaveText(["flux-2"]);
  await search.fill("nothing like this");
  await expect(box.getByText("No model matches. Clear the search.")).toBeVisible();
  await search.fill("");
  await box.getByRole("button", { name: "flux-2", exact: true }).click();
  await expect(box).toHaveCount(0);
  await expect(tray(page).getByTestId("model-chip")).toHaveText("flux-2");
});

test("Escape in the model dialog closes only the dialog", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await openOnSubject(page);
  await tray(page).getByTestId("model-chip").click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(composer(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);
});

test("an Escape the moment a tray menu, a value menu from + add prop, or the model dialog shows closes only that", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await openOnSubject(page);

  expect(await openAndEscape(tray(page).getByRole("button", { name: "+ add prop" }))).toBe("control");
  await expect(page.getByRole("menu", { name: "Add prop" })).toHaveCount(0);
  await expect(composer(page)).toBeVisible();

  expect(await openAndEscape(chips(page).filter({ hasText: "low" }))).toBe("control");
  await expect(page.getByRole("menu", { name: "Quality" })).toHaveCount(0);
  await expect(composer(page)).toBeVisible();

  // A prop picked from + add prop opens its value menu a frame later, while focus is still outside it.
  await tray(page).getByRole("button", { name: "+ add prop" }).click();
  const background = page.getByRole("menu", { name: "Add prop" }).getByRole("menuitem", { name: "Background auto" });
  expect(await openAndEscape(background, "Background")).not.toBe("opened");
  await expect(page.getByRole("menu", { name: "Background" })).toHaveCount(0);
  await expect(chips(page)).toHaveText(["1K", "1:1", "low", "auto"]);
  await expect(composer(page)).toBeVisible();

  // The dialog takes focus as it mounts, so this Esc lands inside it.
  await openAndEscape(tray(page).getByTestId("model-chip"));
  await expect(dialog(page)).toHaveCount(0);
  // The composer closes with the selection, so still showing means tldraw kept it.
  await expect(composer(page)).toBeVisible();
});

test("the estimate shows beside send only when exact, and a reply for a model no longer selected is dropped", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await openOnSubject(page);
  const estimate = composer(page).getByTestId("estimate");
  await expect(estimate).toHaveText("est. ~$0.011");
  await chips(page).filter({ hasText: "low" }).click();
  await page.getByRole("menu", { name: "Quality" }).getByRole("menuitemradio", { name: "high" }).click();
  await expect(estimate).toHaveText("est. ~$0.17");

  // Billed per token: no number at all.
  await pickModel(page, "gemini-3-pro-image");
  await expect(estimate).toHaveCount(0);

  // A slow reply for flux-2 lands after the person moved on to recraft-v4: it is not shown.
  const release = generation.holdPricing("~black-forest-labs/flux-2");
  await pickModel(page, "flux-2");
  await pickModel(page, "recraft-v4");
  await expect(estimate).toHaveText("est. ~$0.035");
  release();
  await page.waitForTimeout(300);
  await expect(estimate).toHaveText("est. ~$0.035");
});

test("the composer reopens on the last sent model and props; a model gone from the catalogue falls back to the default", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await openOnSubject(page);
  await pickModel(page, "flux-2");
  await chips(page).filter({ hasText: "1:1" }).click();
  await page.getByRole("menu", { name: "Ratio" }).getByRole("menuitemradio", { name: "4:3" }).click();
  await composer(page).getByRole("textbox", { name: "What should this make?" }).click();
  await page.keyboard.type("a sketchy fox");
  await sendRun(page);
  await expect.poll(async () => (await (await generation.engine.rpc()).call("preferences.get", { keys: ["lastUsed.image"] })).values).toEqual({
    "lastUsed.image": { model: "~black-forest-labs/flux-2", props: { aspect_ratio: "4:3" } },
  });

  await page.reload();
  await expect(page.locator("[data-canvas-project] .tl-canvas")).toBeVisible();
  await openOnSubject(page);
  await expect(tray(page).getByTestId("model-chip")).toHaveText("flux-2");
  await expect(chips(page)).toHaveText(["4:3"]);

  const rpc = await generation.engine.rpc();
  await rpc.call("preferences.set", { key: "lastUsed.image", value: { model: "gone/model", props: { quality: "high", aspect_ratio: "9:16" } } });
  await page.keyboard.press("Escape");
  await toolbar(page).getByRole("button", { name: "Generate" }).click();
  await expect(tray(page).getByTestId("model-chip")).toHaveText("gpt-image-2");
  await expect(chips(page)).toHaveText(["high"]);
});

test("a first composer with nothing stored opens on the defaults", async ({ page }) => {
  const generation = await startGeneration();
  try {
    await openCanvas(page, generation.engine);
    await openOnSubject(page);
    await expect(chips(page)).toHaveText(["1K", "1:1", "low"]);
  } finally {
    await generation.engine.dispose();
  }
});
