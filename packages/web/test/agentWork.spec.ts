import { openCanvas } from "./canvas.ts";
import { putRecords } from "./media.ts";
import { answerApproval, artifactColumn, createChat, expect, FIXTURES, openRail, say, scriptFolder, sendThrough, startAgentEngine } from "./agent.ts";
import { test } from "./fixtures.ts";
import { expectSlot, expectToken, inBothSchemes, resolvedColor, styleOf } from "./kit.ts";

const WORK = {
  when: "^do the work",
  turns: [
    {
      provider: [
        { name: "Bash", input: { command: "ls -la" } },
        { name: "Read", input: { file_path: "notes.md" } },
        { name: "Edit", input: { file_path: "a.md" } },
      ],
      tools: [
        { name: "canvas_read", input: {} },
        { name: "canvas_write", input: { ops: [{ type: "update", id: "m1", props: { title: "Worked" } }, { type: "move", id: "m1", x: -600, y: 80 }] } },
      ],
      text: "All done.",
    },
  ],
};

test("a turn's tool calls fold into a group with the counted summary, rows carry their labels, and the settled turn folds behind Worked for", async ({ page }) => {
  const agent = await startAgentEngine({ script: await scriptFolder({ work: WORK }) });
  try {
    await openCanvas(page, agent);
    await putRecords(agent, artifactColumn([{ id: "shape:m1", kind: "motion", title: "Intro" }]));
    const panel = await openRail(page);
    await say(panel, "do the work please");
    await expect(panel.locator("[data-role='assistant']")).toContainText("All done.");

    const worked = panel.getByTestId("worked-for");
    await expect(worked.getByRole("button")).toHaveText(/^Worked for \d+(\.\d)?s$/);
    await expect(panel.getByTestId("work-group")).toHaveCount(0);
    await worked.getByRole("button").click();
    const group = panel.getByTestId("work-group");
    await expect(group.getByRole("button").first()).toHaveText("Ran 1 command, read 1 file, changed 1 file, used 1 tool, and changed the canvas 1 time");
    await group.getByRole("button").first().click();
    const rows = group.getByTestId("work-row");
    await expect(rows.getByTestId("work-row-label")).toHaveText(["Ran ls", "Read notes.md", "a.md", "Read the canvas", "Changed the canvas (2 changes)"]);
    for (let index = 0; index < 5; index++) await expect(rows.nth(index)).toHaveAttribute("data-state", "completed");

    // A command row opens to its command.
    await rows.first().getByRole("button").click();
    await expect(rows.first().getByTestId("work-row-command")).toHaveText("ls -la");
  } finally {
    await agent.dispose();
  }
});

test("a running call reads Running, a declined one Declined, and a stopped turn reads You stopped after", async ({ page }) => {
  const agent = await startAgentEngine({ script: FIXTURES });
  try {
    await openCanvas(page, agent);
    const chatId = await createChat(agent, { runtimeMode: "approval-required", title: "Cleanup" });
    await sendThrough(agent, chatId, "clean the build please");
    const panel = await openRail(page);
    const row = panel.getByTestId("work-row");
    await expect(row.getByTestId("work-row-label")).toHaveText("Running rm");
    await expect(row).toHaveAttribute("data-state", "inProgress");
    await answerApproval(agent, chatId, "decline");
    await expect(panel.locator("[data-role='assistant']")).toContainText("I did not remove the build folder.");
    await panel.getByTestId("worked-for").getByRole("button").click();
    await expect(row.getByTestId("work-row-label")).toHaveText("Declined rm");
    await expect(row).toHaveAttribute("data-state", "declined");

    // Turn 2 parks on its own command; Stop ends it.
    await sendThrough(agent, chatId, "and dist too");
    await expect(panel.getByRole("button", { name: "Stop generation" })).toBeVisible();
    await panel.getByRole("button", { name: "Stop generation" }).click();
    await expect(panel.getByTestId("worked-for")).toHaveCount(2);
    await expect(panel.getByTestId("worked-for").nth(1).getByRole("button").first()).toHaveText(/^You stopped after \d+(\.\d)?s$/);
  } finally {
    await agent.dispose();
  }
});

test("sub-agents fold into one row per spawn that opens to each one's state and duration", async ({ page }) => {
  const agent = await startAgentEngine({ script: FIXTURES });
  try {
    await openCanvas(page, agent);
    const panel = await openRail(page);
    await say(panel, "research these in parallel");
    await expect(panel.locator("[data-role='assistant']")).toContainText("Two of the three helpers finished.");
    await panel.getByTestId("worked-for").getByRole("button").first().click();
    const spawn = panel.getByTestId("subagents");
    await expect(spawn.getByRole("button")).toHaveText("Kicked off 3 subagents1 failed");
    await spawn.getByRole("button").click();
    const rows = spawn.locator("li");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveText(/^Read the briefcompleted · \d+(\.\d)?s$/);
    await expect(rows.nth(1)).toHaveText(/^Collect the stillscompleted · \d+(\.\d)?s$/);
    await expect(rows.nth(2)).toHaveText(/^Check the fontsfailed · \d+(\.\d)?s$/);
    await expect(rows.nth(2)).toHaveAttribute("data-state", "failed");
  } finally {
    await agent.dispose();
  }
});

test("the activity line says what the agent is doing, Thinking… before any tool, and adds the time from ten seconds", async ({ page }) => {
  const agent = await startAgentEngine({ script: FIXTURES });
  try {
    await page.clock.install();
    await openCanvas(page, agent);
    const asking = await createChat(agent, { title: "Asking", createdAt: "2026-09-01T10:00:00.000Z" });
    await sendThrough(agent, asking, "ask me first about the page");
    const panel = await openRail(page);
    const line = panel.getByTestId("activity-line");
    await expect(line).toHaveText("Thinking…");

    const cleaning = await createChat(agent, { title: "Cleaning", runtimeMode: "approval-required", createdAt: "2026-09-02T10:00:00.000Z" });
    await sendThrough(agent, cleaning, "clean the build please");
    await panel.getByRole("tab", { name: "Cleaning" }).click();
    await expect(line).toHaveText("Running a command…");
    await page.clock.fastForward(11_000);
    await expect(line).toHaveText(/^Running a command… 0:1\d$/);
  } finally {
    await agent.dispose();
  }
});

test("the transcript is t3code's timeline: the person's bubble, the reply in chat markdown, timeline rows with a muted body, and the recap on the card", async ({ page }) => {
  const agent = await startAgentEngine({ script: await scriptFolder({ work: WORK }) });
  try {
    await openCanvas(page, agent);
    await putRecords(agent, artifactColumn([{ id: "shape:m1", kind: "motion", title: "Intro" }]));
    const panel = await openRail(page);
    await say(panel, "do the work please");
    await expect(panel.locator("[data-role='assistant']")).toContainText("All done.");
    await panel.getByTestId("worked-for").getByRole("button").click();
    await panel.getByTestId("work-group").getByRole("button").first().click();
    const command = panel.getByTestId("work-row").first();
    await command.getByRole("button").click();

    await inBothSchemes(page, async () => {
      await page.mouse.move(10, 400);
      const bubble = panel.getByTestId("message-bubble");
      await expectToken(bubble, "background-color", "--message-surface");
      await expectToken(bubble, "color", "--color-message-foreground");
      await expectSlot(panel.locator("[data-role='user']").getByRole("button", { name: "Edit from here" }), "button");
      const reply = panel.locator("[data-role='assistant'] .chat-markdown");
      expect(await styleOf(reply, "font-size")).toBe("14px");
      await expectToken(panel.locator("[data-role='assistant'] header"), "color", "--color-muted-foreground");

      // A timeline row: the muted heading, and the expanded body on the muted fill.
      await expectToken(command.getByTestId("work-row-label"), "color", "--color-secondary-label");
      expect(await styleOf(command.getByTestId("work-row-body"), "background-color")).toBe(await resolvedColor(page, "color-mix(in oklab, var(--muted) 40%, transparent)"));

      const recap = panel.getByTestId("recap-card");
      await expectToken(recap, "background-color", "--card");
      await expectToken(recap, "border-top-color", "--color-border");
      await expectSlot(recap.getByRole("button", { name: "Revert this turn" }), "button");
    });
  } finally {
    await agent.dispose();
  }
});
