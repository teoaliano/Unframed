import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { roomRecords } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { canvasOf, IMPORTING, openImported, reportDialog, startLegacyApp } from "./legacy.ts";

test("the canvas's place says the import is running, and a second tab waits for the same import", async ({ browser }) => {
  let journal = "";
  const app = await startLegacyApp({
    prepare: async (outputDir) => {
      // The journal is a pipe: the import waits reading it until the test writes it.
      const path = join(outputDir, "everything", "graph.log");
      journal = await readFile(path, "utf8");
      await rm(path);
      execFileSync("mkfifo", [path]);
    },
  });
  try {
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto(app.engine.origin);
    await expect(first.getByText(IMPORTING)).toBeVisible({ timeout: 20_000 });
    await expect(first.locator("[data-canvas-project]")).toHaveCount(0);
    await second.goto(app.engine.origin);
    await expect(second.getByText(IMPORTING)).toBeVisible({ timeout: 20_000 });
    expect(existsSync(join(app.folder("everything"), "unframed.sqlite"))).toBe(false);

    await writeFile(join(app.folder("everything"), "graph.log"), journal);
    for (const page of [first, second]) {
      await expect(canvasOf(page, "everything")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(IMPORTING)).toHaveCount(0);
    }
    // One import made one canvas: the agent's prompt from the journal is there once.
    const prompts = (await roomRecords(app.engine, "everything")).filter((record) => record.meta?.ref === "a-mfd4b1x9-q7c3v1");
    expect(prompts).toHaveLength(1);
    await context.close();
  } finally {
    await app.dispose();
  }
});

test("a failed import says why, writes no database, and Try again imports once the cause is gone", async ({ page }) => {
  const app = await startLegacyApp({ prepare: (outputDir) => chmod(join(outputDir, "everything", "graph.json"), 0o000) });
  const graph = join(app.folder("everything"), "graph.json");
  try {
    await page.goto(app.engine.origin);
    const failure = page.getByRole("alert").filter({ hasText: "Could not import this project from the old Unframed:" });
    await expect(failure).toBeVisible({ timeout: 20_000 });
    await expect(failure).toContainText("EACCES");
    await expect(failure).toContainText("Its files are unchanged.");
    await expect(page.locator("[data-canvas-project]")).toHaveCount(0);
    expect(existsSync(join(app.folder("everything"), "unframed.sqlite"))).toBe(false);

    // A reload still shows the failure: nothing reruns the import but Try again.
    await page.reload();
    await expect(failure).toBeVisible({ timeout: 20_000 });

    await chmod(graph, 0o644);
    await failure.getByRole("button", { name: "Try again" }).click();
    await expect(canvasOf(page, "everything")).toBeVisible({ timeout: 20_000 });
    await expect(reportDialog(page)).toBeVisible();
  } finally {
    await chmod(graph, 0o644).catch(() => {});
    await app.dispose();
  }
});

test("the report shows once across reloads and tabs, with its sections, and the project menu opens it again", async ({ page, browser }) => {
  const app = await startLegacyApp();
  try {
    await openImported(page, app.engine);
    const dialog = reportDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Imported from the old Unframed" })).toBeVisible();
    await expect(dialog).toContainText(
      "This project was made with an older version. Its canvas was rebuilt for this one. graph.json and graph.log are still in the project folder, unchanged. Undo history from the old app does not carry over.",
    );
    await expect(dialog.locator("section h3")).toHaveText(["Changed", "Not kept", "Missing files"]);
    const changed = dialog.getByRole("region", { name: "Changed" });
    await expect(changed.getByRole("listitem").first()).toHaveText("Wires are gone: the selection is the input now. 14 wires were removed.");
    await expect(dialog.getByRole("region", { name: "Not kept" })).toContainText("Old chats in threads/ are not shown in this version.");
    await expect(dialog.getByRole("region", { name: "Missing files" }).getByRole("listitem")).toHaveText([
      "Image @109 named 1789031280088-gone.png, which is not in the project folder. It is empty now.",
      "1 results of @140 are no longer in the project folder.",
    ]);
    await dialog.getByRole("button", { name: "Got it" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await (await app.engine.rpc()).call("legacyImport.report", { project: "everything" }))!.seen).toBe(true);

    await page.reload();
    await expect(canvasOf(page, "everything")).toBeVisible({ timeout: 20_000 });
    const other = await (await browser.newContext()).newPage();
    await openImported(other, app.engine);
    // Give a dialog every chance to appear before saying it does not.
    await page.waitForTimeout(800);
    await expect(reportDialog(page)).toHaveCount(0);
    await expect(reportDialog(other)).toHaveCount(0);

    await page.getByRole("button", { name: "Project", exact: true }).click();
    await page.getByRole("menuitem", { name: "Import report" }).click();
    await expect(reportDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(reportDialog(page)).toHaveCount(0);
  } finally {
    await app.dispose();
  }
});

test("a report shows only the sections it has, and a project never imported has no Import report", async ({ page }) => {
  const app = await startLegacyApp({ project: "legacy-snapshot" });
  try {
    await openImported(page, app.engine, "legacy-snapshot");
    await expect(reportDialog(page).locator("section h3")).toHaveText(["Changed"]);
    await reportDialog(page).getByRole("button", { name: "Got it" }).click();
    await (await app.engine.rpc()).call("projects.create", { name: "fresh" });
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Import report" })).toBeVisible();
    await page.getByRole("menuitem", { name: "fresh" }).click();
    await expect(canvasOf(page, "fresh")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Add project" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Import report" })).toHaveCount(0);
  } finally {
    await app.dispose();
  }
});

test("the canvas opens zoomed to fit the imported content", async ({ page }) => {
  const app = await startLegacyApp();
  try {
    await openImported(page, app.engine);
    await reportDialog(page).getByRole("button", { name: "Got it" }).click();
    const size = page.viewportSize()!;
    const shapes = (await roomRecords(app.engine, "everything")).filter((record) => record.typeName === "shape" && record.parentId === "page:page");
    for (const shape of shapes) {
      const box = await page.locator(`[data-shape-id="${shape.id}"]`).boundingBox();
      expect(box, shape.meta?.ref ?? shape.props?.name).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.y).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
    }
  } finally {
    await app.dispose();
  }
});

