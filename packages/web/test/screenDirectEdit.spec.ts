import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { ONLY_THIS_ONE } from "@unframed/domain";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { REACT_APP, prepareReactApp } from "./reactFixture.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const editor = (page: Page) => page.getByTestId("artifact-editor");
const centreColumn = (page: Page) => editor(page).locator('[data-editor-column="centre"]');
const panels = (page: Page) => editor(page).locator('[data-editor-column="parameters"]');
const rail = (page: Page) => editor(page).locator('[data-editor-column="rail"]');
const app = (page: Page) => editor(page).getByTestId("screen-preview").frameLocator("iframe[data-screen-frame]");
const label = (page: Page) => page.locator('[data-edit-outline="selected"] [data-edit-label]');
const drafts = (page: Page) => editor(page).getByTestId("screen-drafts");
const rows = (page: Page) => page.getByRole("list", { name: "Changes" }).locator("[data-draft-row]");

const openReact = async (page: Page, engine: TestEngine, project: string) => {
  const [first] = await screenShapes(engine, project);
  await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/react" } }]);
  await expect(page.locator("[data-testid=screen]")).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
  await clickShape(page, first.id);
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  await expect(app(page).getByRole("heading", { name: "Agent" })).toBeVisible({ timeout: 30_000 });
  return first.id as string;
};

const pick = async (page: Page, target: ReturnType<ReturnType<typeof app>["locator"]>, init: Record<string, unknown>, expected: RegExp) => {
  await expect(async () => {
    await target.dispatchEvent("click", init);
    await expect(label(page)).toHaveText(expected, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
};

const worktreeOf = async (engine: TestEngine, project: string) => {
  const rpc = await engine.rpc();
  try {
    return (await rpc.call("instances.list", { project })).instances[0]!.worktree;
  } finally {
    await rpc.close();
  }
};

test("a click takes the outermost component, a double-click goes deeper and Cmd-click deepest, and the panel names the JSX behind the selection", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      const heading = app(page).getByRole("heading", { name: "Agent" });
      await pick(page, heading, { detail: 1 }, /^Header · in Header \d+×48$/);
      await expect(panels(page).getByTestId("screen-source-component")).toContainText("Header");
      await expect(panels(page).getByTestId("screen-source-component")).toContainText("1 instance");
      await expect(panels(page).getByTestId("screen-source-file")).toHaveText("src/App.jsx:5–7");
      await expect(panels(page).getByTestId("screen-source-span")).toContainText('<header className="flex h-12 items-center pl-3.5 pr-2">');
      await expect(panels(page).getByRole("list", { name: "Classes" })).toContainText("pl-3.5");

      await pick(page, heading, { detail: 2 }, /^Heading · in Header /);
      await expect(panels(page).locator('[data-class-hint="font-size"]')).toHaveText("text-sm");

      await pick(page, app(page).getByRole("heading", { name: "Second" }), { metaKey: true }, /^Heading · in Card /);
      await expect(panels(page).getByTestId("screen-source-component")).toContainText("3 instances");
      await expect(panels(page).getByTestId("screen-source-component")).toContainText("this is 2");

      await pick(page, app(page).getByRole("heading", { name: "Third" }), { detail: 1 }, /^List item · in Card /);
      await expect(panels(page).locator('[data-prop="title"]')).toContainText('"Third"');
    },
    prepareReactApp,
  );
});

test("a padding change reads as its class, joins the pending list, and Apply writes it into the worktree, checks it took, and undo puts it back", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await pick(page, app(page).getByRole("heading", { name: "Agent" }), { detail: 1 }, /^Header · in Header /);
      const padding = panels(page).getByRole("spinbutton", { name: "Padding left", exact: true });
      await expect(padding).toBeEnabled();
      await padding.fill("8");
      await padding.press("Enter");
      await expect(app(page).locator("header")).toHaveCSS("padding-left", "8px");
      await expect(drafts(page)).toHaveText("1 change");
      await drafts(page).click();
      await expect(rows(page).first().getByTestId("draft-line")).toHaveText("Padding left 14 → 8 · pl-2");

      const file = join(await worktreeOf(engine, project), "src", "App.jsx");
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(rows(page).first().getByTestId("draft-state")).toHaveText("Took", { timeout: 30_000 });
      expect(await readFile(file, "utf8")).toBe(REACT_APP.replace("pl-3.5 pr-2", "pl-2 pr-2"));
      await expect(app(page).locator("header")).toHaveCSS("padding-left", "8px");

      await page.keyboard.press("Escape");
      await centreColumn(page).getByTestId("artifact-editor-title").click();
      await page.keyboard.press("ControlOrMeta+z");
      await expect.poll(() => readFile(file, "utf8"), { timeout: 10_000 }).toBe(REACT_APP);
      await expect(app(page).locator("header")).toHaveCSS("padding-left", "14px", { timeout: 15_000 });
    },
    prepareReactApp,
  );
});

test("a change kept to one instance goes to the Screen's agent with the file, the span and the reason, and nothing is written", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await pick(page, app(page).getByRole("heading", { name: "Second" }), { detail: 1 }, /^List item · in Card /);
      const padding = panels(page).getByRole("spinbutton", { name: "Padding left", exact: true });
      await padding.fill("24");
      await padding.press("Enter");
      await drafts(page).click();
      const row = rows(page).first();
      await expect(row.getByTestId("draft-line")).toHaveText("Padding left 16 → 24 · pl-6");
      await row.getByRole("button", { name: "Only this one" }).click();
      await expect(row.getByRole("button", { name: "Only this one" })).toHaveAttribute("aria-pressed", "true");

      const file = join(await worktreeOf(engine, project), "src", "Card.jsx");
      const before = await readFile(file, "utf8");
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(row.getByTestId("draft-reason")).toHaveText(ONLY_THIS_ONE, { timeout: 20_000 });
      await expect(rail(page)).toContainText("Unframed could not write them into the code itself", { timeout: 20_000 });
      await expect(rail(page)).toContainText("List item in Card at /src/Card.jsx:3:5, instance 2 of 3, change only this one: class (none) → pl-6");
      expect(await readFile(file, "utf8")).toBe(before);
    },
    prepareReactApp,
  );
});

test("Delete and Backspace with an element selected never delete the Screen", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await pick(page, app(page).getByRole("heading", { name: "Agent" }), { detail: 1 }, /^Header · in Header /);
      await centreColumn(page).getByTestId("artifact-editor-title").click();
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Delete");
      await app(page).locator("header").press("Backspace");
      await expect(label(page)).toHaveCount(1);
      expect(await screenShapes(engine, project)).toHaveLength(1);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(editor(page)).toHaveCount(0);
      expect(await screenShapes(engine, project)).toHaveLength(1);
    },
    prepareReactApp,
  );
});
