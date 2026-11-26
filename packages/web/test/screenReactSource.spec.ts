import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { REACT_APP, REACT_CARD, positionOf, prepareReactApp } from "../../engine/test/reactFixture.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";

const editor = (page: Page) => page.getByTestId("artifact-editor");
const frame = (page: Page) => page.frameLocator('[data-screen-of][style*="visibility: visible"] iframe[data-screen-frame]');

test("on React 19 the bridge maps a rendered element to the JSX that made it through the stack and the module's source map", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      const [first] = await screenShapes(engine, project);
      await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/react" } }]);
      await expect(page.locator("[data-testid=screen]")).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
      await clickShape(page, first.id);
      await page.getByRole("button", { name: "Editor", exact: true }).click();
      await expect(editor(page)).toBeVisible();
      await expect(frame(page).getByRole("heading", { name: "Agent" })).toBeVisible({ timeout: 30_000 });

      expect(await frame(page).locator("header").evaluate(() => (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.size)).toBeGreaterThanOrEqual(1);

      const header = await frame(page).locator("header").evaluate((el) => (window as any).__unframedSource.resolve(el));
      expect(header).toMatchObject({ tag: "header", owner: "Header", instanceIndex: 0, instanceCount: 1, source: { file: "/src/App.jsx", ...positionOf(REACT_APP, "<header"), mapped: true } });

      const card = await frame(page).locator("li").nth(1).evaluate((el) => (window as any).__unframedSource.resolve(el));
      expect(card).toMatchObject({ tag: "li", owner: "Card", instanceIndex: 1, instanceCount: 3, source: { file: "/src/Card.jsx", ...positionOf(REACT_CARD, "<li"), mapped: true } });
    },
    prepareReactApp,
  );
});
