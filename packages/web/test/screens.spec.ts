import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page } from "@playwright/test";
import { git, makeRepo, repoEngineEnv } from "../../engine/test/gitRepos.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas } from "./canvas.ts";
import { clickShape } from "./generation.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";

const withRepository = async (page: Page, env: Record<string, string>, use: (engine: TestEngine, project: string, root: string) => Promise<void>, prepare?: (root: string) => Promise<void>) => {
  const root = await makeRepo("My App");
  await prepare?.(root);
  const engine = await startHostedEngine({ env: await repoEngineEnv({ UNFRAMED_TEST_PICK_FOLDER: root, ...env }) });
  try {
    await openCanvas(page, engine, "default");
    await page.getByRole("button", { name: "All projects" }).click();
    await page.getByRole("menuitem", { name: "Add Repository…" }).click();
    await expect(page.locator("[data-canvas-project='my-app'] .tl-canvas")).toBeVisible();
    await use(engine, "my-app", root);
  } finally {
    await engine.dispose();
  }
};

const screenShapes = async (engine: TestEngine, project: string) => {
  const rpc = await engine.rpc();
  try {
    return ((await rpc.call("testCanvas.read", { project })).records as any[]).filter((record) => record.typeName === "shape" && record.type === "screen");
  } finally {
    await rpc.close();
  }
};

test("a new Repository's first Screen goes live through the proxy at /, keeps its snapshot until first paint, and drops to the snapshot off screen", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    const screen = page.locator("[data-testid=screen]");
    await expect(screen).toHaveCount(1);
    await expect(screen).toHaveAttribute("data-route", "/");
    const frame = screen.locator("iframe[data-screen-frame]");
    await expect(frame).toHaveAttribute("src", /^http:\/\/127\.0\.0\.1:\d+\/$/, { timeout: 30_000 });
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-modals");
    await expect(frame).toHaveAttribute("allow", "");
    await expect(page.frameLocator("[data-testid=screen] iframe[data-screen-frame]").getByRole("heading", { name: "Fake app" })).toBeVisible();
    await expect(screen).toHaveAttribute("data-painted", "true");
    await expect(frame).toHaveCSS("pointer-events", "none");

    await clickShape(page, (await screenShapes(engine, project))[0].id);
    await expect(frame).toHaveCSS("pointer-events", "auto");
    await expect(screen.locator("[data-testid=screen-snapshot]")).toHaveCount(0);
    await page.keyboard.press("Escape");

    const width = page.viewportSize()!.width;
    await page.mouse.move(640, 360);
    for (let step = 0; step < 80; step++) {
      await page.mouse.wheel(width / 10, 0);
      await page.waitForTimeout(16);
    }
    await expect(screen.locator("iframe")).toHaveCount(0);
    await expect(screen.locator("[data-testid=screen-snapshot]")).toHaveCount(1);
    expect((await screenShapes(engine, project))[0].props).toMatchObject({ route: "/", w: 1280, h: 800 });
  });
});

const saveSetup = (engine: TestEngine, project: string, setup: Record<string, unknown>) => {
  const db = new DatabaseSync(join(engine.dataDir, "output", project, "unframed.sqlite"));
  try {
    const full = { setupCommand: "", runCommand: "npm run dev", packageManager: "npm", portMode: { mode: "free" }, files: [], mocks: [], warnings: [], ...setup };
    db.prepare("UPDATE repository SET setup = ? WHERE id = 1").run(JSON.stringify(full));
  } finally {
    db.close();
  }
};

const firstScreenId = async (engine: TestEngine, project: string) => (await screenShapes(engine, project))[0].id as string;

test("a Screen shows Setup's progress while its Instance installs, then the app", async ({ page }) => {
  const slowInstall = async (root: string) => {
    await writeFile(join(root, "install.js"), 'setTimeout(() => require("node:fs").writeFileSync("installed.txt", "yes\\n"), 4000);\n');
    git(root, "commit", "-qam", "slow install");
  };
  await withRepository(
    page,
    {},
    async () => {
      const screen = page.locator("[data-testid=screen]");
      await expect(screen.locator("[data-testid=screen-overlay]")).toHaveText("Installing dependencies…");
      await expect(screen.locator("[data-testid=screen-overlay]")).toHaveCount(0, { timeout: 30_000 });
      await expect(screen).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    },
    slowInstall,
  );
});

test("a Screen whose server fails shows the failure with the log's last lines", async ({ page }) => {
  await withRepository(page, { FAKE_DEV_EXIT_CODE: "1" }, async () => {
    const overlay = page.locator("[data-testid=screen] [data-testid=screen-overlay]");
    await expect(overlay).toHaveAttribute("data-overlay", "failed", { timeout: 30_000 });
    await expect(overlay).toContainText("The dev server exited with code 1");
    await expect(overlay.locator("[data-testid=screen-log]")).toContainText("fake dev server: giving up");
  });
});

test("a Screen tags mocks and lists warnings from Setup, and says when its Instance is removed or its Repository is gone", async ({ page }) => {
  await withRepository(page, {}, async (engine, project, root) => {
    const screen = page.locator("[data-testid=screen]");
    saveSetup(engine, project, { mocks: ["mock user", "fixtures"], warnings: ["Payments are stubbed."] });
    await page.reload();
    await expect(screen.locator("[data-testid=screen-mock-tag]")).toHaveText("mock user · fixtures");
    await expect(screen.locator("[data-testid=screen-warning]")).toHaveText(["Payments are stubbed."]);

    const rpc = await engine.rpc();
    const shape = (await screenShapes(engine, project))[0];
    await rpc.call("instances.remove", { project, id: shape.props.instance, force: true });
    await rpc.close();
    await expect(screen.locator("[data-testid=screen-overlay]")).toHaveText("Instance removed");
    await expect(screen.locator("iframe")).toHaveCount(0);

    await rename(root, `${root}-moved`);
    await page.reload();
    await expect(screen.locator("[data-testid=screen-overlay]")).toHaveText("Repository not found");
  });
});

test("a selected Screen opens in the browser, changes route and changes viewport", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const screen = page.locator("[data-testid=screen]");
    await expect(screen).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    await clickShape(page, await firstScreenId(engine, project));

    const popup = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Open in browser" }).click();
    expect((await popup).url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    await page.getByTestId("screen-route").click();
    await page.getByRole("textbox", { name: "Route" }).fill("https://example.com/");
    await page.getByRole("button", { name: "Show route" }).click();
    await expect(page.getByText("A route starts with / and has no spaces, like /settings?tab=2.")).toBeVisible();
    await page.getByRole("textbox", { name: "Route" }).fill("settings?tab=2");
    await page.getByRole("button", { name: "Show route" }).click();
    await expect(screen).toHaveAttribute("data-route", "/settings?tab=2");
    await expect(page.frameLocator("[data-testid=screen] iframe[data-screen-frame]").locator("#path")).toHaveText("/settings");

    await page.getByTestId("screen-viewport").click();
    await page.getByRole("menuitemradio", { name: /Phone/ }).click();
    await expect.poll(async () => (await screenShapes(engine, project))[0].props).toMatchObject({ route: "/settings?tab=2", w: 390, h: 844 });
  });
});

test("forking a Screen makes a new Instance on a named branch from its HEAD, with a Screen beside it; New Instance starts from a picked base", async ({ page }) => {
  await withRepository(page, {}, async (engine, project, root) => {
    git(root, "branch", "feature/login");
    const screens = page.locator("[data-testid=screen]");
    await expect(screens.first()).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    const [first] = await screenShapes(engine, project);
    await clickShape(page, first.id);

    await page.getByRole("button", { name: "Fork" }).click();
    const name = page.getByRole("textbox", { name: "Branch name" });
    await expect(name).toHaveValue(`${first.props.title}-2`);
    await name.fill("try/darker");
    await page.getByRole("button", { name: "Fork", exact: true }).last().click();
    await expect(screens).toHaveCount(2);
    await expect.poll(async () => (await screenShapes(engine, project)).length).toBe(2);
    const forked = (await screenShapes(engine, project)).find((shape) => shape.id !== first.id);
    expect(forked).toMatchObject({ x: first.x + 1280 + 80, y: first.y, props: { route: "/", w: 1280, h: 800, title: "try/darker" } });
    const rpc = await engine.rpc();
    const made = await rpc.call("instances.status", { project, id: forked.props.instance });
    expect(made).toMatchObject({ branch: "try/darker", baseRef: first.props.title });

    await page.getByRole("button", { name: "New Instance" }).click();
    await page.getByRole("combobox", { name: "Base branch" }).click();
    await page.getByRole("option", { name: "feature/login" }).click();
    await page.getByRole("button", { name: "Create Instance" }).click();
    await expect.poll(async () => (await screenShapes(engine, project)).length).toBe(3);
    const instances = (await rpc.call("instances.list", { project })).instances;
    expect(instances.find((instance) => instance.baseRef === "feature/login")?.branch).toMatch(/^unframed\//);
    await rpc.close();
  });
});
