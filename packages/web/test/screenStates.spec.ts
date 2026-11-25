import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../../engine/test/gitRepos.ts";
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
