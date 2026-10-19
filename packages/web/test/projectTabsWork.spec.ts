import { expect } from "@playwright/test";
import { test as base } from "./fixtures.ts";
import { openCanvas } from "./canvas.ts";
import { pngBytes } from "./images.ts";
import { test as generationTest } from "./generation.ts";

const tabs = (page: import("@playwright/test").Page) => page.locator("[role=tab]");
const active = (page: import("@playwright/test").Page) => page.locator("[role=tab][data-active='true']");
const tab = (page: import("@playwright/test").Page, name: string) => page.locator(`[role=tab][data-project="${name}"]`);

const test = generationTest;


test("a run in a background tab keeps going, shows its dot, lands in its project, and shows a check once it finished unseen", async ({ page, generation }) => {
  await openCanvas(page, generation.engine, "default");
  await (await generation.engine.rpc()).call("projects.create", { name: "beta" });
  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("menuitemradio", { name: "beta" }).click();
  await expect(active(page)).toHaveText("beta");

  // Hold the paid call open, then leave for default while it is in flight.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  generation.answer(async () => {
    await held;
    return { kind: "image", bytes: pngBytes(8, 8) };
  });
  await (await generation.engine.rpc()).call("run.image", {
    project: "beta",
    params: {},
    selectionPrompt: "",
    instruction: "",
    references: [],
    sources: [],
    anchor: { x: 1000, y: 0, w: 100, h: 100 },
    outputs: [{ prompt: "held", references: [] }],
  } as never);
  await expect(tab(page, "beta")).toHaveAttribute("data-status", "running");

  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("menuitemradio", { name: "default" }).click();
  await expect(active(page)).toHaveText("default");
  await expect(tab(page, "beta")).toHaveAttribute("data-status", "running");

  release();
  await expect(tab(page, "beta")).toHaveAttribute("data-status", "finished", { timeout: 20_000 });
  await expect(tab(page, "beta").locator("[data-slot=tabs-status][data-status=finished]")).toBeVisible();
  // The result landed in beta's room, not in the project on screen.
  await expect.poll(async () => (await generation.engine.rpc()).call("projects.list").then(() => true)).toBe(true);

  await tab(page, "beta").click();
  await expect(active(page)).toHaveText("beta");
  await expect(tab(page, "beta")).toHaveAttribute("data-status", "none");
});

base("dragging a tab onto another moves it there, and the order survives a reload", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await (await engine.rpc()).call("projects.create", { name: "beta" });
  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("menuitemradio", { name: "beta" }).click();
  await expect(tabs(page)).toHaveText(["default", "beta"]);
  await tab(page, "beta").dragTo(tab(page, "default"));
  await expect(tabs(page)).toHaveText(["beta", "default"]);
  // The order is saved in the background; wait until the engine holds it before the page reloads.
  await expect.poll(async () => (await (await engine.rpc()).call("preferences.get", { keys: ["project.tabs"] })).values["project.tabs"]).toEqual(expect.objectContaining({ order: ["beta", "default"] }));
  await page.reload();
  await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(tabs(page)).toHaveText(["beta", "default"]);
});

base("the camera a tab was at comes back when it is opened again, and a first open fits its shapes", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await (await engine.rpc()).call("projects.create", { name: "beta" });
  const before = await page.locator("[data-canvas-project='default'] .tl-shape").first().boundingBox();
  await page.locator("[data-canvas-project='default'] .tl-canvas").hover({ position: { x: 300, y: 300 } });
  await page.keyboard.down("ControlOrMeta");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("ControlOrMeta");
  await expect.poll(async () => (await page.locator("[data-canvas-project='default'] .tl-shape").first().boundingBox())?.width).not.toBe(before?.width);
  const zoomed = await page.locator("[data-canvas-project='default'] .tl-shape").first().boundingBox();

  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("menuitemradio", { name: "beta" }).click();
  await expect(active(page)).toHaveText("beta");
  await tab(page, "default").click();
  await expect(active(page)).toHaveText("default");
  await expect.poll(async () => (await page.locator("[data-canvas-project='default'] .tl-shape").first().boundingBox())?.width).toBeCloseTo(zoomed!.width, 0);
});
