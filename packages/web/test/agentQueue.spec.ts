import type { Locator, Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas } from "./canvas.ts";
import { answerApproval, createChat, engineChat, expect, openRail, pendingRequest, promptBox, rpcOf, scriptFolder, sendThrough, startAgentEngine, userTexts } from "./agent.ts";
import { test as base } from "./fixtures.ts";
import { platformOf } from "./platform.ts";

/** Every turn asks for one command, so a Supervised chat parks on it until it is answered. */
const PARKING = {
  when: "^park",
  turns: Array.from({ length: 6 }, (_, index) => ({ provider: [{ name: "Bash", input: { command: `make step-${index + 1}` } }], text: `Step ${index + 1} done.` })),
};

const test = base.extend<{ agent: TestEngine }>({
  agent: async ({}, use) => {
    const engine = await startAgentEngine({ script: await scriptFolder({ parking: PARKING }) });
    await use(engine);
    await engine.dispose();
  },
});

/** A Supervised chat parked on its first approval, open in the rail. */
const parkedChat = async (page: Page, agent: TestEngine): Promise<{ panel: Locator; chatId: string }> => {
  await openCanvas(page, agent);
  const chatId = await createChat(agent, { runtimeMode: "approval-required", title: "Parked" });
  await sendThrough(agent, chatId, "park here");
  const panel = await openRail(page);
  await expect(panel.getByTestId("chat-status")).toHaveAttribute("data-status", "running");
  await expect(panel.getByRole("button", { name: "Stop generation" })).toBeVisible();
  return { panel, chatId };
};

const type = async (panel: Locator, text: string, key = "Enter") => {
  const box = promptBox(panel);
  await box.click();
  await box.pressSequentially(text);
  await box.press(key);
};

const upNext = (panel: Locator) => panel.getByRole("region", { name: /^Up next/ });
const rowTexts = (panel: Locator) => panel.getByTestId("queued-message").getByTestId("queued-text").allInnerTexts();

test("a message sent while a turn runs waits in Up next above the composer and goes after the next tool call; Cancel returns it, Stop returns them all", async ({ page, agent }) => {
  const { panel, chatId } = await parkedChat(page, agent);
  await expect(panel.getByRole("button", { name: "Queue message" })).toBeVisible();
  await type(panel, "while you work");
  const queued = panel.getByTestId("queued-message");
  await expect(queued).toHaveCount(1);
  await expect(upNext(panel)).toHaveAccessibleName("Up next: 1 queued message");
  await expect(upNext(panel).getByRole("heading")).toHaveText(/^Up next\s*· 1 queued$/);
  await expect(queued).toContainText("while you work");
  // Above the composer, not in the transcript.
  await expect(panel.getByTestId("agent-tray").getByTestId("queued-message")).toHaveCount(1);
  expect(await userTexts(agent, chatId)).toEqual(["park here"]);

  // The approval blocks the queue; once the command is answered and completes, the message goes.
  await answerApproval(agent, chatId);
  await expect(queued).toHaveCount(0);
  await expect.poll(() => userTexts(agent, chatId)).toEqual(["park here", "while you work"]);

  // The queued message either joined the turn or started the next one, which parks on its own command.
  await expect.poll(async () => ((await pendingRequest(agent, chatId)) !== undefined ? "parked" : (await engineChat(agent, chatId)).latestTurn?.state)).toMatch(/parked|completed/);
  if ((await pendingRequest(agent, chatId)) === undefined) await sendThrough(agent, chatId, "park again");
  await expect.poll(async () => (await pendingRequest(agent, chatId)) !== undefined).toBe(true);
  const before = await userTexts(agent, chatId);
  await expect(panel.getByRole("button", { name: "Queue message" })).toBeVisible();

  // Cancel gives a queued message back to the composer, after what is being typed there.
  await type(panel, "take me back");
  await expect(queued).toHaveCount(1);
  await promptBox(panel).pressSequentially("half typed");
  await queued.getByRole("button", { name: "Cancel and return to the composer" }).click();
  await expect(queued).toHaveCount(0);
  await expect(panel.locator(".ProseMirror p")).toHaveText(["half typed", "", "take me back"]);

  // Two queued, the second after the first; Stop returns both and ends the turn.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await type(panel, "first");
  await type(panel, "second");
  await expect(queued).toHaveCount(2);
  await expect(upNext(panel).getByRole("heading")).toHaveText(/^Up next\s*· 2 queued$/);
  await panel.getByRole("button", { name: "Stop generation" }).click();
  await expect(queued).toHaveCount(0);
  await expect(panel.locator(".ProseMirror p")).toHaveText(["first", "", "second"]);
  await expect.poll(async () => (await engineChat(agent, chatId)).latestTurn?.state).toBe("interrupted");
  expect(await userTexts(agent, chatId)).toEqual(before);
});

test("Steer sends into the running turn at once: Cmd+Enter under Queue, Steer on a queued one, and Enter under Steer", async ({ page, agent }) => {
  const { panel, chatId } = await parkedChat(page, agent);
  await type(panel, "steer with the modifier", "ControlOrMeta+Enter");
  await expect.poll(() => userTexts(agent, chatId)).toEqual(["park here", "steer with the modifier"]);
  await expect(panel.getByTestId("queued-message")).toHaveCount(0);
  expect((await engineChat(agent, chatId)).latestTurn?.state).toBe("running");

  await type(panel, "wait for it");
  await expect(panel.getByTestId("queued-message")).toHaveCount(1);
  const { mac } = await platformOf(page);
  await panel.getByTestId("queued-message").getByRole("button", { name: "Steer" }).hover();
  await expect(page.getByText(`Send as a steer instead (${mac ? "⇧⌘Enter" : "Ctrl+Shift+Enter"})`, { exact: true })).toBeVisible();
  await panel.getByTestId("queued-message").getByRole("button", { name: "Steer" }).click();
  await expect(panel.getByTestId("queued-message")).toHaveCount(0);
  await expect.poll(async () => (await userTexts(agent, chatId)).at(-1)).toBe("wait for it");
  expect((await engineChat(agent, chatId)).latestTurn?.state).toBe("running");

  // With Follow-up behavior on Steer, Enter steers and Cmd+Enter queues.
  await (await rpcOf(agent)).call("preferences.set", { key: "agent.followUp", value: "steer" });
  await openCanvas(page, agent);
  const reopened = await openRail(page);
  await type(reopened, "steer by the setting");
  await expect.poll(async () => (await userTexts(agent, chatId)).at(-1)).toBe("steer by the setting");
  await type(reopened, "queue with the modifier", "ControlOrMeta+Enter");
  await expect(reopened.getByTestId("queued-message")).toHaveCount(1);
});

test("while a turn runs Send says what it will do: Queue message or Steer message by the setting, its tooltip names the other, and Cmd-click does the other once", async ({ page, agent }) => {
  const { panel, chatId } = await parkedChat(page, agent);
  const { mac } = await platformOf(page);
  const command = mac ? "⌘" : "Ctrl";
  const enter = mac ? "⌘Enter" : "Ctrl+Enter";
  const queueButton = panel.getByRole("button", { name: "Queue message" });
  await expect(queueButton.locator("svg.lucide-list-plus")).toHaveCount(1);
  await promptBox(panel).click();
  await promptBox(panel).pressSequentially("steered by a click");
  await queueButton.hover();
  await expect(page.getByText(`Click to queue, ${command}-click or ${enter} to steer`, { exact: true })).toBeVisible();
  await queueButton.click({ modifiers: ["ControlOrMeta"] });
  await expect.poll(() => userTexts(agent, chatId)).toEqual(["park here", "steered by a click"]);
  await expect(panel.getByTestId("queued-message")).toHaveCount(0);

  await (await rpcOf(agent)).call("preferences.set", { key: "agent.followUp", value: "steer" });
  const steerButton = panel.getByRole("button", { name: "Steer message" });
  await expect(steerButton.locator("svg.lucide-corner-up-right")).toHaveCount(1);
  await promptBox(panel).click();
  await promptBox(panel).pressSequentially("queued by a click");
  await page.mouse.move(5, 5);
  await steerButton.hover();
  await expect(page.getByText(`Click to steer, ${command}-click or ${enter} to queue`, { exact: true })).toBeVisible();
  await steerButton.click({ modifiers: ["ControlOrMeta"] });
  await expect(panel.getByTestId("queued-message")).toContainText("queued by a click");
});

test("Up next numbers its rows, folds beyond three, and reorders by dragging the grip or with its arrow keys; the new head goes first", async ({ page, agent }) => {
  const { panel, chatId } = await parkedChat(page, agent);
  for (const text of ["one", "two", "three", "four"]) await type(panel, text);
  const queued = panel.getByTestId("queued-message");
  await expect(upNext(panel).getByRole("heading")).toHaveText(/^Up next\s*· 4 queued$/);
  // Beyond three rows the first two show, then t3code's expand control.
  await expect(queued).toHaveCount(2);
  await panel.getByRole("button", { name: "Show all 4 queued" }).click();
  await expect(queued).toHaveCount(4);
  await expect(panel.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  expect(await rowTexts(panel)).toEqual(["one", "two", "three", "four"]);

  const grip = (position: number) => panel.getByRole("button", { name: `Reorder queued message ${position} of 4 (drag, or press the arrow keys)` });
  await grip(1).focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => rowTexts(panel)).toEqual(["two", "one", "three", "four"]);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => rowTexts(panel)).toEqual(["two", "three", "one", "four"]);
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => rowTexts(panel)).toEqual(["two", "one", "three", "four"]);

  await grip(4).dragTo(queued.nth(0), { targetPosition: { x: 20, y: 2 } });
  await expect.poll(() => rowTexts(panel)).toEqual(["four", "two", "one", "three"]);

  await answerApproval(agent, chatId);
  await expect.poll(async () => (await userTexts(agent, chatId)).at(1)).toBe("four");
});

test("Edit, or Alt+ArrowUp at the start of the composer, opens a queued message in the composer; Update saves it in place and the draft comes back; one sent meanwhile stays as the draft with a toast", async ({ page, agent }) => {
  const { panel, chatId } = await parkedChat(page, agent);
  const { mac } = await platformOf(page);
  await type(panel, "first draft");
  await type(panel, "second");
  await promptBox(panel).pressSequentially("my own draft");
  const queued = panel.getByTestId("queued-message");
  const lines = panel.locator(".ProseMirror p");

  await queued.nth(1).getByRole("button", { name: "Edit queued message" }).hover();
  await expect(page.getByText(`Edit in the composer (${mac ? "⌥Up" : "Alt+Up"})`, { exact: true })).toBeVisible();
  await queued.nth(0).getByRole("button", { name: "Edit queued message" }).click();
  await expect(lines).toHaveText(["first draft"]);
  await expect(queued.nth(0)).toContainText("Editing in the composer");
  const update = panel.getByRole("button", { name: "Update queued message" });
  await expect(update.locator("svg.lucide-check")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("first edited");
  await page.keyboard.press("Enter");
  await expect.poll(() => rowTexts(panel)).toEqual(["first edited", "second"]);
  await expect(lines).toHaveText(["my own draft"]);
  await expect(panel.getByRole("button", { name: "Queue message" })).toBeVisible();

  // Alt+ArrowUp edits the newest queued message, only with the caret at the start; Cancel puts the draft back.
  await promptBox(panel).press("Alt+ArrowUp");
  await expect(queued.nth(1)).not.toContainText("Editing in the composer");
  await expect(lines).toHaveText(["my own draft"]);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowLeft");
  await promptBox(panel).press("Alt+ArrowUp");
  await expect(lines).toHaveText(["second"]);
  await expect(queued.nth(1)).toContainText("Editing in the composer");
  await queued.nth(1).getByRole("button", { name: "Cancel editing queued message" }).click();
  await expect(lines).toHaveText(["my own draft"]);
  expect(await rowTexts(panel)).toEqual(["first edited", "second"]);

  // With an empty draft, an edit whose message is sent meanwhile stays in the composer as the draft.
  await promptBox(panel).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await queued.nth(0).getByRole("button", { name: "Edit queued message" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("too late");
  await answerApproval(agent, chatId);
  await expect.poll(async () => (await userTexts(agent, chatId)).at(1)).toBe("first edited");
  await expect(page.getByText("Queued message is no longer queued", { exact: true })).toBeVisible();
  await expect(page.getByText("Your unsaved edit was kept in the composer.", { exact: true })).toBeVisible();
  await expect(lines).toHaveText(["too late"]);
  await expect(panel.getByRole("button", { name: "Update queued message" })).toHaveCount(0);
});

test("with the Send shortcut on Cmd+Enter always, Enter breaks the line while a turn runs, Cmd+Enter does the Follow-up behavior, Cmd+Shift+Enter the other, and Cmd+Enter saves a queued edit", async ({ page, agent }) => {
  await (await rpcOf(agent)).call("preferences.set", { key: "agent.sendShortcut", value: "mod-enter" });
  const { panel, chatId } = await parkedChat(page, agent);
  const { mac } = await platformOf(page);
  const box = promptBox(panel);
  const lines = panel.locator(".ProseMirror p");
  await box.click();
  await box.pressSequentially("queue me");
  await box.press("Enter");
  await expect(lines).toHaveText(["queue me", ""]);
  await expect(panel.getByTestId("queued-message")).toHaveCount(0);
  await box.press("Backspace");
  await box.press("ControlOrMeta+Enter");
  await expect(panel.getByTestId("queued-message")).toHaveCount(1);
  expect(await userTexts(agent, chatId)).toEqual(["park here"]);

  // The tooltip names the chord that does the other action now.
  await box.pressSequentially("steer me");
  const queueButton = panel.getByRole("button", { name: "Queue message" });
  await queueButton.hover();
  await expect(page.getByText(`Click to queue, ${mac ? "⌘" : "Ctrl"}-click or ${mac ? "⇧⌘Enter" : "Ctrl+Shift+Enter"} to steer`, { exact: true })).toBeVisible();
  // Cmd+Shift+Enter steers this message; the queued one stays where it is.
  await box.press("ControlOrMeta+Shift+Enter");
  await expect.poll(() => userTexts(agent, chatId)).toEqual(["park here", "steer me"]);
  expect(await rowTexts(panel)).toEqual(["queue me"]);

  // Editing a queued message: Enter breaks the line, Cmd+Enter saves it.
  await box.click();
  await box.press("Alt+ArrowUp");
  await expect(lines).toHaveText(["queue me"]);
  await box.press("End");
  await box.press("Enter");
  await box.pressSequentially("and more");
  await box.press("ControlOrMeta+Enter");
  await expect.poll(() => rowTexts(panel)).toEqual(["queue me\nand more"]);
  await expect(panel.getByRole("button", { name: "Update queued message" })).toHaveCount(0);
});
