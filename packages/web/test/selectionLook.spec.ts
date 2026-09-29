import type { Page } from "@playwright/test";
import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { emptyMedia, putRecords } from "./media.ts";

type Rgb = [number, number, number];

/** The screen's pixels in a region, read from a real screenshot. */
const screenPixels = async (page: Page, clip: { x: number; y: number; width: number; height: number }) => {
  const png = await page.screenshot({ clip });
  const data: number[] = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data);
  }, png.toString("base64"));
  return {
    png,
    at: (x: number, y: number): Rgb => {
      const index = (Math.round(y - clip.y) * clip.width + Math.round(x - clip.x)) * 4;
      return [data[index]!, data[index + 1]!, data[index + 2]!];
    },
  };
};

/** A token's colour as sRGB bytes, drawn through a canvas so any CSS colour syntax reads the same. */
const token = (page: Page, name: string) =>
  page.evaluate((property) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${property})`;
    document.body.append(probe);
    const context = new OffscreenCanvas(1, 1).getContext("2d")!;
    context.fillStyle = getComputedStyle(probe).color;
    probe.remove();
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!] as [number, number, number];
  }, name);

const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("the selection is a thin accent line with square grips, drawn from the selection alone; hover changes nothing", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [emptyMedia("shape:a", "image", "150", { x: 440, y: 60 }), emptyMedia("shape:b", "image", "151", { x: 440, y: 300 })]);
  await expect(shapeOnScreen(page, "shape:b")).toBeVisible();
  const accent = await token(page, "--highlight");
  const canvas = await token(page, "--background");

  const a = (await shapeOnScreen(page, "shape:a").boundingBox())!;
  const b = (await shapeOnScreen(page, "shape:b").boundingBox())!;
  const aroundB = { x: Math.floor(b.x) - 12, y: Math.floor(b.y) - 12, width: Math.ceil(b.width) + 24, height: Math.ceil(b.height) + 24 };

  // Hovering an unselected shape draws nothing.
  await page.mouse.move(5, 450);
  const idle = await screenPixels(page, aroundB);
  await page.mouse.move(b.x + b.width - 20, b.y + b.height - 20);
  await page.waitForTimeout(300);
  const hovered = await screenPixels(page, aroundB);
  expect(hovered.png.equals(idle.png)).toBe(true);

  await page.mouse.click(a.x + 20, a.y + 20);
  await page.mouse.move(5, 450);
  await page.waitForTimeout(300);
  const selected = await screenPixels(page, { x: Math.floor(a.x) - 12, y: Math.floor(a.y) - 12, width: Math.ceil(a.width) + 24, height: Math.ceil(a.height) + 24 });
  // The line along the top edge is the accent colour.
  const onLine = [0, 1, -1].map((dy) => selected.at(a.x + a.width / 2, a.y + dy)).sort((p, q) => distance(p, accent) - distance(q, accent))[0]!;
  expect(distance(onLine, accent)).toBeLessThan(distance(onLine, canvas));
  // A grip sticks out past the corner, where a bare line would leave the canvas showing.
  const outside = selected.at(a.x - 3, a.y + 1);
  expect(distance(outside, canvas)).toBeGreaterThan(10);
  // Just beyond the grip is canvas again.
  expect(distance(selected.at(a.x - 7, a.y + 1), canvas)).toBeLessThan(10);

  // Focus moving elsewhere leaves the selection drawn.
  await page.getByRole("button", { name: "Help" }).focus();
  await page.waitForTimeout(200);
  const focusedAway = await screenPixels(page, { x: Math.floor(a.x) - 12, y: Math.floor(a.y) - 12, width: Math.ceil(a.width) + 24, height: Math.ceil(a.height) + 24 });
  expect(distance(focusedAway.at(a.x - 3, a.y + 1), canvas)).toBeGreaterThan(10);
});
