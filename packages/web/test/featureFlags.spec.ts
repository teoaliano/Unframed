import { centre, emptyCanvasPoint, openCanvas, roomRecords, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, startAgentEngine, test as base } from "./agent.ts";
import { makeTempDir, type TestEngine } from "../../engine/test/engineProcess.ts";
import { filledArtifact } from "./artifacts.ts";
import { column, frameOf, region } from "./editorHarness.ts";
import { toolbar } from "./generation.ts";
import { clickShape, nodeCard, nodeShape, promptShape, seedBoard, wireShape } from "./nodes.ts";
import { makeRepo, repoEngineEnv } from "../../engine/test/gitRepos.ts";
import { startHostedEngine } from "./fixtures.ts";
import { prepareReactApp } from "../../engine/test/reactFixture.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";

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

test("with element editing off, the editor opens on the preview and a Parameters header set like the Agent one, with no Mode toggle and no tabs", async ({ page, plain }) => {
  await openCanvas(page, plain);
  await filledArtifact(plain, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(frameOf(page).getByRole("heading", { name: "Welcome" })).toBeVisible();
  const parameters = column(page, "parameters");
  await expect(parameters.getByRole("tablist")).toHaveCount(0);
  const heading = parameters.getByRole("heading", { level: 2, name: "Parameters" });
  await expect(heading).toBeVisible();
  const agent = column(page, "rail").getByRole("heading", { level: 2, name: "Agent" });
  const type = (target: typeof heading) => target.evaluate((el) => { const style = getComputedStyle(el); return [style.fontSize, style.fontWeight]; });
  expect(await type(heading)).toEqual(await type(agent));
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

test("with repositories off, a Repository opens read-only on its Screens' last snapshots, states included, with no Screen actions, no editor and no Setup", async ({ page }) => {
  const root = await makeRepo("shop");
  const dataDir = await makeTempDir();
  const on = await startHostedEngine({ dataDir, env: await repoEngineEnv({ UNFRAMED_TEST_RENDERER: "ok" }) });
  const onRpc = await on.rpc();
  const added = await onRpc.call("repositories.add", { path: root });
  const placed = ((await onRpc.call("testCanvas.read", { project: "shop" })).records as any[]).find((record) => record.type === "screen");
  const held = { route: "/app", state: "the menu open", steps: [{ action: "click", target: { role: "button", name: "Menu" } }], mocks: [{ url: "/api/items", status: 200, headers: {}, body: "[]", delay: 0 }] };
  await onRpc.call("testCanvas.apply", { project: "shop", change: { put: [{ ...placed, props: { ...placed.props, ...held } }], remove: [] }, origin: { kind: "server", id: "test" } });
  await expect.poll(async () => (await onRpc.call("instances.status", { project: "shop", id: added.instance.id })).state, { timeout: 30_000 }).toBe("stopped");
  await onRpc.call("instances.demand", { project: "shop", client: "window-1", ids: [added.instance.id] });
  await expect
    .poll(async () => ((await onRpc.call("testCanvas.read", { project: "shop" })).records as any[]).find((record) => record.type === "screen")?.props.picture, { timeout: 30_000 })
    .toMatch(/^[a-f0-9]{40}$/);
  await on.dispose();
  const off = await startHostedEngine({ dataDir, samplePrompts: false, env: await repoEngineEnv({ UNFRAMED_FEATURES: undefined, UNFRAMED_TEST_RENDERER: "ok" }) });
  try {
    const offRpc = await off.rpc();
    await offRpc.call("preferences.set", { key: "project.active", value: "shop" });
    await openCanvas(page, off, "shop");
    const screen = page.locator("[data-testid=screen]");
    await expect(screen.locator("[data-testid=screen-snapshot]")).toBeVisible();
    await expect(screen.locator("[data-testid=screen-snapshot]")).toHaveAttribute("src", /^\/api\/pictures\/shop\/[a-f0-9]{40}(\.w128|\.w384)?\.png$/);
    await expect(screen.locator("iframe")).toHaveCount(0);
    await expect(screen.locator("[data-testid=screen-overlay]")).toHaveCount(0);
    await expect(screen.locator("[data-testid=screen-state-failed]")).toHaveCount(0);
    await expect(screen.locator("[data-shape-label] [data-label-text]")).toHaveText(`${added.instance.branch} · the menu open`);
    const records = await roomRecords(off, "shop");
    expect(records.find((record) => record.type === "screen")!.props).toMatchObject(held);
    await clickShape(page, records.find((record) => record.type === "screen")!.id);
    await expect(toolbar(page)).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator("iframe[data-screen-frame]")).toHaveCount(0);
    await expect(screen.locator("[data-testid=screen-page-copy]")).toHaveCount(0);
    await expect(page.getByTestId("screen-route")).toHaveCount(0);
    await expect(page.getByTestId("screen-branch")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Duplicate", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("screens-starting")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Map a Flow" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show states" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Parameters" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Editor", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    const at = await centre(screen);
    await page.mouse.dblclick(at.x, at.y);
    await expect(page.getByTestId("artifact-editor")).toHaveCount(0);
    await expect(page.getByTestId("design-overlay")).toHaveCount(0);
    await expect(page.getByTestId("screen-design-panel")).toHaveCount(0);
    await expect(page.locator("[data-slot=top-bar] [role=tab][data-variant='secondary']")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "All projects" }).click();
    await expect(page.getByRole("menuitem", { name: "Run Setup again" })).toHaveCount(0);
    await expect(offRpc.call("instances.status", { project: "shop", id: added.instance.id })).rejects.toMatchObject({ message: "Repositories are not available in this build." });
  } finally {
    await off.dispose();
  }
});

test("with element editing off, a React Screen's editor has no Edit mode, nothing to select and no pending changes", async ({ page }) => {
  await withRepository(
    page,
    { UNFRAMED_FEATURES: "repositories" },
    async (engine, project) => {
      const [first] = await screenShapes(engine, project);
      await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/react" } }]);
      await clickShape(page, first.id);
      await page.getByRole("button", { name: "Editor", exact: true }).click();
      const editor = page.getByTestId("artifact-editor");
      const app = page.frameLocator('[data-screen-of][style*="visibility: visible"] iframe[data-screen-frame]');
      await expect(app.getByRole("heading", { name: "Agent" })).toBeVisible({ timeout: 30_000 });
      await expect(editor.getByRole("group", { name: "Mode" })).toHaveCount(0);
      await app.getByRole("heading", { name: "Agent" }).dispatchEvent("click");
      await expect(page.locator('[data-edit-outline="selected"]')).toHaveCount(0);
      await expect(editor.getByTestId("screen-drafts")).toHaveCount(0);
      await expect(editor.getByTestId("screen-source")).toHaveCount(0);
    },
    prepareReactApp,
  );
});

test("with element editing off, a double-click on a Screen opens its editor and never enters design mode", async ({ page }) => {
  await withRepository(
    page,
    { UNFRAMED_FEATURES: "repositories" },
    async (engine, project) => {
      const [first] = await screenShapes(engine, project);
      const at = await centre(page.locator(`[data-shape-id="${first.id}"] [data-testid=screen]`));
      await page.mouse.dblclick(at.x, at.y);
      await expect(page.getByTestId("artifact-editor")).toBeVisible();
      await expect(page.getByTestId("design-overlay")).toHaveCount(0);
      await expect(page.getByTestId("screen-design-panel")).toHaveCount(0);
    },
    prepareReactApp,
  );
});
