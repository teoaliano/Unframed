import type { Page } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { clickShape, composer, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { filledMedia, putRecords } from "./media.ts";
import { artifactColumn, expect, onlyChat, promptBox, rail, test } from "./agent.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A page and two filled images, left of the starter prompts. */
const pageAndImages = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await putRecords(engine, artifactColumn([{ id: "shape:p1", title: "Alpha" }]));
  for (const [index, id] of ["shape:i1", "shape:i2"].entries()) {
    await filledMedia(engine, { id, type: "image", ref: String(800 + index), at: { x: -360, y: 60 + index * 130 }, bytes: pngBytes(40, 40, index), name: `still-${index}.png`, mime: "image/png", natural: { w: 40, h: 40 }, width: 120 });
  }
  await openCanvas(page, engine);
  await clickShape(page, "shape:p1");
  await clickShape(page, "shape:i1", ["Shift"]);
  await clickShape(page, "shape:i2", ["Shift"]);
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("3 selected");
};

const openAgentTray = async (page: Page) => {
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(composer(page)).toHaveAttribute("data-tray", "agent");
};

const chips = (page: Page) => composer(page).getByRole("list", { name: "Context" }).getByRole("listitem");

test("the selection enters the Agent tray as chips; removing one trims the message and leaves the canvas selection alone", async ({ page, agent }) => {
  await pageAndImages(page, agent);
  await openAgentTray(page);
  await expect(chips(page)).toHaveText(["Alpha", "2 images"]);
  await expect(chips(page).first().locator("svg")).toHaveCount(2);

  await composer(page).getByRole("button", { name: "Remove 2 images" }).click();
  await expect(chips(page)).toHaveText(["Alpha"]);
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("3 selected");

  // Opened again, the tray starts from the selection.
  await openAgentTray(page);
  await expect(chips(page)).toHaveText(["Alpha", "2 images"]);
  await composer(page).getByRole("button", { name: "Remove 2 images" }).click();
  await promptBox(composer(page)).pressSequentially("what is on the board?");
  await promptBox(composer(page)).press("Enter");
  await expect(rail(page)).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("3 selected");

  const chat = await onlyChat(agent, (current) => current.messages.some((message) => message.role === "user"));
  expect(chat.messages.find((message) => message.role === "user")?.context).toEqual({ selection: ["shape:p1"] });
  expect(chat.tags).toEqual(["shape:p1"]);
});
