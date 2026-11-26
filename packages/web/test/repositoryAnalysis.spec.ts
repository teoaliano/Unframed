import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { showStatesInstruction } from "@unframed/domain";
import { git } from "../../engine/test/gitRepos.ts";
import { ROUTER_APP } from "../../engine/test/routerApp.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { engineChat, engineChats, openRail, scriptFolder, tabs } from "./agent.ts";
import { FIXTURES } from "./settings.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";

const SAVE = { name: "setup_save", input: { runCommand: "npm run dev", packageManager: "npm", files: [], mocks: [], warnings: [] } };

const writeInto = async (folder: string, files: Readonly<Record<string, string>>) => {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), content);
  }
};

const withRouterApp = async (root: string) => {
  await writeInto(root, ROUTER_APP);
  git(root, "add", ".");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "router app");
};

const instanceOf = async (engine: TestEngine, project: string, id: string) => {
  const rpc = await engine.rpc();
  try {
    return await rpc.call("instances.status", { project, id });
  } finally {
    await rpc.close();
  }
};

const frameNames = async (engine: TestEngine, project: string) => {
  const rpc = await engine.rpc();
  try {
    return ((await rpc.call("testCanvas.read", { project })).records as any[]).filter((record) => record.type === "frame").map((record) => record.props.name as string).sort();
  } finally {
    await rpc.close();
  }
};

const ANALYSIS = (prepared: ReadonlyArray<unknown>) => ({
  ".unframed/analysis/code-map.json": JSON.stringify({ version: 1, stack: { framework: "vite", router: "none", language: "js", styling: [], libraries: [] }, routes: [], dialogs: [], flags: [], features: [], notes: "" }),
  ".unframed/analysis/design-system.json": JSON.stringify({ version: 1, components: [], tokens: [] }),
  ".unframed/analysis/states.json": JSON.stringify({ version: 1, routes: [{ route: "/app", files: 1, cases: [], prepared }] }),
});

test("Looks right places a Screen for each page of the app, grouped by section", async ({ page }) => {
  const scripts = await scriptFolder({ setup: { when: "^Set up this Repository", turns: [{ text: "The Screen shows the app. Check it, please.", tools: [SAVE] }] } });
  await withRepository(
    page,
    { UNFRAMED_TEST_AGENT_SCRIPT: scripts },
    async (engine, project) => {
      const panel = await openRail(page);
      await tabs(page).filter({ hasText: "Setup" }).click();
      const card = panel.getByTestId("setup-card");
      await expect(card).toHaveAttribute("data-kind", "proposed", { timeout: 30_000 });
      await card.getByRole("button", { name: "Looks right" }).click();
      await expect.poll(async () => (await screenShapes(engine, project)).map((screen) => screen.props.route).sort(), { timeout: 30_000 }).toEqual(["/", "/app", "/posts"]);
      const shown = page.locator("[data-testid=screen]");
      await expect(shown).toHaveCount(3);
      await expect(page.locator("[data-testid=screen][data-route='/posts']")).toHaveCount(1);
      expect(await frameNames(engine, project)).toEqual(["App", "Posts"]);
    },
    withRouterApp,
  );
});

test("Show states lays out a route's prepared states beside its Screen, and asks the agent when the route has none", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_AGENT_SCRIPT: FIXTURES }, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    const instance = await instanceOf(engine, project, first.props.instance);
    await writeInto(instance.worktree, ANALYSIS([{ state: "an empty list", route: "/app", steps: [], mocks: [{ url: "/api/items", status: 200, headers: {}, body: "[]", delay: 0 }] }]));
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/app" } }]);
    await expect(page.locator("[data-testid=screen]")).toHaveAttribute("data-route", "/app");
    await clickShape(page, first.id);
    await page.getByTestId("selection-toolbar").getByRole("button", { name: "Show states" }).click();
    await expect.poll(async () => (await screenShapes(engine, project)).length).toBe(2);
    const placed = (await screenShapes(engine, project)).find((screen) => screen.id !== first.id);
    expect(placed.props).toMatchObject({ route: "/app", state: "an empty list", instance: first.props.instance });
    await expect(page.locator("[data-testid=screen][data-state='an empty list']")).toHaveCount(1);
    expect(await frameNames(engine, project)).toEqual(["/app states"]);

    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/settings" } }]);
    await expect(page.locator(`[data-testid=screen][data-route='/settings']`)).toHaveCount(1);
    await clickShape(page, first.id);
    await page.getByTestId("selection-toolbar").getByRole("button", { name: "Show states" }).click();
    await expect.poll(async () => (await engineChats(engine, project)).filter((chat) => chat.title !== "Setup").length).toBe(1);
    const [asked] = (await engineChats(engine, project)).filter((chat) => chat.title !== "Setup");
    expect((await engineChat(engine, asked!.id, project)).messages.find((message) => message.role === "user")?.text).toBe(
      showStatesInstruction({ shape: first.id.replace(/^shape:/, ""), route: "/settings", branch: instance.branch, worktree: instance.worktree, cases: 0 }),
    );
  });
});

test("a Screen shows what the Repository's mock files answer, and changes when a mock file changes", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    const instance = await instanceOf(engine, project, first.props.instance);
    const mock = (items: string[]) => `unframed.mock(({ http, data }) => {\n  const items = data("items", ${JSON.stringify(items)});\n  http.get("/api/items", () => items.all());\n});\n`;
    await writeInto(instance.worktree, { ".unframed/mocks/items.mock.js": mock(["Mocked"]) });
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/app" } }]);
    const frame = page.frameLocator("[data-testid=screen] iframe");
    await expect(frame.locator("#list-state")).toHaveText("1 items", { timeout: 60_000 });
    await expect(frame.locator("#items li")).toHaveText(["Mocked"]);
    await writeInto(instance.worktree, { ".unframed/mocks/items.mock.js": mock(["Mocked", "Again"]) });
    await expect(frame.locator("#items li")).toHaveText(["Mocked", "Again"], { timeout: 15_000 });
  });
});

test("Export patch saves the branch's changes as a patch that leaves Unframed's files out", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    const instance = await instanceOf(engine, project, first.props.instance);
    await writeFile(join(instance.worktree, "src", "pages", "pricing.html"), "<h1>Pricing</h1>\n");
    await writeInto(instance.worktree, { ".unframed/notes.txt": "mine\n" });
    await clickShape(page, first.id);
    await expect(page.getByTestId("screen-branch-changes")).toHaveText("2", { timeout: 15_000 });
    await page.getByTestId("screen-branch").click();
    await page.getByRole("menuitem", { name: "Changes (2)" }).click();
    await expect(page.getByTestId("changed-file")).toHaveText([".unframed/notes.txt+1 −0", "src/pages/pricing.html+1 −0"]);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export patch" }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe(`${instance.branch.replace(/[^A-Za-z0-9._-]+/g, "-")}.patch`);
    const text = await readFile((await saved.path())!, "utf8");
    expect(text).toContain("+<h1>Pricing</h1>");
    expect(text).not.toContain(".unframed");
  });
});
