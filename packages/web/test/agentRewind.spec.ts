import type { Page } from "@playwright/test";
import { openCanvas, roomShapes } from "./canvas.ts";
import { putRecords } from "./media.ts";
import { artifactColumn, engineChats, expect, openRail, promptBox, scriptFolder, startAgentEngine, userTexts } from "./agent.ts";
import { test as base } from "./fixtures.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const retitle = (title: string) => ({ name: "canvas_write", input: { ops: [{ type: "update", id: "m1", props: { title } }] } });

const RETITLE = {
  when: "^retitle",
  turns: [
    { text: "Red now.", tools: [retitle("Intro (red)")] },
    { text: "Blue now.", tools: [retitle("Intro (blue)")] },
    { text: "Blue again.", tools: [retitle("Intro (blue)")] },
    { text: "Green now.", tools: [retitle("Intro (green)")] },
  ],
};

const test = base.extend<{ agent: TestEngine }>({
  agent: async ({}, use) => {
    const engine = await startAgentEngine({ script: await scriptFolder({ retitle: RETITLE }) });
    await use(engine);
    await engine.dispose();
  },
});

const title = async (engine: TestEngine) => (await roomShapes(engine, "default", "motion")).find((shape) => shape.id === "shape:m1")?.props.title;

const send = async (page: Page, text: string, replies: number) => {
  const panel = page.getByRole("complementary", { name: "Agent" });
  await promptBox(panel).click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(panel.locator("[data-role='assistant']")).toHaveCount(replies);
};

const editFrom = async (page: Page, index: number, choice: "Revert canvas changes too" | "Revert and keep changes") => {
  const panel = page.getByRole("complementary", { name: "Agent" });
  await panel.locator("[data-role='user']").nth(index).getByRole("button", { name: "Edit from here" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Edit from here?", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Rewind chat to before this message. Your prompt and attachments return to the composer.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button")).toHaveText(["Cancel", "Revert canvas changes too", "Revert and keep changes"]);
  await dialog.getByRole("button", { name: choice }).click();
};

test("Edit from here rewinds the chat and puts the message back; only Revert canvas changes too takes the canvas back", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, artifactColumn([{ id: "shape:m1", kind: "motion", title: "Intro" }]));
  const panel = await openRail(page);
  await send(page, "retitle it red", 1);
  await send(page, "retitle it blue", 2);
  expect(await title(agent)).toBe("Intro (blue)");
  const [summary] = await engineChats(agent);

  // Revert canvas changes too: the chat forgets the second message, its change is taken back, the text comes back.
  await editFrom(page, 1, "Revert canvas changes too");
  await expect(panel.locator("[data-role='user']")).toHaveCount(1);
  await expect(panel.locator("[data-role='assistant']")).toHaveText([/Red now\./]);
  await expect(promptBox(panel)).toHaveText("retitle it blue");
  await expect.poll(() => userTexts(agent, summary!.id)).toEqual(["retitle it red"]);
  await expect.poll(() => title(agent)).toBe("Intro (red)");

  await promptBox(panel).click();
  await page.keyboard.press("Enter");
  await expect(panel.locator("[data-role='assistant']")).toHaveCount(2);
  await expect.poll(() => title(agent)).toBe("Intro (blue)");

  // Revert and keep changes: the chat rewinds, the canvas stays as it is.
  await editFrom(page, 1, "Revert and keep changes");
  await expect(panel.locator("[data-role='user']")).toHaveCount(1);
  await expect(promptBox(panel)).toHaveText("retitle it blue");
  await expect.poll(() => userTexts(agent, summary!.id)).toEqual(["retitle it red"]);
  expect(await title(agent)).toBe("Intro (blue)");

  // A shape the person changed since is left alone, and the rail says so.
  await putRecords(agent, artifactColumn([{ id: "shape:m1", kind: "motion", title: "Hand-made" }]));
  await editFrom(page, 0, "Revert canvas changes too");
  await expect(panel.getByRole("alert")).toHaveText("Nothing to revert: everything this turn changed has changed since.");
  expect(await title(agent)).toBe("Hand-made");
  await expect(panel.locator("[data-role='user']")).toHaveCount(0);
});
