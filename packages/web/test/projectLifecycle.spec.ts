import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "../../engine/test/engineProcess.ts";
import { openCanvas, plainText, roomShapes, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { openSettings, startSettingsEngine } from "./settings.ts";
import type { Page } from "@playwright/test";

const menu = async (page: Page) => {
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
};

const activeCanvas = (page: Page, project: string) => page.locator(`[data-canvas-project='${project}'] .tl-canvas`);

const pending = (id: string, project: string) => ({
  id,
  project,
  params: { prompt: "a render", model: "bytedance/seedance-2.0", duration: 5, resolution: null, size: null },
  startedAt: Date.now() - 60_000,
  status: "pending",
});

test("each project row has a check on the current one and Rename and Delete buttons that do not switch projects", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await (await engine.rpc()).call("projects.create", { name: "beta" });
  await menu(page);
  await expect(page.getByRole("menuitem")).toHaveText(["beta", "default", "Add project"]);
  await expect(page.getByRole("menuitem", { name: "default" }).getByLabel("Active")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "beta" }).getByLabel("Active")).toHaveCount(0);
  for (const project of ["beta", "default"]) {
    await expect(page.getByRole("button", { name: `Rename ${project}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Delete ${project}` })).toBeVisible();
  }
  await page.getByRole("button", { name: "Rename beta" }).hover();
  await expect(page.getByText("Rename", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Rename beta" }).click();
  const rename = page.getByRole("dialog", { name: "Rename project" });
  await expect(rename).toBeVisible();
  await rename.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Project", exact: true })).toHaveText("default");

  await menu(page);
  await page.getByRole("button", { name: "Delete beta" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete project?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("button", { name: "Project", exact: true })).toHaveText("default");
  await expect(activeCanvas(page, "default")).toBeVisible();
  expect((await (await engine.rpc()).call("projects.list")).projects).toEqual(["beta", "default"]);
});

test("renaming the active project renames it everywhere and keeps its canvas; an engine refusal stays on the field", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "beta" });

  await menu(page);
  await page.getByRole("button", { name: "Rename default" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename project" });
  const field = dialog.getByLabel("Project name");
  await expect(field).toHaveValue("default");
  await expect(dialog.getByRole("button", { name: "Rename" })).toBeVisible();
  await field.fill("!!");
  await field.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("Enter a project name.");
  await field.fill("Beta");
  await field.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText('A project named "beta" already exists.');
  await expect(dialog).toBeVisible();

  await field.fill("Product Shots");
  await field.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Project", exact: true })).toHaveText("product-shots");
  await expect(activeCanvas(page, "product-shots")).toBeVisible();
  expect((await rpc.call("projects.list")).projects).toEqual(["beta", "product-shots"]);
  await expect.poll(async () => (await rpc.call("preferences.get", { keys: ["project.active"] })).values["project.active"]).toBe("product-shots");
  const prompts = await waitForRoom(engine, "product-shots", (records) => {
    const texts = records.filter((record) => record.type === "text");
    return texts.length === 2 ? texts : undefined;
  });
  expect(prompts.map(plainText)).toContain("lone red fox");
  await menu(page);
  await expect(page.getByRole("menuitem")).toHaveText(["beta", "product-shots", "Add project"]);

  // The same slug closes the dialog without a call.
  await page.getByRole("button", { name: "Rename beta" }).click();
  await dialog.getByLabel("Project name").fill("BETA");
  await dialog.getByLabel("Project name").press("Enter");
  await expect(dialog).toBeHidden();
  expect((await rpc.call("projects.list")).projects).toEqual(["beta", "product-shots"]);
});

test("deleting asks first, asks again when renders are in progress, and opens the next project", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "beta" });
  await writeFile(join(engine.dataDir, "output", "jobs.json"), JSON.stringify([pending("job-1", "beta"), pending("job-2", "beta")]));

  await menu(page);
  await page.getByRole("button", { name: "Delete beta" }).click();
  const first = page.getByRole("alertdialog", { name: "Delete project?" });
  await expect(first.getByText(`This permanently removes "beta" and its generated images. This can't be undone.`)).toBeVisible();
  await first.getByRole("button", { name: "Delete project" }).click();
  const second = page.getByRole("alertdialog", { name: "Stop renders and delete?" });
  await expect(second.getByText("This stops tracking 2 video renders. They may still complete upstream, but their results will not be saved here.")).toBeVisible();
  expect(existsSync(join(engine.dataDir, "output", "beta"))).toBe(true);
  await second.getByRole("button", { name: "Stop renders and delete" }).click();
  await expect(second).toBeHidden();
  await expect.poll(async () => (await rpc.call("projects.list")).projects).toEqual(["default"]);
  const jobs = JSON.parse(await readFile(join(engine.dataDir, "output", "jobs.json"), "utf8"));
  expect(jobs.map((job: any) => job.status)).toEqual(["failed", "failed"]);
  await expect(page.getByRole("button", { name: "Project", exact: true })).toHaveText("default");
  await menu(page);
  await expect(page.getByRole("menuitem")).toHaveText(["default", "Add project"]);
  await page.keyboard.press("Escape");

  // The active and last project: a new default replaces it, with the starter content.
  await rpc.call("projects.create", { name: "gamma" });
  await menu(page);
  await page.getByRole("button", { name: "Delete default" }).click();
  await page.getByRole("alertdialog", { name: "Delete project?" }).getByRole("button", { name: "Delete project" }).click();
  await expect(page.getByRole("button", { name: "Project", exact: true })).toHaveText("gamma");
  await expect(activeCanvas(page, "gamma")).toBeVisible();

  await menu(page);
  await page.getByRole("button", { name: "Delete gamma" }).click();
  await page.getByRole("alertdialog", { name: "Delete project?" }).getByRole("button", { name: "Delete project" }).click();
  await expect(page.getByRole("button", { name: "Project", exact: true })).toHaveText("default");
  await expect(activeCanvas(page, "default")).toBeVisible();
  expect((await rpc.call("projects.list")).projects).toEqual(["default"]);
  await waitForRoom(engine, "default", (records) => records.filter((record) => record.type === "text").length === 2);
});

test("after saving a new output folder, the menu lists its projects and the canvas opens one, or a new default", async ({ page }) => {
  const { engine } = await startSettingsEngine();
  try {
    await openCanvas(page, engine, "default");
    const filled = join(await makeTempDir(), "filled");
    await mkdir(join(filled, "alpha"), { recursive: true });
    await mkdir(join(filled, "zeta"), { recursive: true });

    let dialog = await openSettings(page);
    await dialog.getByLabel("Output folder").fill(filled);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("status")).toContainText("Saved to .env");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("button", { name: "Project", exact: true })).toHaveText("alpha");
    await expect(activeCanvas(page, "alpha")).toBeVisible();
    await menu(page);
    await expect(page.getByRole("menuitem")).toHaveText(["alpha", "zeta", "Add project"]);
    await page.keyboard.press("Escape");

    const empty = join(await makeTempDir(), "empty");
    dialog = await openSettings(page);
    await dialog.getByLabel("Output folder").fill(empty);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("status")).toContainText("Saved to .env");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("button", { name: "Project", exact: true })).toHaveText("default");
    await expect(activeCanvas(page, "default")).toBeVisible();
    expect(existsSync(join(empty, "default"))).toBe(true);
    await expect.poll(async () => (await roomShapes(engine, "default", "text")).length).toBe(2);
    await menu(page);
    await expect(page.getByRole("menuitem")).toHaveText(["default", "Add project"]);
  } finally {
    await engine.dispose();
  }
});
