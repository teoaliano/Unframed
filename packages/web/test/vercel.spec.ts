import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { vercelRoutes, VERCEL_KEY, type VercelScript } from "../../engine/test/vercelStub.ts";
import { imageCatalogue, imageGeneration, imagePricing, routes } from "../../engine/test/openRouterStub.ts";
import { openCanvas, roomShapes, toast } from "./canvas.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";
import { CATALOGUE, clickShape, composer, KEY, openComposer, PRICING, sendRun, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { openSettings, settingsButton, settingsDialog } from "./settings.ts";

const block = (dialog: Locator) => dialog.locator("section[aria-label='Vercel AI Gateway']");

const start = async (options: { openRouter?: boolean; vercel?: boolean; script?: VercelScript } = {}) => {
  const vercel = vercelRoutes(options.script);
  const images = imageGeneration(() => ({ kind: "image", bytes: pngBytes(96, 64), cost: 0.19 }));
  const lines = [...(options.openRouter === false ? [] : [`OPENROUTER_API_KEY=${KEY}`]), ...(options.vercel === false ? [] : [`AI_GATEWAY_API_KEY=${VERCEL_KEY}`])];
  const engine = await startHostedEngine({
    dotenv: lines.map((line) => `${line}\n`).join(""),
    env: { UNFRAMED_TEST_VERCEL_LOOKUP_MS: "20" },
    stub: routes(imageCatalogue({ data: CATALOGUE }), imagePricing(PRICING), images.handler),
    vercel: vercel.handler,
  });
  return { engine, vercel, images: images.requests };
};

const providerSwitch = (page: Page) => composer(page).getByRole("radiogroup", { name: "Provider" });

const results = async (engine: Awaited<ReturnType<typeof start>>["engine"]) =>
  (await roomShapes(engine, "default", "image")).filter((shape) => shape.meta?.unframed?.result && shape.props.assetId);

test("Settings with an OpenRouter key: paste a vercel key, a bad one's error, the credits line, revoked, the two-step remove, and the Vercel default models", async ({ page }) => {
  const { engine, vercel } = await start({ vercel: false });
  try {
    await openCanvas(page, engine);
    let dialog = await openSettings(page);
    await expect(block(dialog).getByRole("heading", { name: "Vercel AI Gateway" })).toBeVisible();
    await expect(block(dialog).getByTestId("vercel-status")).toHaveText(
      "Make a key in the Vercel dashboard (AI Gateway, API Keys) and paste it here. Images and text are billed to that team's AI Gateway credits.",
    );
    await expect(block(dialog).getByTestId("vercel-instead")).toHaveCount(0);
    await expect(dialog.locator("[data-model-select='Vercel image']")).toHaveCount(0);

    await dialog.getByLabel("Vercel AI Gateway API key").fill("sk-or-v1-wrong");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("That does not look like a Vercel AI Gateway key.")).toBeVisible();

    await dialog.getByLabel("Vercel AI Gateway API key").fill(VERCEL_KEY);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(block(dialog).getByTestId("vercel-status")).toHaveText("$95.50 of AI Gateway credit left on this Vercel team, $4.50 used so far.");
    await expect(dialog.getByLabel("Vercel AI Gateway API key")).toHaveValue("");
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toContain(`AI_GATEWAY_API_KEY=${VERCEL_KEY}\n`);
    await expect(dialog.locator("[data-model-select='Vercel image']")).toBeVisible();
    await expect(dialog.locator("[data-model-select='Vercel text']")).toBeVisible();

    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    vercel.calls.length = 0;
    engine.vercel!.setHandler(vercelRoutes({ credits: () => ({ status: 401, body: { error: { message: "Invalid key" } } }) }).handler);
    dialog = await openSettings(page);
    await expect(block(dialog).getByTestId("vercel-status")).toHaveText("This key no longer works at Vercel. It may have been revoked or its team member removed.");

    await block(dialog).getByRole("button", { name: "Remove key" }).click();
    await expect(block(dialog).getByTestId("vercel-warning")).toHaveText(
      "This deletes the Vercel AI Gateway key from .env. You will need to paste it again, or make a new one in the Vercel dashboard (AI Gateway, API Keys).",
    );
    await block(dialog).getByRole("button", { name: "Yes, remove it" }).click();
    await expect(block(dialog).getByTestId("vercel-warning")).toHaveText("Vercel AI Gateway key removed.");
    await expect(block(dialog).getByRole("button", { name: "Remove key" })).toHaveCount(0);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).not.toContain("AI_GATEWAY_API_KEY");
  } finally {
    await engine.dispose();
  }
});

test("with no key: the vercel's line under OpenRouter, saving a first vercel key closes with its toast, and the gear names it", async ({ page }) => {
  const { engine } = await start({ openRouter: false, vercel: false });
  try {
    await openCanvas(page, engine);
    let dialog = await openSettings(page);
    await expect(block(dialog).getByTestId("vercel-instead")).toHaveText(
      "No OpenRouter account? Images and text can run through the Vercel AI Gateway instead. Video still needs OpenRouter.",
    );
    await expect(dialog.getByTestId("elevenlabs-only-audio")).toHaveText(
      "Only want audio? Paste an ElevenLabs key here. Images and text need OpenRouter or the Vercel AI Gateway, and video needs OpenRouter.",
    );
    await expect(dialog.getByTestId("models-need-key")).toHaveText("Connect OpenRouter or paste a Vercel AI Gateway key to choose the models Generate starts on.");
    await dialog.getByLabel("Vercel AI Gateway API key").fill(VERCEL_KEY);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(settingsDialog(page)).toHaveCount(0);
    await expect(toast(page, "Vercel AI Gateway key saved. Images and text are ready to generate.")).toBeVisible();

    await settingsButton(page).hover();
    await expect(page.locator("[data-slot=tooltip-popup]")).toHaveText("Settings: Vercel key …wxyz, default models, output folder");
    dialog = await openSettings(page);
    await expect(dialog.getByTestId("elevenlabs-only-audio")).toHaveCount(0);
    await expect(dialog.locator("[data-model-select='Vercel image']")).toBeVisible();
    await expect(dialog.locator("[data-model-select='Image']")).toHaveCount(0);
  } finally {
    await engine.dispose();
  }
});

test("with both keys: the provider switch, the vercel's catalogue and price, a vercel result's line, the provider remembered, and Regenerate keeping it", async ({ page }) => {
  const { engine, vercel, images } = await start();
  try {
    await openCanvas(page, engine);
    await clickShape(page, "shape:starter-subject");
    await openComposer(page);
    await expect(providerSwitch(page).getByRole("radio")).toHaveText(["OpenRouter", "Vercel"]);
    await expect(providerSwitch(page).getByRole("radio", { name: "OpenRouter" })).toHaveAttribute("aria-checked", "true");
    await expect(composer(page).getByTestId("model-chip")).toHaveText("gpt-image-2");

    await providerSwitch(page).getByRole("radio", { name: "Vercel" }).click();
    await expect(composer(page).getByTestId("model-chip")).toHaveText("gpt-image-2");
    await expect(composer(page).locator("[data-prop]")).toHaveCount(0);
    await composer(page).getByTestId("model-chip").click();
    const models = page.getByRole("dialog");
    await expect(models.getByRole("link", { name: "Browse on Vercel" })).toHaveAttribute("href", "https://vercel.com/ai-gateway/models?type=image");
    await models.getByRole("button", { name: "flux-2-pro", exact: true }).click();
    await expect(models).toHaveCount(0);
    await expect(composer(page).getByTestId("model-chip")).toHaveText("flux-2-pro");
    await expect(composer(page).getByTestId("estimate")).toHaveText("est. ~$0.030");

    await sendRun(page);
    await expect.poll(async () => (await results(engine)).length).toBe(1);
    expect(vercel.calls.some((call) => call.path === "/v1/images/generations" && call.body.model === "bfl/flux-2-pro")).toBe(true);
    expect(images).toHaveLength(0);
    const [made] = await results(engine);
    await page.mouse.click(10, 400);
    await clickShape(page, made!.id);
    await expect(toolbar(page).getByTestId("result-line")).toHaveText("flux-2-pro · 40×20 · ≈$0.0300 · Vercel");

    await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
    await expect(providerSwitch(page).getByRole("radio", { name: "Vercel" })).toHaveAttribute("aria-checked", "true");
    await expect(composer(page).getByTestId("model-chip")).toHaveText("flux-2-pro");
    await sendRun(page);
    await expect.poll(async () => (await results(engine)).length).toBe(2);
    expect(vercel.calls.filter((call) => call.path === "/v1/images/generations")).toHaveLength(2);

    await page.mouse.click(10, 400);
    await clickShape(page, "shape:starter-subject");
    await openComposer(page);
    await expect(providerSwitch(page).getByRole("radio", { name: "Vercel" })).toHaveAttribute("aria-checked", "true");
    await expect(composer(page).getByTestId("model-chip")).toHaveText("flux-kontext-pro");
  } finally {
    await engine.dispose();
  }
});

test("with only a vercel key: no switch, image runs through it, and video says why it cannot", async ({ page }) => {
  const { engine, vercel } = await start({ openRouter: false });
  try {
    await openCanvas(page, engine);
    await clickShape(page, "shape:starter-subject");
    await openComposer(page);
    await expect(providerSwitch(page)).toHaveCount(0);
    await expect(composer(page).getByTestId("no-key-blocker")).toHaveCount(0);
    await composer(page).getByRole("radio", { name: "video" }).click();
    await expect(composer(page).getByTestId("no-key-blocker")).toContainText(
      "Video runs through OpenRouter only: the Vercel AI Gateway has no video API Unframed can call. Connect OpenRouter in Settings to make video.",
    );
    await composer(page).getByRole("radio", { name: "image" }).click();
    await sendRun(page);
    await expect.poll(async () => (await results(engine)).length).toBe(1);
    expect(vercel.calls.some((call) => call.path === "/v1/images/generations")).toBe(true);
  } finally {
    await engine.dispose();
  }
});

test("a recipe made through Vercel runs through OpenRouter once Vercel key is gone, and says so", async ({ page }) => {
  const { engine, images } = await start();
  try {
    await openCanvas(page, engine);
    await clickShape(page, "shape:starter-subject");
    await openComposer(page);
    await providerSwitch(page).getByRole("radio", { name: "Vercel" }).click();
    await expect(composer(page).getByTestId("model-chip")).toHaveText("gpt-image-2");
    await sendRun(page);
    await expect.poll(async () => (await results(engine)).length).toBe(1);
    await (await engine.rpc()).call("settings.removeVercelKey");

    const [made] = await results(engine);
    await page.mouse.click(10, 400);
    await clickShape(page, made!.id);
    await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
    await expect(providerSwitch(page)).toHaveCount(0);
    await expect(composer(page).getByText("Made through the Vercel AI Gateway, which has no key now. This run goes through OpenRouter.")).toBeVisible();
    await sendRun(page);
    await expect.poll(() => images.length).toBe(1);
  } finally {
    await engine.dispose();
  }
});

test.describe("recipe groups", () => {
  test("Save as recipe keeps the vercel, and the group's chip says Vercel", async ({ page }) => {
    const { engine } = await start();
    try {
      await openCanvas(page, engine);
      await clickShape(page, "shape:starter-subject");
      await page.keyboard.press("ControlOrMeta+g");
      await openComposer(page);
      await providerSwitch(page).getByRole("radio", { name: "Vercel" }).click();
      await expect(composer(page).getByTestId("model-chip")).toHaveText("gpt-image-2");
      await composer(page).getByRole("button", { name: "Save as recipe" }).click();
      await expect(composer(page).getByTestId("recipe-line")).toContainText("Recipe of @");
      await expect.poll(async () => (await roomShapes(engine, "default", "frame"))[0]?.meta?.unframed?.recipe?.provider).toBe("vercel");
    } finally {
      await engine.dispose();
    }
  });
});


test("switching provider resets the props to what the new model declares, so no hidden OpenRouter setting reaches a Vercel run or the last-used values", async ({ page }) => {
  const { engine, vercel } = await start();
  try {
    await openCanvas(page, engine);
    await clickShape(page, "shape:starter-subject");
    await openComposer(page);
    await expect(composer(page).locator("[data-prop]")).not.toHaveCount(0);
    await providerSwitch(page).getByRole("radio", { name: "Vercel" }).click();
    await expect(composer(page).getByTestId("model-chip")).toHaveText("gpt-image-2");
    await expect(composer(page).locator("[data-prop]")).toHaveCount(0);
    await sendRun(page);
    await expect.poll(async () => (await results(engine)).length).toBe(1);
    const [made] = await results(engine);
    const sidecar = JSON.parse((await engine.request(`/api/file/default/${made!.meta.unframed.result.sidecar}`)).text);
    expect(sidecar.recipe).toMatchObject({ provider: "vercel", params: {} });
    expect(vercel.calls.find((call) => call.path === "/v1/images/generations")!.body).toEqual({ model: "openai/gpt-image-2", prompt: expect.any(String), n: 1, response_format: "b64_json" });
    const stored = (await (await engine.rpc()).call("preferences.get", { keys: ["lastUsed.image"] })).values["lastUsed.image"] as { provider?: string; props?: Record<string, unknown> };
    expect(stored.provider).toBe("vercel");
    expect(Object.keys(stored.props ?? {}).filter((key) => key !== "runs")).toEqual([]);
  } finally {
    await engine.dispose();
  }
});

test("a text run through Vercel: its catalogue in the model dialog, the chat call, and the result's label with its measured cost", async ({ page }) => {
  const { engine, vercel } = await start();
  try {
    await openCanvas(page, engine);
    await clickShape(page, "shape:starter-subject");
    await openComposer(page);
    await composer(page).getByRole("radiogroup", { name: "Medium" }).getByRole("radio", { name: "text" }).click();
    await providerSwitch(page).getByRole("radio", { name: "Vercel" }).click();
    await expect(composer(page).getByTestId("model-chip")).toHaveText("gemini-3.5-flash-lite");
    await composer(page).getByTestId("model-chip").click();
    const models = page.getByRole("dialog");
    await expect(models.getByRole("link", { name: "Browse on Vercel" })).toHaveAttribute("href", "https://vercel.com/ai-gateway/models?type=language");
    await expect(models.locator("tbody tr td:first-child")).toHaveText(["gemini-3.5-flash-lite"]);
    await page.keyboard.press("Escape");
    await expect(models).toHaveCount(0);
    await composer(page).getByRole("button", { name: "Run", exact: true }).click();
    await expect(composer(page)).toHaveCount(0);
    await expect.poll(() => vercel.calls.filter((call) => call.path === "/v1/chat/completions").length).toBe(1);
    await expect(page.getByText("$0.0004 · Vercel · @", { exact: false })).toBeVisible();
  } finally {
    await engine.dispose();
  }
});
