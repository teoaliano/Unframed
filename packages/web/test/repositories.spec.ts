import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRepo } from "../../engine/test/gitRepos.ts";
import { makeTempDir, type TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas } from "./canvas.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";

const withPicker = async (answer: string, use: (engine: TestEngine) => Promise<void>) => {
  const engine = await startHostedEngine({ env: { UNFRAMED_TEST_PICK_FOLDER: answer } });
  try {
    await use(engine);
  } finally {
    await engine.dispose();
  }
};

const menuItems = (page: import("@playwright/test").Page) => page.locator("[role=menuitem], [role=menuitemradio]");

test("Add Repository… picks a folder, opens the Repository in a tab and lists it with its kind", async ({ page }) => {
  const root = await makeRepo("My App");
  await withPicker(join(root, "src"), async (engine) => {
    await openCanvas(page, engine, "default");
    await page.getByRole("button", { name: "All projects" }).click();
    await expect(menuItems(page)).toHaveText(["default", "New Whiteboard", "Add Repository…"]);
    await page.getByRole("menuitem", { name: "Add Repository…" }).click();

    await expect(page.locator("[data-canvas-project='my-app'] .tl-canvas")).toBeVisible();
    await expect(page.locator("[role=tab][data-active='true']")).toHaveText("my-app");
    expect(await engine.nativeLog()).toHaveLength(1);

    await page.getByRole("button", { name: "All projects" }).click();
    await expect(menuItems(page)).toHaveText(["default", "my-app", "New Whiteboard", "Run Setup again", "Add Repository…"]);
    const repository = page.getByRole("menuitemradio", { name: "my-app" });
    await expect(repository).toHaveAttribute("data-kind", "repository");
    await expect(repository.getByLabel("Repository")).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "default" })).toHaveAttribute("data-kind", "whiteboard");
    await expect(page.getByRole("menuitemradio", { name: "default" }).getByLabel("Repository")).toHaveCount(0);
  });
});

test("Add Repository… refuses a folder outside git in one line, and does nothing when the picker is cancelled", async ({ page }) => {
  const plain = await makeTempDir("unframed-plain-");
  await writeFile(join(plain, "notes.txt"), "not a repo\n");
  await withPicker(plain, async (engine) => {
    await openCanvas(page, engine, "default");
    await page.getByRole("button", { name: "All projects" }).click();
    await page.getByRole("menuitem", { name: "Add Repository…" }).click();
    await expect(page.locator("[data-slot='toast-title']")).toHaveText(["That folder is not in a git repository."]);
    expect((await (await engine.rpc()).call("projects.list")).projects).toEqual(["default"]);
  });
  await withPicker("cancel", async (engine) => {
    await openCanvas(page, engine, "default");
    await page.getByRole("button", { name: "All projects" }).click();
    await page.getByRole("menuitem", { name: "Add Repository…" }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.locator("[role=tab]")).toHaveText(["default"]);
    expect((await (await engine.rpc()).call("projects.list")).projects).toEqual(["default"]);
  });
});

test("Add Repository… says once that uncommitted changes stay behind", async ({ page }) => {
  const root = await makeRepo("dirty");
  await writeFile(join(root, "package.json"), "{}\n");
  await withPicker(root, async (engine) => {
    await openCanvas(page, engine, "default");
    await page.getByRole("button", { name: "All projects" }).click();
    await page.getByRole("menuitem", { name: "Add Repository…" }).click();
    await expect(page.locator("[role=tab][data-active='true']")).toHaveText("dirty");
    await expect(page.locator("[data-slot='toast-title']")).toHaveText(["Uncommitted changes in your checkout are not carried into Instances."]);
  });
});
