import { openCanvas } from "./canvas.ts";
import { putRecords } from "./media.ts";
import { answerApproval, artifactColumn, createChat, expect, FIXTURES, openRail, say, scriptFolder, sendThrough, startAgentEngine } from "./agent.ts";
import { test } from "./fixtures.ts";

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
    await expect(rows.locator(".unframed-agent-work-row__label")).toHaveText(["Ran ls", "Read notes.md", "a.md", "Read the canvas", "Changed the canvas (2 changes)"]);
    for (let index = 0; index < 5; index++) await expect(rows.nth(index)).toHaveAttribute("data-state", "completed");

    // A command row opens to its command.
    await rows.first().getByRole("button").click();
    await expect(rows.first().locator(".unframed-agent-work-row__command")).toHaveText("ls -la");
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
    await expect(row.locator(".unframed-agent-work-row__label")).toHaveText("Running rm");
    await expect(row).toHaveAttribute("data-state", "inProgress");
    await answerApproval(agent, chatId, "decline");
    await expect(panel.locator("[data-role='assistant']")).toContainText("I did not remove the build folder.");
    await panel.getByTestId("worked-for").getByRole("button").click();
    await expect(row.locator(".unframed-agent-work-row__label")).toHaveText("Declined rm");
    await expect(row).toHaveAttribute("data-state", "declined");

    // Turn 2 parks on its own command; Stop ends it.
    await sendThrough(agent, chatId, "and dist too");
    await expect(panel.getByRole("button", { name: "Stop generation" })).toBeVisible();
    await panel.getByRole("button", { name: "Stop generation" }).click();
    await expect(panel.getByTestId("worked-for")).toHaveCount(2);
    await expect(panel.getByTestId("worked-for").nth(1).locator(".unframed-agent-work-group__head").first()).toHaveText(/^You stopped after \d+(\.\d)?s$/);
  } finally {
    await agent.dispose();
  }
});
