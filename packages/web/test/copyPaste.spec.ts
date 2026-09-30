import { copySelection, openCanvas, plainText, roomRecords, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("copied prompts paste with fresh refs, and references between them follow the pasted copies", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const before = new Set((await roomRecords(engine, "default")).map((record) => record.id));
  await page.mouse.click(10, 400);
  await page.keyboard.press("ControlOrMeta+a");
  await copySelection(page);
  await page.keyboard.press("ControlOrMeta+v");

  const pasted = await waitForRoom(engine, "default", (records) => {
    const fresh = records.filter((record) => record.type === "text" && !before.has(record.id));
    return fresh.length === 2 ? fresh : undefined;
  });
  const subject = pasted.find((record) => plainText(record) === "lone red fox")!;
  const scene = pasted.find((record) => record !== subject)!;
  expect([subject.meta.ref, scene.meta.ref].sort()).toEqual(["102", "103"]);
  expect(plainText(scene)).toBe(`A @${subject.meta.ref} on a windswept cliff at golden hour, cinematic, 35mm`);

  // The originals keep their refs and still reference each other.
  const originals = await roomRecords(engine, "default");
  expect(originals.find((record) => record.id === "shape:starter-subject")!.meta.ref).toBe("100");
  expect(plainText(originals.find((record) => record.id === "shape:starter-scene"))).toBe("A @100 on a windswept cliff at golden hour, cinematic, 35mm");

  // Cut takes the selection away and pastes it back with fresh refs again.
  await page.keyboard.press("ControlOrMeta+x");
  await expect.poll(async () => (await roomRecords(engine, "default")).filter((record) => record.type === "text").length).toBe(2);
  await page.keyboard.press("ControlOrMeta+v");
  const again = await waitForRoom(engine, "default", (records) => {
    const texts = records.filter((record) => record.type === "text");
    return texts.length === 4 ? texts : undefined;
  });
  expect(new Set(again.map((record) => record.meta.ref)).size).toBe(4);
});
