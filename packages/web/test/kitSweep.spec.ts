import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { artifactColumn, createChat, openRail, promptBox, say, scriptFolder, startAgentEngine, startProvidersEngine } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape, composer, openComposer, test as generationTest } from "./generation.ts";
import { unkittedControls } from "./kit.ts";
import { openLibrary } from "./library.ts";
import { groupRecord, inGroup, promptRecord, putRecords } from "./media.ts";

/*
 * Spec 12's sweep: every surface in turn, and on each no button, menu item, field or dialog
 * that a kit component did not render.
 */

/** Asserts nothing on screen escapes the kit, then closes what is open and waits for it to leave. */
const sweep = async (page: Page, close = true) => {
  expect(await unkittedControls(page)).toEqual([]);
  if (!close) return;
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-slot='menu-popup'], [data-slot='dialog-popup'], [data-slot='alert-dialog-popup'], [data-slot='popover-popup']")).toHaveCount(0);
};

test("the chrome, canvas menus and dialogs render every control through the kit", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await sweep(page, false);

  await page.locator(".unframed-chrome-left").getByRole("button", { name: "Project", exact: true }).click();
  await sweep(page, false);
  await page.getByRole("menuitem", { name: "Add project" }).click();
  await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
  await sweep(page);

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await sweep(page);

  await page.locator(".unframed-chrome-right").getByRole("button", { name: "Settings" }).click();
  await expect(page.getByTestId("settings-dialog")).toBeVisible();
  await sweep(page);

  const subject = await centre(shapeOnScreen(page, "shape:starter-subject"));
  await page.mouse.click(subject.x, subject.y);
  await expect(page.getByTestId("selection-toolbar")).toBeVisible();
  await sweep(page, false);
});

const WORK = {
  when: "^do the work",
  turns: [{ provider: [{ name: "Bash", input: { command: "ls -la" } }, { name: "Read", input: { file_path: "notes.md" } }], text: "All **done**.\n\n```ts\nconst a = 1;\n```" }],
};

test("the chat rail, its transcript and the work log render every control through the kit", async ({ page }) => {
  const agent = await startAgentEngine({ script: await scriptFolder({ work: WORK }) });
  try {
    await openCanvas(page, agent);
    const panel = await openRail(page);
    await sweep(page, false);
    await say(panel, "do the work please");
    await expect(panel.locator("[data-role='assistant']")).toContainText("All done.");
    await panel.getByTestId("worked-for").getByRole("button").click();
    await panel.getByTestId("work-group").getByRole("button").first().click();
    await panel.getByTestId("work-row").first().getByRole("button").click();
    await sweep(page, false);
  } finally {
    await agent.dispose();
  }
});

test("the Agent tray's pickers, menus and model dialog render every control through the kit", async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), "unframed-sweep-"));
  const engine: TestEngine = await startProvidersEngine(dir);
  try {
    await openCanvas(page, engine);
    const panel = await openRail(page);
    await expect(panel.getByTestId("model-picker")).toHaveText("Opus 5.5", { timeout: 20_000 });
    await sweep(page, false);
    await panel.getByTestId("model-picker").click();
    await expect(page.getByRole("dialog", { name: "Models" })).toBeVisible();
    await sweep(page);
    const box = promptBox(panel);
    await box.click();
    await box.pressSequentially("/");
    await expect(page.getByRole("listbox", { name: "Commands" })).toBeVisible();
    await sweep(page, false);
  } finally {
    await engine.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

const DIFFS = {
  when: "^rewrite",
  turns: [{ text: "Rewrote the landing page.", tools: [{ name: "canvas_write", input: { ops: [{ type: "update", id: "pg1", props: { file: "landing-v2.html" } }] } }] }],
};

test("the diff panel renders every control through the kit", async ({ page }) => {
  const agent = await startAgentEngine({ script: await scriptFolder({ diffs: DIFFS }) });
  try {
    await openCanvas(page, agent);
    const folder = join(agent.dataDir, "output", "default");
    await writeFile(join(folder, "landing-v1.html"), "<h1>One</h1>\n");
    await writeFile(join(folder, "landing-v2.html"), "<h1>Two</h1>\n");
    const [landing] = artifactColumn([{ id: "shape:pg1", kind: "page", title: "Landing", file: "landing-v1.html" }]);
    await putRecords(agent, [landing, promptRecord("shape:n1", "900", "a note", { x: -600, y: 400 })]);
    const panel = await openRail(page);
    await say(panel, "rewrite the landing page");
    await expect(panel.locator("[data-role='assistant']").last()).toContainText("Rewrote the landing page.");
    await panel.getByTestId("recap-card").first().getByRole("button", { name: "View diff" }).click();
    await expect(panel.getByTestId("diff-panel")).toBeVisible();
    await sweep(page, false);
    await panel.getByTestId("diff-panel").focus();
    await page.keyboard.press("Escape");
    await expect(panel.getByTestId("diff-panel")).toHaveCount(0);
  } finally {
    await agent.dispose();
  }
});

test("a pending approval renders every control through the kit", async ({ page }) => {
  const agent = await startAgentEngine();
  try {
    await openCanvas(page, agent);
    await createChat(agent, { runtimeMode: "approval-required", title: "Cleanup" });
    const panel = await openRail(page);
    await say(panel, "clean the build please");
    await expect(panel.getByTestId("approval-panel")).toBeVisible();
    await sweep(page, false);
    await panel.getByTestId("approval-panel").getByRole("button", { name: "More approval options" }).click();
    await expect(page.locator("[data-slot='menu-popup']")).toBeVisible();
    await sweep(page, false);
  } finally {
    await agent.dispose();
  }
});

test("the artifact editor renders every control through the kit", async ({ page }) => {
  const agent = await startAgentEngine();
  try {
    await openCanvas(page, agent);
    await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: "<h1>Welcome</h1>" });
    await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
    const at = await centre(shapeOnScreen(page, "shape:landing"));
    await page.mouse.dblclick(at.x, at.y);
    await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();
    await sweep(page, false);
  } finally {
    await agent.dispose();
  }
});

generationTest("the Generate composer, its menus and its model dialog render every control through the kit", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await clickShape(page, "shape:starter-subject");
  await expect(page.getByTestId("selection-toolbar")).toBeVisible();
  await sweep(page, false);
  await openComposer(page);
  await sweep(page, false);
  const tray = composer(page).getByTestId("composer-tray");
  await tray.getByTestId("model-chip").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await sweep(page);
  await tray.locator("[data-prop]").first().click();
  await expect(page.locator("[data-slot='menu-popup']")).toBeVisible();
  await sweep(page);
  await tray.getByRole("button", { name: "+ add prop" }).click();
  await expect(page.locator("[data-slot='menu-popup']")).toBeVisible();
  await sweep(page);
});

test("the Library and Add to library render every control through the kit", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await openLibrary(page);
  await sweep(page);
  await putRecords(engine, [groupRecord("shape:set", "set", { x: -400, y: 20 }, { w: 380, h: 240 }), inGroup(promptRecord("shape:line", "300", "a knight"), "shape:set", { x: 28, y: 56 })]);
  await expect(shapeOnScreen(page, "shape:line")).toBeVisible();
  const box = (await shapeOnScreen(page, "shape:set").boundingBox())!;
  await page.mouse.move(box.x + 10, box.y - 8);
  await page.waitForTimeout(50);
  await page.mouse.click(box.x + 10, box.y - 8, { button: "right" });
  await page.getByTestId("context-menu.unframed-add-to-library").click();
  await expect(page.getByTestId("add-to-library")).toBeVisible();
  await sweep(page);
});
