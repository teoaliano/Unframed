import { centre, openCanvas, shapeOnScreen, toast } from "./canvas.ts";
import { filledArtifact } from "./artifacts.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { IPAD_DOTENV, openDevice, testIpad, type DeviceClient } from "./ipad.ts";
import { KEY, startSettingsEngine } from "./settings.ts";

const EDITOR_ON_MAC = "Open this on your Mac to edit or play it.";

test("a device shows an artifact as a still, offers no Parameters, and sends the editor back to the Mac", async ({ page }) => {
  const { engine } = await startSettingsEngine({ env: testIpad(), dotenv: `OPENROUTER_API_KEY=${KEY}\n${IPAD_DOTENV}` });
  let device: DeviceClient | undefined;
  try {
    const project = await openCanvas(page, engine);
    await filledArtifact(engine, {
      id: "shape:p1",
      kind: "page",
      ref: "150",
      at: { x: 0, y: 0 },
      size: { w: 260, h: 180 },
      title: "Poster",
      html: "<h1>Poster</h1>",
      project,
    });
    await expect(shapeOnScreen(page, "shape:p1")).toBeVisible();
    device = await openDevice(engine, project);
    await expect(shapeOnScreen(device.page, "shape:p1")).toBeVisible({ timeout: 20_000 });

    await clickShape(page, "shape:p1");
    await expect(page.locator("iframe[data-artifact-frame]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Parameters" })).toBeVisible();

    await clickShape(device.page, "shape:p1");
    await expect(device.page.getByRole("button", { name: "Editor" })).toBeVisible();
    await expect(device.page.locator("iframe[data-artifact-frame]")).toHaveCount(0);
    await expect(shapeOnScreen(device.page, "shape:p1")).toContainText("Select to preview");
    await expect(device.page.getByRole("button", { name: "Parameters" })).toHaveCount(0);

    await device.page.getByRole("button", { name: "Editor" }).click();
    await expect(toast(device.page, EDITOR_ON_MAC)).toBeVisible();
    await expect(device.page.getByTestId("artifact-editor")).toHaveCount(0);

    const at = await centre(shapeOnScreen(device.page, "shape:p1"));
    await device.page.mouse.dblclick(at.x, at.y);
    await expect(toast(device.page, EDITOR_ON_MAC)).toHaveCount(2);
    await expect(device.page.getByTestId("artifact-editor")).toHaveCount(0);
    await expect(device.page.locator("iframe[data-artifact-frame]")).toHaveCount(0);
  } finally {
    await device?.close();
    await engine.dispose();
  }
});
