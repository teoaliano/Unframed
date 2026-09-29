import type { Page } from "@playwright/test";
import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { clickShape, composer, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { filledMedia, putRecords } from "./media.ts";
import { artifactColumn, expect, onlyChat, openRail, promptBox, rail, test } from "./agent.ts";
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

test("@ lists the project's shapes and files; choosing one puts a chip in the text and the shape in the context", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, artifactColumn([{ id: "shape:p1", title: "Alpha" }]));
  const { file } = await filledMedia(agent, { id: "shape:i1", type: "image", ref: "800", at: { x: -360, y: 60 }, bytes: pngBytes(40, 40), name: "still.png", mime: "image/png", natural: { w: 40, h: 40 }, width: 120 });
  await expect(shapeOnScreen(page, "shape:i1")).toHaveCount(1);
  const panel = await openRail(page);
  const box = promptBox(panel);
  const menu = page.getByRole("listbox", { name: "Mentions" });
  await box.click();

  await box.pressSequentially("@zzz");
  await expect(menu.getByText("No matching shapes or files.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(panel).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");

  // Media by label, and the files the canvas names.
  await box.pressSequentially("@still");
  await expect(menu.getByRole("option")).toHaveText([/still\.png/, new RegExp(`${file.replace(".", "\\.")}File`)]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(box.locator("[data-agent-chip]")).toHaveText([file]);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");

  await box.pressSequentially("@alp");
  await expect(menu.getByRole("option")).toHaveText(["Alpha"]);
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(box.locator("[data-agent-chip]")).toHaveText(["Alpha"]);
  await expect(panel.getByRole("list", { name: "Context" }).getByRole("listitem")).toHaveText(["Alpha"]);
  await box.pressSequentially("what is on the board?");
  await box.press("Enter");

  const chat = await onlyChat(agent, (current) => current.messages.some((message) => message.role === "user"));
  const sent = chat.messages.find((message) => message.role === "user")!;
  expect(sent.text).toBe("[Page: Alpha; ref=p1] what is on the board?");
  expect(sent.context).toEqual({ selection: ["shape:p1"] });
});
