import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { gatewayRoutes, VERCEL_KEY, type GatewayScript } from "../../engine/test/gatewayStub.ts";
import { imageCatalogue, imageGeneration, imagePricing, routes } from "../../engine/test/openRouterStub.ts";
import { openCanvas, roomShapes, toast } from "./canvas.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";
import { CATALOGUE, clickShape, composer, KEY, openComposer, PRICING, sendRun, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { openSettings, settingsButton, settingsDialog } from "./settings.ts";

const block = (dialog: Locator) => dialog.locator("section[aria-label='Vercel AI Gateway']");

const start = async (options: { openRouter?: boolean; vercel?: boolean; script?: GatewayScript } = {}) => {
  const gateway = gatewayRoutes(options.script);
  const images = imageGeneration(() => ({ kind: "image", bytes: pngBytes(96, 64), cost: 0.19 }));
  const lines = [...(options.openRouter === false ? [] : [`OPENROUTER_API_KEY=${KEY}`]), ...(options.vercel === false ? [] : [`AI_GATEWAY_API_KEY=${VERCEL_KEY}`])];
  const engine = await startHostedEngine({
    dotenv: lines.map((line) => `${line}\n`).join(""),
    env: { UNFRAMED_TEST_GATEWAY_LOOKUP_MS: "20" },
    stub: routes(imageCatalogue({ data: CATALOGUE }), imagePricing(PRICING), images.handler),
    vercel: gateway.handler,
  });
  return { engine, gateway, images: images.requests };
};

const providerSwitch = (page: Page) => composer(page).getByRole("radiogroup", { name: "Provider" });

const results = async (engine: Awaited<ReturnType<typeof start>>["engine"]) =>
  (await roomShapes(engine, "default", "image")).filter((shape) => shape.meta?.unframed?.result && shape.props.assetId);

test("Settings with an OpenRouter key: paste a gateway key, a bad one's error, the credits line, revoked, the two-step remove, and the Vercel default models", async ({ page }) => {
  const { engine, gateway } = await start({ vercel: false });
  try {
    await openCanvas(page, engine);
    let dialog = await openSettings(page);
    await expect(block(dialog).getByRole("heading", { name: "Vercel AI Gateway" })).toBeVisible();
    await expect(block(dialog).getByTestId("vercel-status")).toHaveText(
      "Make a key in the Vercel dashboard (AI Gateway, API Keys) and paste it here. Images and text are billed to that team's AI Gateway credits.",
    );
    await expect(block(dialog).getByTestId("vercel-instead")).toHaveCount(0);
    await expect(dialog.locator("[data-model-select='Image · Vercel']")).toHaveCount(0);

    await dialog.getByLabel("Vercel AI Gateway API key").fill("sk-or-v1-wrong");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText('That does not look like a Vercel AI Gateway key. Keys start with "vck_".')).toBeVisible();

    await dialog.getByLabel("Vercel AI Gateway API key").fill(VERCEL_KEY);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(block(dialog).getByTestId("vercel-status")).toHaveText("$95.50 of AI Gateway credit left on this Vercel team, $4.50 used so far.");
    await expect(dialog.getByLabel("Vercel AI Gateway API key")).toHaveValue("");
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toContain(`AI_GATEWAY_API_KEY=${VERCEL_KEY}\n`);
    await expect(dialog.locator("[data-model-select='Image · Vercel']")).toBeVisible();
    await expect(dialog.locator("[data-model-select='Text · Vercel']")).toBeVisible();

    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    gateway.calls.length = 0;
    engine.vercel!.setHandler(gatewayRoutes({ credits: () => ({ status: 401, body: { error: { message: "Invalid key" } } }) }).handler);
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

test("with no key: the gateway's line under OpenRouter, saving a first gateway key closes with its toast, and the gear names it", async ({ page }) => {
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
    await expect(dialog.locator("[data-model-select='Image · Vercel']")).toBeVisible();
    await expect(dialog.locator("[data-model-select='Image']")).toHaveCount(0);
  } finally {
    await engine.dispose();
  }
});

test("with both keys: the provider switch, the gateway's catalogue and price, a gateway result's line, the provider remembered, and Regenerate keeping it", async ({ page }) => {
  const { engine, gateway, images } = await start();
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
    expect(gateway.calls.some((call) => call.path === "/v1/images/generations" && call.body.model === "bfl/flux-2-pro")).toBe(true);
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
    expect(gateway.calls.filter((call) => call.path === "/v1/images/generations")).toHaveLength(2);

    await page.mouse.click(10, 400);
    await clickShape(page, "shape:starter-subject");
    await openComposer(page);
    await expect(providerSwitch(page).getByRole("radio", { name: "Vercel" })).toHaveAttribute("aria-checked", "true");
    // Regenerate's send is not a pick (spec 03), so the gateway's default model comes back.
    await expect(composer(page).getByTestId("model-chip")).toHaveText("gpt-image-2");
  } finally {
    await engine.dispose();
  }
});

test("with only a gateway key: no switch, image runs through it, and video says why it cannot", async ({ page }) => {
  const { engine, gateway } = await start({ openRouter: false });
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
    expect(gateway.calls.some((call) => call.path === "/v1/images/generations")).toBe(true);
  } finally {
    await engine.dispose();
  }
});

test("a recipe made through the gateway runs through OpenRouter once the gateway key is gone, and says so", async ({ page }) => {
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
  test("Save as recipe keeps the gateway, and the group's chip says Vercel", async ({ page }) => {
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

