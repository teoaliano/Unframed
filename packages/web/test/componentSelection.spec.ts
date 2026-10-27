import { openCanvas } from "./canvas.ts";
import { componentShape, writeSheet } from "./components.ts";
import { clickShape, expect, openComposer, sendRun, test } from "./generation.ts";
import { promptRecord, putRecords } from "./media.ts";

test("a selection holding a component and a prompt sends the prompt alone, and the component never joins the request", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await writeSheet(engine, { tag: "uf-price-card", variants: { kind: ["primary", "secondary"] } });
  await putRecords(engine, [
    promptRecord("shape:fox", "fox", "a red fox", { x: 0, y: 0 }),
    componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 0 }, tag: "uf-price-card", title: "Price card" }),
  ]);
  await clickShape(page, "shape:fox");
  await clickShape(page, "shape:card", ["Shift"]);
  await openComposer(page);
  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(1);
  const request = generation.requests[0]!.body;
  expect(request.prompt).toBe("a red fox");
  expect(request.input_references ?? []).toHaveLength(0);
});
