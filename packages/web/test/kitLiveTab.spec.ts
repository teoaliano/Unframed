import type { FrameLocator, Page } from "@playwright/test";
import { TOKENS_TAG, type Kit } from "@unframed/domain";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
import { putRecords } from "./media.ts";

const kitWith = (dark: string): Kit => ({
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [{ path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark } }],
});

const writeKit = (engine: Parameters<typeof putRecords>[0], kit: Kit) =>
  putRecords(engine, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit } } }]);

const swatchPage = () =>
  `<!doctype html><html><head>${TOKENS_TAG}<style>body{margin:0}</style></head><body><div id="swatch" style="width:300px;height:200px;background:var(--color-brand-primary)"></div></body></html>`;

const showing = (tab: Page): FrameLocator => tab.frameLocator("iframe:not(.next)");
const swatchOf = (tab: Page) => showing(tab).locator("#swatch").evaluate((element) => getComputedStyle(element).backgroundColor);

test("a page opened in a new tab follows the kit mode and a new kit stamp, with no blank moment", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeKit(agent, kitWith("#8ab4f8"));
  await filledArtifact(agent, { id: "shape:brand", kind: "page", ref: "180", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Brand", html: swatchPage() });
  await expect(shapeOnScreen(page, "shape:brand")).toBeVisible();
  const at = await centre(shapeOnScreen(page, "shape:brand"));
  await page.mouse.dblclick(at.x, at.y);
  const opened = page.context().waitForEvent("page");
  await page.getByRole("region", { name: "Editing Brand" }).getByRole("button", { name: "Open in a new tab" }).click();
  const tab = await opened;
  await tab.waitForLoadState();
  await expect.poll(() => swatchOf(tab), { timeout: 10_000 }).toBe("rgb(26, 115, 232)");

  const editor = page.getByTestId("artifact-editor");
  await editor.getByRole("combobox", { name: "Kit mode" }).click();
  await page.getByRole("option", { name: "dark", exact: true }).click();
  await expect.poll(() => swatchOf(tab), { timeout: 10_000 }).toBe("rgb(138, 180, 248)");

  await writeKit(agent, kitWith("#188038"));
  await expect.poll(() => swatchOf(tab), { timeout: 10_000 }).toBe("rgb(24, 128, 56)");
  await expect(tab.locator("iframe")).toHaveCount(1);
});
