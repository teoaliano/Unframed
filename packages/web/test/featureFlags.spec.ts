import { centre, emptyCanvasPoint, openCanvas, roomRecords, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, startAgentEngine, test as base } from "./agent.ts";
import { makeTempDir, type TestEngine } from "../../engine/test/engineProcess.ts";
import { filledArtifact } from "./artifacts.ts";
import { column, frameOf, region } from "./editorHarness.ts";
import { toolbar } from "./generation.ts";
import { clickShape, nodeCard, nodeShape, promptShape, seedBoard, wireShape } from "./nodes.ts";
import { makeRepo } from "../../engine/test/gitRepos.ts";
import { startHostedEngine } from "./fixtures.ts";

const test = base.extend<{ plain: TestEngine }>({
  plain: async ({}, use) => {
    const engine = await startAgentEngine({ env: { UNFRAMED_FEATURES: undefined } });
    await use(engine);
    await engine.dispose();
  },
});

test("with nodes off, Node is in neither add menu, and an existing node and wire show read-only", async ({ page, plain }) => {
  await openCanvas(page, plain);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["Prompt", "Image", "Video", "Audio", "Group", "Page", "Motion"]);
  await page.keyboard.press("Escape");
  const empty = await emptyCanvasPoint(page);
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await expect(page.getByRole("menuitem", { name: "Image", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Node", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await seedBoard(plain, [
    promptShape("fox", "201", "a lone red fox", { x: -440, y: 0 }),
    nodeShape("n", "202", { medium: "image", instruction: "a fox in snow" }, { x: 120, y: -60 }),
    wireShape("w", "fox", "n", "prompt"),
  ]);
  await clickShape(page, "shape:fox");
  await expect(toolbar(page)).toBeVisible();
  await expect(page.getByTestId("wire-handle")).toHaveCount(0);

  const card = nodeCard(page, "n");
  await expect(card.getByTestId("node-instruction")).toHaveText("a fox in snow");
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + box.width - 24, box.y + 14);
  await expect(card).not.toHaveAttribute("data-node-live", "true");
  await expect(card.getByTestId("node-editor")).toHaveCount(0);
  await expect(page.getByTestId("toolbar-node-run")).toHaveCount(0);
  await expect(page.getByTestId("toolbar-chain-run")).toHaveCount(0);
  await expect(page.getByTestId("wire-chip")).toHaveText("prompt");
  await expect(page.getByTestId("wire-chip").getByRole("button")).toHaveCount(0);

  await page.keyboard.press("Delete");
  await waitForRoom(plain, "default", (records) => (records.some((record) => record.id === "shape:n") ? undefined : true));
  expect((await roomRecords(plain, "default")).filter((record) => record.type === "wire")).toHaveLength(0);
});

const PAGE = `<!doctype html><html><body><main><h1>Welcome</h1></main></body></html>`;

test("with element editing off, the editor opens on the preview and Parameters, with no Mode toggle and no Design or Layers tab", async ({ page, plain }) => {
  await openCanvas(page, plain);
  await filledArtifact(plain, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(frameOf(page).getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(column(page, "parameters").getByRole("tablist").getByRole("tab")).toHaveText(["Parameters"]);
  await expect(region(page).getByRole("group", { name: "Mode" })).toHaveCount(0);
  await region(page).getByTestId("artifact-editor-title").click();
  await page.keyboard.press("v");
  await expect(region(page).getByRole("group", { name: "Mode" })).toHaveCount(0);
});

test("with repositories off, the project menu offers Add project alone and still lists an existing Repository with its kind", async ({ page }) => {
  const root = await makeRepo("shop");
  const dataDir = await makeTempDir();
  const on = await startHostedEngine({ dataDir });
  await (await on.rpc()).call("repositories.add", { path: root });
  await on.dispose();
  const off = await startHostedEngine({ dataDir, samplePrompts: false, env: { UNFRAMED_FEATURES: undefined } });
  try {
    await openCanvas(page, off, "default");
    await page.getByRole("button", { name: "All projects" }).click();
    await expect(page.locator("[role=menuitem], [role=menuitemradio]")).toHaveText(["default", "shop", "Add project"]);
    await expect(page.getByRole("menuitemradio", { name: "shop" }).getByLabel("Repository")).toBeVisible();
    await page.getByRole("menuitemradio", { name: "shop" }).click();
    await expect(page.locator("[role=tab][data-active='true']")).toHaveText("shop");
    await page.getByRole("button", { name: "All projects" }).click();
    await expect(page.locator("[role=menuitem], [role=menuitemradio]")).toHaveText(["default", "shop", "Add project"]);
  } finally {
    await off.dispose();
  }
});
