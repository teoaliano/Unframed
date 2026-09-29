import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { artifactColumn, createChat, openRail, promptBox, say, scriptFolder, startAgentEngine, startProvidersEngine } from "./agent.ts";
import { artifactShape, filledArtifact } from "./artifacts.ts";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape, composer, openComposer, startGeneration } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { openLibrary } from "./library.ts";
import { reportDialog, startLegacyApp } from "./legacy.ts";
import { dropFiles, emptyMedia, filledMedia, groupRecord, inGroup, promptRecord, putRecords } from "./media.ts";

const OUT = process.env.TOUR_DIR ?? "/tmp/unframed-tour";
const clipPath = fileURLToPath(new URL("./media/clip.webm", import.meta.url));
let counter = 0;

test.describe.configure({ timeout: 300_000 });
test.use({ viewport: { width: 1280, height: 800 } });

/** Screenshots the page in light and in dark, leaving it in light. */
const shot = async (page: Page, name: string) => {
  await mkdir(OUT, { recursive: true });
  const n = String(++counter).padStart(2, "0");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator("html")).toHaveAttribute("data-unframed-theme", scheme);
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(OUT, `${n}-${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light" });
};

test("tour: canvas, chrome, menus, composer, dialogs, library, settings", async ({ page }) => {
  const generation = await startGeneration();
  const engine = generation.engine;
  try {
    await openCanvas(page, engine);
    await putRecords(engine, [
      emptyMedia("shape:empty-image", "image", "150", { x: -420, y: -120 }),
      emptyMedia("shape:empty-video", "video", "151", { x: -150, y: -120 }),
      { ...groupRecord("shape:set", "character", { x: 420, y: -120 }, { w: 380, h: 200 }), meta: { unframed: { recipe: { medium: "image", model: "openai/gpt-image-2", params: { quality: "high" }, runs: 3 } } } },
      inGroup(promptRecord("shape:line", "300", "a knight in silver armour"), "shape:set", { x: 28, y: 56 }),
      artifactShape({ id: "shape:page", kind: "page", ref: "152", at: { x: -420, y: 360 }, size: { w: 240, h: 150 } }),
    ]);
    await filledMedia(engine, { id: "shape:photo", type: "image", ref: "153", at: { x: 420, y: 140 }, bytes: pngBytes(300, 150, 90), name: "photo.png", mime: "image/png", natural: { w: 300, h: 150 }, width: 200 });
    await filledMedia(engine, { id: "shape:clip", type: "video", ref: "154", at: { x: -150, y: 120 }, bytes: await readFile(clipPath), name: "clip.webm", mime: "video/webm", natural: { w: 320, h: 180 }, width: 220 });
    await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "155", at: { x: -150, y: 380 }, size: { w: 220, h: 140 }, title: "Landing", html: "<h1>Hello</h1>" });
    await expect(shapeOnScreen(page, "shape:clip")).toBeVisible();
    await page.waitForTimeout(800);
    await shot(page, "canvas");

    await clickShape(page, "shape:photo");
    await shot(page, "selected-image-toolbar");
    await page.mouse.click(5, 450);

    await page.locator(".unframed-chrome-left").getByRole("button", { name: "Project", exact: true }).click();
    await shot(page, "project-menu");
    await page.getByRole("menuitem", { name: "Add project" }).click();
    await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
    await shot(page, "new-project-dialog");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await shot(page, "add-menu");
    await page.keyboard.press("Escape");

    await page.mouse.click(5, 450, { button: "right" });
    await expect(page.getByTestId("context-menu")).toBeVisible();
    await shot(page, "context-menu");
    await page.keyboard.press("Escape");

    await clickShape(page, "shape:starter-subject");
    await clickShape(page, "shape:photo", ["Shift"]);
    await shot(page, "selection-toolbar");
    await openComposer(page);
    await page.waitForTimeout(400);
    await shot(page, "generate-composer");
    const tray = composer(page).getByTestId("composer-tray");
    await tray.locator("[data-prop]").first().click();
    await shot(page, "prop-menu");
    await page.keyboard.press("Escape");
    await tray.getByTestId("model-chip").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, "model-dialog");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 450);

    await dropFiles(page, { x: 5, y: 450 }, [{ name: "huge.mp4", mime: "video/mp4", size: 26_214_401 }]);
    await page.waitForTimeout(600);
    await shot(page, "toast");

    await openLibrary(page);
    await page.waitForTimeout(400);
    await shot(page, "library");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("library")).toHaveCount(0);

    await page.locator(".unframed-chrome-right").getByRole("button", { name: "Settings" }).click();
    await expect(page.getByTestId("settings-dialog")).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, "settings");
    await page.keyboard.press("Escape");

    await clickShape(page, "shape:set");
    await page.keyboard.press("F2");
    await shot(page, "group-rename");
    await page.keyboard.press("Escape");
  } finally {
    await engine.dispose();
  }
});

const WORK = {
  when: "^do the work",
  turns: [
    {
      provider: [
        { name: "Bash", input: { command: "ls -la" } },
        { name: "Read", input: { file_path: "notes.md" } },
      ],
      text: "All **done**. Here is a list:\n\n- one\n- two\n\n```ts\nconst answer = 42;\n```\n\nAnd a table:\n\n| a | b |\n| - | - |\n| 1 | 2 |",
    },
  ],
};
const DIFFS = {
  when: "^rewrite",
  turns: [{ text: "Rewrote the landing page.", tools: [{ name: "canvas_write", input: { ops: [{ type: "update", id: "pg1", props: { file: "landing-v2.html" } }] } }] }],
};

test("tour: rail, transcript, work log", async ({ page }) => {
  const agent = await startAgentEngine({ script: await scriptFolder({ work: WORK }) });
  try {
    await openCanvas(page, agent);
    const folder = join(agent.dataDir, "output", "default");
    await writeFile(join(folder, "landing-v1.html"), "<!doctype html>\n<h1>One</h1>\n<p>Two</p>\n");
    await writeFile(join(folder, "landing-v2.html"), "<!doctype html>\n<h1>One, again</h1>\n<p>Two</p>\n<p>Three</p>\n");
    const [landing] = artifactColumn([{ id: "shape:pg1", kind: "page", title: "Landing", file: "landing-v1.html" }]);
    await putRecords(agent, [landing]);
    const panel = await openRail(page);
    await shot(page, "rail-empty");
    await say(panel, "do the work please");
    await expect(panel.locator("[data-role='assistant']")).toContainText("All done.");
    await panel.getByTestId("worked-for").getByRole("button").click();
    await panel.getByTestId("work-group").getByRole("button").first().click();
    await shot(page, "transcript-work-log");
  } finally {
    await agent.dispose();
  }
});

test("tour: recap, diff panel, editor", async ({ page }) => {
  const agent = await startAgentEngine({ script: await scriptFolder({ diffs: DIFFS }) });
  try {
    await openCanvas(page, agent);
    const folder = join(agent.dataDir, "output", "default");
    await writeFile(join(folder, "landing-v1.html"), "<!doctype html>\n<h1>One</h1>\n<p>Two</p>\n");
    await writeFile(join(folder, "landing-v2.html"), "<!doctype html>\n<h1>One, again</h1>\n<p>Two</p>\n<p>Three</p>\n");
    const [landing] = artifactColumn([{ id: "shape:pg1", kind: "page", title: "Landing", file: "landing-v1.html" }]);
    await putRecords(agent, [landing]);
    const panel = await openRail(page);
    await say(panel, "rewrite the landing page");
    await expect(panel.locator("[data-role='assistant']").last()).toContainText("Rewrote the landing page.");
    await shot(page, "recap-card");
    await panel.getByTestId("recap-card").first().getByRole("button", { name: "View diff" }).click();
    await expect(panel.getByTestId("diff-panel")).toBeVisible();
    await page.waitForTimeout(800);
    await shot(page, "diff-panel");
    await panel.getByTestId("diff-panel").focus();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Close" }).first().click().catch(() => undefined);
    const at = await centre(shapeOnScreen(page, "shape:pg1"));
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForTimeout(1200);
    await shot(page, "artifact-editor");
  } finally {
    await agent.dispose();
  }
});

test("tour: approval panel and agent tray pickers", async ({ page }) => {
  const agent = await startAgentEngine();
  try {
    await openCanvas(page, agent);
    await createChat(agent, { runtimeMode: "approval-required", title: "Cleanup" });
    const panel = await openRail(page);
    await say(panel, "clean the build please");
    await expect(panel.getByTestId("approval-panel")).toBeVisible();
    await shot(page, "approval-panel");
  } finally {
    await agent.dispose();
  }
  const dir = await mkdtemp(join(tmpdir(), "unframed-tour-"));
  const providers = await startProvidersEngine(dir);
  try {
    await openCanvas(page, providers);
    const panel = await openRail(page);
    await expect(panel.getByTestId("model-picker")).toHaveText("Opus 5.5", { timeout: 20_000 });
    await shot(page, "agent-tray");
    await panel.getByTestId("model-picker").click();
    await page.waitForTimeout(400);
    await shot(page, "agent-model-picker");
    await page.keyboard.press("Escape");
    const box = promptBox(panel);
    await box.click();
    await box.pressSequentially("/");
    await page.waitForTimeout(300);
    await shot(page, "slash-menu");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await clickShape(page, "shape:starter-subject");
    await page.getByTestId("selection-toolbar").getByRole("button", { name: "Agent" }).click();
    await page.waitForTimeout(500);
    await shot(page, "toolbar-agent-tray");
  } finally {
    await providers.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tour: import report", async ({ page }) => {
  const app = await startLegacyApp();
  try {
    await page.goto(app.engine.origin);
    await expect(reportDialog(page)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await shot(page, "import-report");
  } finally {
    await app.dispose();
  }
});
