import type { FrameLocator } from "@playwright/test";
import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { clickShape, toolbar } from "./generation.ts";
import { dialsPage, filledArtifact, insideFrame, writeBridge } from "./artifacts.ts";
import { onBoard, openEditor, frameOf as editorFrame, region } from "./editorHarness.ts";

const STAMPED = "<!doctype html><body><p id='stamp'></p><script>document.getElementById('stamp').textContent = String(Math.random())</script></body>";

const stampOf = async (frame: FrameLocator): Promise<string> => {
  const stamp = frame.locator("#stamp");
  await expect(stamp).not.toBeEmpty({ timeout: 10_000 });
  return (await stamp.textContent())!;
};

const reloads = async (frame: () => FrameLocator, reload: () => Promise<void>) => {
  const before = await stampOf(frame());
  await reload();
  await expect.poll(() => stampOf(frame()), { timeout: 10_000 }).not.toBe(before);
};

test("Reload in the toolbar of a selected page loads it again, and its Parameters panel stays open", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [10, 0, 100] }).replace('<pre id="values">', "<p id='stamp'></p><script>document.getElementById('stamp').textContent = String(Math.random())</script><pre id=\"values\">") });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
  await clickShape(page, "shape:tuned");
  await toolbar(page).getByRole("button", { name: "Parameters" }).click();
  const panel = page.getByRole("region", { name: "Parameters for Tuned" });
  await expect(panel).toBeVisible();

  await reloads(() => insideFrame(page, "shape:tuned"), () => toolbar(page).getByRole("button", { name: "Reload" }).click());
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("slider", { name: "Size" })).toBeVisible();
  await expect(toolbar(page).getByRole("button", { name: "Parameters" })).toHaveAttribute("aria-pressed", "true");
});

test("Reload in the editor header loads the page again without leaving the editor", async ({ page, agent }) => {
  await onBoard(page, agent, STAMPED);
  await openEditor(page);
  await reloads(() => editorFrame(page), () => region(page).getByRole("button", { name: "Reload" }).click());
  await expect(region(page)).toBeVisible();
});

