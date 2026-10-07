import { gate } from "../../engine/test/openRouterStub.ts";
import { editorFocused, openCanvas, plainText, roomRecords, shapeOnScreen, toast, waitForRoom } from "./canvas.ts";
import { clickShape, composer, instructionBox, openComposer, sendRun, toolbar } from "./generation.ts";
import { promptRecord, putRecords } from "./media.ts";
import { chooseText, expect, makeTextResult, mediumOption, sendText, test, textResults } from "./texting.ts";

test("a text run lands its answer beside the selection as a text result with its cost and @id", async ({ page, generation }) => {
  const held = gate<void>();
  generation.answerText(async () => {
    await held.promise;
    return { kind: "text", text: "A fox on a windswept cliff.\nGolden light.", cost: 0.0012 };
  });
  await openCanvas(page, generation.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseText(page);
  await sendText(page);

  // The placeholder says the run is in flight.
  await expect.poll(async () => (await textResults(generation)).length).toBe(1);
  const [placeholder] = await textResults(generation);
  expect(placeholder!.meta.unframed.run).toBeDefined();
  await expect(shapeOnScreen(page, placeholder!.id).getByRole("status")).toHaveText("Running…");

  held.release();
  await expect(shapeOnScreen(page, placeholder!.id)).toContainText("A fox on a windswept cliff.");
  await expect(shapeOnScreen(page, placeholder!.id).getByRole("status")).toHaveCount(0);
  const [result] = await textResults(generation);
  expect(plainText(result)).toBe("A fox on a windswept cliff.\nGolden light.");
  expect(result!.meta.ref).toBe("102");
  expect(result!.meta.unframed.result).toMatchObject({ medium: "text", model: "google/gemini-3.5-flash-lite", cost: 0.0012, sources: ["shape:starter-subject"] });
  await expect(shapeOnScreen(page, result!.id).locator("[data-shape-label]")).toHaveText("$0.0012 · @102");

  const subject = (await roomRecords(generation.engine, "default")).find((record) => record.id === "shape:starter-subject")!;
  expect(result!.x).toBeGreaterThan(subject.x!);
  expect(result!.y).toBe(subject.y);
  expect(generation.chat[0]!.body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "lone red fox" }] }]);
  // Nothing was paid for on the image endpoint.
  expect(generation.requests).toHaveLength(0);
});

test("a prompt referencing a text result sends its answer literally, @ tokens and all", async ({ page, generation }) => {
  generation.answerText(() => ({ kind: "text", text: "a painting of @100 in @101's light" }));
  await openCanvas(page, generation.engine);
  const result = await makeTextResult(page, generation);
  await putRecords(generation.engine, [promptRecord("shape:uses", "400", `Paint @${result.meta.ref}, twice`, { x: 40, y: 200 })]);
  await expect(shapeOnScreen(page, "shape:uses")).toBeVisible();

  await page.mouse.click(10, 400);
  await clickShape(page, "shape:uses");
  await openComposer(page);
  await mediumOption(page, "image").click();
  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(1);
  expect(generation.requests[0]!.body.prompt).toBe("Paint a painting of @100 in @101's light, twice");
});

test("editing a text result changes what it contributes, runs nothing, and stays literal", async ({ page, generation }) => {
  generation.answerText(() => ({ kind: "text", text: "first answer" }));
  await openCanvas(page, generation.engine);
  const result = await makeTextResult(page, generation);
  const calls = generation.chat.length;

  await page.mouse.click(10, 400);
  await shapeOnScreen(page, result.id).locator(".tl-rich-text").dblclick();
  await editorFocused(page);
  await page.keyboard.type("tidied, about @100");
  await page.keyboard.press("Escape");
  await waitForRoom(generation.engine, "default", (records) => plainText(records.find((record) => record.id === result.id)) === "tidied, about @100");
  await page.waitForTimeout(300);
  expect(generation.chat).toHaveLength(calls);
  const edited = (await roomRecords(generation.engine, "default")).find((record) => record.id === result.id)!;
  expect(edited.meta.unframed.result).toMatchObject({ medium: "text" });

  await putRecords(generation.engine, [promptRecord("shape:uses", "400", `See @${result.meta.ref}`, { x: 40, y: 200 })]);
  await expect(shapeOnScreen(page, "shape:uses")).toBeVisible();
  await page.mouse.click(10, 400);
  await clickShape(page, "shape:uses");
  await openComposer(page);
  await mediumOption(page, "image").click();
  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(1);
  expect(generation.requests[0]!.body.prompt).toBe("See tidied, about @100");
});

test("a text result's bar offers Generate, Regenerate and Agent, and Regenerate sends its recipe again from the composer", async ({ page, generation }) => {
  generation.answerText(() => ({ kind: "text", text: "first answer", cost: 0.001 }));
  await openCanvas(page, generation.engine);
  const first = await makeTextResult(page, generation);

  await page.mouse.click(10, 400);
  await clickShape(page, first.id);
  await expect(toolbar(page).getByRole("button")).toHaveText(["Generate", "Regenerate", "Agent"]);

  // Generate opens the composer on the answer as on any selection.
  await toolbar(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(composer(page).getByTestId("source-count")).toHaveText("1 selected");
  // The box takes the focus a frame after the composer opens; an Esc before then misses it.
  await expect(instructionBox(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);

  // Regenerate reopens the composer on the text medium over the recorded run; sent unchanged, it lands a second answer.
  // From nothing selected, so the click selects the answer rather than editing it.
  await page.mouse.click(10, 400);
  await clickShape(page, first.id);
  await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
  await expect(composer(page)).toBeVisible();
  await expect(mediumOption(page, "text")).toHaveAttribute("aria-checked", "true");
  await expect(composer(page).getByTestId("source-count")).toHaveText("recipe · 1 sources");
  generation.answerText(() => ({ kind: "text", text: "second answer", cost: 0.002 }));
  await sendText(page);
  await expect.poll(async () => (await textResults(generation)).filter((shape) => plainText(shape) === "second answer").length).toBe(1);
  expect(generation.chat).toHaveLength(2);
  expect(generation.chat[1]!.body).toEqual(generation.chat[0]!.body);
  const second = (await textResults(generation)).find((shape) => plainText(shape) === "second answer")!;
  expect(second.x).toBeGreaterThan(first.x!);
  const sidecar = JSON.parse((await generation.engine.request(`/api/file/default/${second.meta.unframed.result.sidecar}`)).text);
  expect(sidecar.recipe).toMatchObject({ medium: "text", selectionPrompt: "lone red fox", of: { sidecar: first.meta.unframed.result.sidecar, action: "recipe" } });

  // Changed in the box, the run sends the change.
  await page.mouse.click(10, 400);
  await clickShape(page, first.id);
  await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
  await expect(composer(page).getByTestId("source-count")).toHaveText("recipe · 1 sources");
  await instructionBox(page).click();
  await page.keyboard.type("shorter");
  generation.answerText(() => ({ kind: "text", text: "third answer" }));
  await sendText(page);
  await expect.poll(() => generation.chat.length).toBe(3);
  expect(generation.chat[2]!.body.messages[0].content).toEqual([{ type: "text", text: "lone red fox\n\nshorter" }]);
});

test("a text result with no known cost shows its @id alone, and a failed run says why", async ({ page, generation }) => {
  generation.answerText(() => ({ kind: "text", text: "An answer.", cost: null }));
  await openCanvas(page, generation.engine);
  const result = await makeTextResult(page, generation);
  await expect(shapeOnScreen(page, result.id).locator("[data-shape-label]")).toHaveText(`@${result.meta.ref}`);

  generation.answerText(() => ({ kind: "status", status: 500, body: { error: { message: "model overloaded" } } }));
  await page.mouse.click(10, 400);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseText(page);
  await sendText(page);
  await expect(toast(page, "0 of 1 succeeded. OpenRouter (500): model overloaded")).toBeVisible();
  await expect.poll(async () => (await textResults(generation)).length).toBe(1);
});
