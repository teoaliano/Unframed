import { expect, test } from "./fixtures.ts";
import { openCanvas } from "./canvas.ts";

test.describe("the canvas host", () => {
  test("mounts tldraw for the active project with one page, no page menu, no embeds or bookmarks, and the watermark visible", async ({
    page,
    engine,
  }) => {
    const connects: any[] = [];
    page.on("websocket", (socket) => {
      if (!new URL(socket.url()).pathname.startsWith("/sync/")) return;
      socket.on("framesent", ({ payload }) => {
        try {
          const message = JSON.parse(String(payload));
          if (message.type === "connect") connects.push(message);
        } catch {
          // a chunked frame
        }
      });
    });
    await openCanvas(page, engine);

    await expect(page.locator(".tl-container")).toBeVisible();
    await expect(page.locator(".tlui-page-menu__trigger")).toHaveCount(0);
    await expect(page.locator(".tlui-main-menu__trigger, [data-testid='main-menu.button']")).toHaveCount(0);
    await expect(page.locator("[data-testid='help-menu.button']")).toHaveCount(0);

    await expect.poll(() => connects.length).toBeGreaterThan(0);
    const sequences = Object.keys(connects[0].schema.sequences);
    expect(sequences).toEqual(expect.arrayContaining(["com.tldraw.shape.text", "com.tldraw.shape.page", "com.tldraw.shape.motion"]));
    expect(sequences.some((id) => id.includes("embed") || id.includes("bookmark"))).toBe(false);

    const watermark = page.locator("[data-testid^='tl-watermark']");
    await expect(watermark).toBeVisible();
    const box = (await watermark.boundingBox())!;
    const topmost = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid^='tl-watermark']") !== null,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(topmost).toBe(true);
  });
});
