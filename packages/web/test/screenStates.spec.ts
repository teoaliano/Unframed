import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { fixStateInstruction, mapFlowInstruction } from "@unframed/domain";
import { git } from "../../engine/test/gitRepos.ts";
import { engineChat, engineChats, FIXTURES } from "./agent.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";

test("a Screen's label reads as its branch and its route, or its state when it holds one", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const screen = page.locator("[data-testid=screen]");
    const label = screen.locator("[data-shape-label] [data-label-text]");
    const [first] = await screenShapes(engine, project);
    await expect(label).toHaveText(`${first.props.title} · /`);
    await putShapes(engine, project, [{ ...first, props: { ...first.props, state: "the menu open", steps: [{ action: "click", target: { role: "button", name: "Menu" } }] } }]);
    await expect(label).toHaveText(`${first.props.title} · the menu open`);
    await expect(screen).toHaveAttribute("data-state", "the menu open");
  });
});

const STATE = { state: "the menu open", steps: [{ action: "click", target: { role: "button", name: "Menu" } }], mocks: [{ url: "/api/items", status: 200, headers: {}, body: "[]", delay: 0 }] };

test("the branch chip's menu adds another view of the branch carrying the Screen's state, says which actions make a worktree, and never says Instance", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/menu", w: 390, h: 844, dials: { accent: "#00ff00" }, ...STATE } }]);
    await expect(page.locator("[data-testid=screen]")).toHaveAttribute("data-route", "/menu");
    await clickShape(page, first.id);
    const toolbar = page.getByTestId("selection-toolbar");
    await expect(toolbar.getByTestId("screen-branch")).toHaveText(first.props.title);
    await expect(toolbar.getByTestId("screen-branch")).toHaveAccessibleName(`Branch ${first.props.title}`);
    await expect(toolbar).not.toContainText("Instance");
    await toolbar.getByTestId("screen-branch").click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText(["Another view of this branch", "New branch and worktree…New worktree", "Open another branch…New worktree", "Changes", "Remove branch and worktree…"]);
    await expect(menu).not.toContainText("Instance");
    await menu.getByRole("menuitem", { name: "Another view of this branch" }).click();
    await expect.poll(async () => (await screenShapes(engine, project)).length).toBe(2);
    const view = (await screenShapes(engine, project)).find((shape) => shape.id !== first.id);
    expect(view).toMatchObject({ x: first.x + 390 + 80, y: first.y, props: { instance: first.props.instance, route: "/menu", w: 390, h: 844, dials: { accent: "#00ff00" }, ...STATE } });
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await screenShapes(engine, project)).length).toBe(1);
  });
});

test("Remove branch and worktree removes the Screen's worktree and branch, warning first when the branch has work that would be lost", async ({ page }) => {
  await withRepository(page, {}, async (engine, project, root) => {
    const [first] = await screenShapes(engine, project);
    const rpc = await engine.rpc();
    const made = await rpc.call("instances.create", { project, branch: "try/remove" });
    await rpc.call("instances.start", { project, id: made.id });
    await rpc.close();
    await writeFile(join(made.worktree, "draft.txt"), "draft\n");
    await putShapes(engine, project, [{ ...first, props: { ...first.props, instance: made.id, title: made.branch } }]);
    await clickShape(page, first.id);
    await expect(page.getByTestId("screen-branch-changes")).toHaveText("1", { timeout: 15_000 });
    await page.getByTestId("screen-branch").click();
    await page.getByRole("menuitem", { name: "Remove branch and worktree…" }).click();
    const panel = page.getByTestId("screen-branch-panel");
    await expect(panel).toContainText(`Deletes the worktree at ${made.worktree} and the branch try/remove.`);
    await panel.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(panel).toContainText('The worktree of "try/remove" has uncommitted changes. Remove it anyway to lose them.');
    await panel.getByRole("button", { name: "Remove anyway" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator("[data-testid=screen] [data-testid=screen-overlay]")).toHaveText("Worktree removed");
    expect(git(root, "branch", "--list", "try/remove").trim()).toBe("");
  });
});

const frameOf = (page: Page, shapeId?: string) => page.frameLocator(`${shapeId === undefined ? "[data-testid=screen]" : `[data-shape-id="${shapeId}"]`} iframe[data-screen-frame]`);

const selectScreen = async (page: Page, shapeId: string) => {
  await clickShape(page, shapeId);
  await expect(page.locator(`[data-shape-id="${shapeId}"] iframe[data-screen-frame]`)).toHaveAttribute("data-interactive", "true");
};

const blurFrame = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test("a live Screen follows the person's navigation inside it, back included, and undo brings it back", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/app" } }]);
    const screen = page.locator("[data-testid=screen]");
    await selectScreen(page, first.id);
    await expect(screen).toHaveAttribute("data-painted", "true");
    await frameOf(page).getByRole("link", { name: "About" }).dispatchEvent("click");
    await expect(screen).toHaveAttribute("data-route", "/app/about");
    await expect(screen.locator("[data-shape-label] [data-label-text]")).toHaveText(`${first.props.title} · /app/about`);
    await expect.poll(async () => (await screenShapes(engine, project))[0].props.route).toBe("/app/about");
    await expect(frameOf(page).locator("#where")).toHaveText("/app/about");

    await frameOf(page).locator("body").evaluate(() => history.back());
    await expect(screen).toHaveAttribute("data-route", "/app");
    await frameOf(page).getByRole("link", { name: "About" }).dispatchEvent("click");
    await expect(screen).toHaveAttribute("data-route", "/app/about");

    await blurFrame(page);
    await page.keyboard.press("Control+z");
    await expect(screen).toHaveAttribute("data-route", "/app");
    await expect(frameOf(page).locator("#where")).toHaveText("/app");
  });
});

const MENU_EMPTY = { state: "the menu open with no items", steps: [{ action: "click", target: { role: "button", name: "Menu" } }], mocks: [{ url: "/api/items", status: 200, headers: { "content-type": "application/json" }, body: "[]", delay: 0 }] };

test("a Screen holding a state replays its steps with its own mocks on every load, and navigating moves it to a plain page, undoably", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [
      { ...first, props: { ...first.props, route: "/app", w: 640, h: 480, ...MENU_EMPTY } },
      { ...first, id: "shape:plain", y: first.y + 600, props: { ...first.props, route: "/app", w: 640, h: 480 } },
    ]);
    const stateful = frameOf(page, first.id);
    await selectScreen(page, first.id);
    await expect(stateful.getByRole("menuitem", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
    await expect(stateful.locator("#list-state")).toHaveText("No items yet");
    await selectScreen(page, "shape:plain");
    await expect(frameOf(page, "shape:plain").locator("#list-state")).toHaveText("2 items");
    await expect(frameOf(page, "shape:plain").getByRole("menuitem", { name: "Settings" })).toBeHidden();

    await page.reload();
    await expect(page.locator(`[data-shape-id="${first.id}"] [data-testid=screen]`)).toBeVisible({ timeout: 30_000 });
    await selectScreen(page, first.id);
    await expect(frameOf(page, first.id).getByRole("menuitem", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
    await expect(frameOf(page, first.id).locator("#list-state")).toHaveText("No items yet");

    await selectScreen(page, first.id);
    await frameOf(page, first.id).getByRole("link", { name: "About" }).dispatchEvent("click");
    await expect.poll(async () => (await screenShapes(engine, project)).find((shape) => shape.id === first.id).props).toMatchObject({ route: "/app/about" });
    const moved = (await screenShapes(engine, project)).find((shape) => shape.id === first.id);
    expect(moved.props.steps).toBeUndefined();
    expect(moved.props.mocks).toBeUndefined();
    expect(moved.props.state).toBeUndefined();

    await blurFrame(page);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await screenShapes(engine, project)).find((shape) => shape.id === first.id).props).toMatchObject({ route: "/app", ...MENU_EMPTY });
    await expect(frameOf(page, first.id).getByRole("menuitem", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
  });
});

test("a selected Screen whose steps moved it to another page replays its state when the page reloads, and keeps its route", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    const elsewhere = { ...MENU_EMPTY, state: "the menu open on about", steps: [{ action: "click", target: { role: "link", name: "About" } }, ...MENU_EMPTY.steps] };
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/app", w: 640, h: 480, ...elsewhere } }]);
    const frame = frameOf(page, first.id);
    await selectScreen(page, first.id);
    await expect(frame.getByRole("menuitem", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
    await expect(frame.locator("#where")).toHaveText("/app/about");

    await frame.locator("body").evaluate((body) => {
      body.dataset.beforeReload = "true";
      setTimeout(() => location.reload(), 0);
    });
    await expect(frame.locator("body[data-before-reload]")).toHaveCount(0);
    await expect(frame.getByRole("menuitem", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
    await expect(frame.locator("#list-state")).toHaveText("No items yet");
    await expect(frame.locator("#where")).toHaveText("/app/about");
    expect((await screenShapes(engine, project)).find((shape) => shape.id === first.id).props).toMatchObject({ route: "/app", ...elsewhere });
  });
});

test("a Screen whose steps no longer work says Couldn't reach this state with the failed step, and its button asks the agent to fix them", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_AGENT_SCRIPT: FIXTURES }, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    const broken = { state: "the menu open", steps: [{ action: "click", target: { role: "button", name: "Menu" } }, { action: "click", target: { role: "button", name: "Missing" } }] };
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/app", ...broken } }]);
    await clickShape(page, first.id);
    const failed = page.locator("[data-testid=screen] [data-testid=screen-state-failed]");
    await expect(failed).toContainText("Couldn't reach this state", { timeout: 30_000 });
    await expect(failed.getByTestId("screen-state-failed-step")).toHaveText("Step 2, click button Missing, failed: nothing matched button Missing within 5 seconds of the page going quiet");
    await failed.getByRole("button", { name: "Ask the agent to fix it" }).click();
    await expect(failed.getByTestId("screen-state-asked")).toHaveText("Sent to the agent.");
    const chats = (await engineChats(engine, project)).filter((chat) => chat.title !== "Setup");
    expect(chats).toHaveLength(1);
    expect((await engineChat(engine, chats[0]!.id, project)).messages.find((message) => message.role === "user")?.text).toBe(
      fixStateInstruction({ shape: first.id.replace(/^shape:/, ""), branch: first.props.title, state: "the menu open", route: "/app", steps: broken.steps, mocks: undefined, number: 2, step: "click button Missing", reason: "nothing matched button Missing within 5 seconds of the page going quiet" }),
    );
  });
});

test("Keep this view leaves a copy of the Screen at its current page, size and Parameters beside it, without its state", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/app", w: 390, h: 844, dials: { accent: "#00ff00" }, ...MENU_EMPTY } }]);
    await expect(page.locator("[data-testid=screen]")).toHaveAttribute("data-route", "/app");
    await selectScreen(page, first.id);
    await page.getByTestId("selection-toolbar").getByRole("button", { name: "Keep this view" }).click();
    await expect.poll(async () => (await screenShapes(engine, project)).length).toBe(2);
    const kept = (await screenShapes(engine, project)).find((shape) => shape.id !== first.id);
    expect(kept).toMatchObject({ x: first.x + 390 + 80, y: first.y, props: { instance: first.props.instance, route: "/app", w: 390, h: 844, dials: { accent: "#00ff00" } } });
    expect(kept.props.steps).toBeUndefined();
    expect(kept.props.mocks).toBeUndefined();
    expect(kept.props.state).toBeUndefined();
  });
});

test("Map a Flow on a selected Screen asks the agent to map the flow from its state, with no route box anywhere", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_AGENT_SCRIPT: FIXTURES }, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/app", ...MENU_EMPTY } }]);
    await expect(page.locator("[data-testid=screen]")).toHaveAttribute("data-route", "/app");
    await clickShape(page, first.id);
    const toolbar = page.getByTestId("selection-toolbar");
    await expect(toolbar.getByRole("textbox")).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "Explode into a Flow" })).toHaveCount(0);
    await toolbar.getByRole("button", { name: "Map a Flow" }).click();
    await expect.poll(async () => (await engineChats(engine, project)).filter((chat) => chat.title !== "Setup").length).toBe(1);
    const [asked] = (await engineChats(engine, project)).filter((chat) => chat.title !== "Setup");
    const rpc = await engine.rpc();
    const instance = await rpc.call("instances.status", { project, id: first.props.instance });
    await rpc.close();
    expect((await engineChat(engine, asked!.id, project)).messages.find((message) => message.role === "user")?.text).toBe(
      mapFlowInstruction({ shape: first.id.replace(/^shape:/, ""), state: MENU_EMPTY.state, route: "/app", branch: instance.branch, worktree: instance.worktree }),
    );
  });
});
