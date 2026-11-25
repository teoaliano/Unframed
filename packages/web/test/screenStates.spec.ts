import { expect, test } from "./fixtures.ts";
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
