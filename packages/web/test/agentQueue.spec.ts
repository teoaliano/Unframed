import type { Locator, Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas } from "./canvas.ts";
import { answerApproval, createChat, engineChat, expect, openRail, pendingRequest, promptBox, rpcOf, scriptFolder, sendThrough, startAgentEngine, userTexts } from "./agent.ts";
import { test as base } from "./fixtures.ts";

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
  await expect(panel.getByTestId("live-dot")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Stop generation" })).toBeVisible();
  return { panel, chatId };
};

const type = async (panel: Locator, text: string, key = "Enter") => {
  const box = promptBox(panel);
  await box.click();
  await box.pressSequentially(text);
  await box.press(key);
};

test("a message sent while a turn runs waits as Queued and goes after the next tool call; Cancel returns it, Stop returns them all", async ({ page, agent }) => {
  const { panel, chatId } = await parkedChat(page, agent);
  await expect(panel.getByRole("button", { name: "Queue message" })).toBeVisible();
  await type(panel, "while you work");
  const queued = panel.getByTestId("queued-message");
  await expect(queued).toHaveCount(1);
  await expect(queued).toContainText("Queued");
  await expect(queued).toContainText("while you work");
  await queued.getByText("Queued").hover();
  await expect(page.getByText("Sends after the next tool call or when the turn ends", { exact: true })).toBeVisible();
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

  // Cancel gives a queued message back to the composer.
  await type(panel, "take me back");
  await expect(queued).toHaveCount(1);
  await queued.getByRole("button", { name: "Cancel and return to the composer" }).click();
  await expect(queued).toHaveCount(0);
  await expect(promptBox(panel)).toHaveText("take me back");

  // Two queued, the second after the first; Stop returns both and ends the turn.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await type(panel, "first");
  await type(panel, "second");
  await expect(queued).toHaveCount(2);
  await page.mouse.move(5, 5);
  await queued.nth(1).getByText("Queued").hover();
  await expect(page.getByText("Sends after the messages above it", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Stop generation" }).click();
  await expect(queued).toHaveCount(0);
  await expect(panel.locator(".ProseMirror p")).toHaveText(["first", "", "second"]);
  await expect.poll(async () => (await engineChat(agent, chatId)).latestTurn?.state).toBe("interrupted");
  expect(await userTexts(agent, chatId)).toEqual(before);
});

test("Steer sends into the running turn at once: Cmd+Enter under Queue, Send now on a queued one, and Enter under Steer", async ({ page, agent }) => {
  const { panel, chatId } = await parkedChat(page, agent);
  await type(panel, "steer with the modifier", "ControlOrMeta+Enter");
  await expect.poll(() => userTexts(agent, chatId)).toEqual(["park here", "steer with the modifier"]);
  await expect(panel.getByTestId("queued-message")).toHaveCount(0);
  expect((await engineChat(agent, chatId)).latestTurn?.state).toBe("running");

  await type(panel, "wait for it");
  await expect(panel.getByTestId("queued-message")).toHaveCount(1);
  await panel.getByTestId("queued-message").getByRole("button", { name: "Send now" }).click();
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
