import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { createChat, engineChat, expect, FIXTURES, openRail, say, test } from "./agent.ts";
import { expectSlot, expectToken, inBothSchemes, resolvedColor, styleOf } from "./kit.ts";

const reply = (panel: Locator) => panel.locator("[data-role='assistant']");

test("an approval shows its header, tool and target above the composer; Approve lets the turn finish and Decline ends it with the refused text", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await createChat(agent, { runtimeMode: "approval-required", title: "Cleanup" });
  const panel = await openRail(page);
  await say(panel, "clean the build please");

  const approval = panel.getByTestId("approval-panel");
  await expect(approval.getByTestId("panel-title")).toHaveText("Command approval");
  await expect(approval.getByTestId("panel-tool")).toHaveText("Bash");
  await expect(approval.getByTestId("approval-target")).toHaveText("rm -rf build");
  await expect(panel.locator("[data-placeholder]")).toHaveAttribute("data-placeholder", "Resolve this approval request to continue");
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(approval).toHaveCount(0);
  await expect(reply(panel).last()).toContainText("Removed the build folder.");
  await expect(panel.locator("[data-placeholder]")).toHaveAttribute("data-placeholder", /^Ask, or say what should change/);

  await say(panel, "and dist too");
  await expect(approval.getByTestId("approval-target")).toHaveText("rm -rf dist");
  await approval.getByRole("button", { name: "Decline" }).click();
  await expect(approval).toHaveCount(0);
  await expect(reply(panel).last()).toContainText("I did not remove dist.");
});

test("Always allow this session answers this ask and skips the next one", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await createChat(agent, { runtimeMode: "approval-required", title: "Cleanup" });
  const panel = await openRail(page);
  await say(panel, "clean the build please");
  const approval = panel.getByTestId("approval-panel");
  await approval.getByRole("button", { name: "More approval options" }).click();
  await page.getByRole("menuitem", { name: "Always allow this session" }).click();
  await expect(reply(panel).last()).toContainText("Removed the build folder.");

  await say(panel, "and dist too");
  await expect(reply(panel).last()).toContainText("Removed dist too.");
  await expect(approval).toHaveCount(0);
});

test("a padded command shows its first 300 characters with the padding kept, and says how many it held back", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await createChat(agent, { runtimeMode: "approval-required", title: "Tidy" });
  const panel = await openRail(page);
  await say(panel, "tidy up the repo");

  const approval = panel.getByTestId("approval-panel");
  const padded = JSON.parse(await readFile(join(FIXTURES, "padded.json"), "utf8"));
  const command: string = padded.turns[0].provider[0].input.command;
  const target = approval.getByTestId("approval-target");
  await expect(target).toHaveText(command.slice(0, 300), { useInnerText: true });
  await expect(target).toHaveCSS("white-space", "pre-wrap");
  await expect(approval.getByTestId("approval-warning")).toHaveText(
    `and ${command.length - 300} more characters not shown. Decline unless you know what they are.`,
  );
  await approval.getByRole("button", { name: "Decline" }).click();
  await expect(reply(panel).last()).toContainText("I did not run it.");
});

test("a question shows its header, i/N and options; choosing and submitting sends the answers and releases the turn", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const chatId = await createChat(agent, { title: "Asking" });
  const panel = await openRail(page);
  await say(panel, "ask me first about the page");

  const question = panel.getByTestId("question-panel");
  await expect(question.getByTestId("panel-title")).toHaveText("Look");
  await expect(question.getByTestId("panel-count")).toHaveText("1/2");
  await expect(question.getByTestId("panel-question")).toHaveText("Which look should the page have?");
  await expect(question.getByRole("radio")).toHaveText(["1WarmCream background, dark brown type", "2CoolPale grey background, navy type"]);
  await expect(panel.locator("[data-placeholder]")).toHaveAttribute("data-placeholder", "Type your own answer, or leave this blank to use the selected option");
  await expect(panel.getByRole("button", { name: "Next question" })).toBeDisabled();

  // A single choice moves on by itself; the second question takes several, from keys too.
  await question.getByRole("radio", { name: /Cool/ }).click();
  await expect(question.getByTestId("panel-title")).toHaveText("Sections");
  await expect(question.getByTestId("panel-count")).toHaveText("2/2");
  await expect(question.getByText("Select one or more options.")).toBeVisible();
  await expect(panel.locator("[data-placeholder]")).toHaveAttribute("data-placeholder", "Choose an option above");
  await expect(panel.getByRole("button", { name: "Previous" })).toBeVisible();
  await question.getByRole("checkbox", { name: /Hero/ }).click();
  await page.keyboard.press("3");
  await expect(question.getByRole("checkbox", { name: /Footer/ })).toHaveAttribute("aria-checked", "true");

  await panel.getByRole("button", { name: "Submit answers" }).click();
  await expect(question).toHaveCount(0);
  await expect(reply(panel).last()).toContainText("Thanks. I will build the page with the look and sections you picked.");
  const resolved = (await engineChat(agent, chatId)).activities.find((activity) => activity.kind === "user-input.resolved");
  expect((resolved?.payload as { answers?: unknown }).answers).toEqual({ "Which look should the page have?": "Cool", "Which sections should it have?": ["Hero", "Footer"] });
});

test("an answer of one's own is typed in the composer and wins over the chosen option", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const chatId = await createChat(agent, { title: "Asking" });
  const panel = await openRail(page);
  await say(panel, "ask me first about the page");
  const question = panel.getByTestId("question-panel");
  await expect(question.getByTestId("panel-count")).toHaveText("1/2");
  await say(panel, "Sepia, like an old photo");
  await expect(question.getByTestId("panel-count")).toHaveText("2/2");
  await panel.getByRole("button", { name: "Previous" }).click();
  await expect(panel.getByRole("textbox", { name: "Message the agent" })).toHaveText("Sepia, like an old photo");
  await panel.getByRole("button", { name: "Next question" }).click();
  await question.getByRole("checkbox", { name: /Gallery/ }).click();
  await panel.getByRole("button", { name: "Submit answers" }).click();
  await expect(reply(panel).last()).toContainText("Thanks. I will build the page with the look and sections you picked.");
  const resolved = (await engineChat(agent, chatId)).activities.find((activity) => activity.kind === "user-input.resolved");
  expect((resolved?.payload as { answers?: unknown }).answers).toEqual({ "Which look should the page have?": "Sepia, like an old photo", "Which sections should it have?": ["Gallery"] });
});

test("the approval panel is t3code's pending approval: the warning-tinted banner with its kit action Buttons", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await createChat(agent, { runtimeMode: "approval-required", title: "Cleanup" });
  const panel = await openRail(page);
  await say(panel, "clean the build please");
  const approval = panel.getByTestId("approval-panel");
  await expect(approval.getByTestId("approval-target")).toHaveText("rm -rf build");
  await inBothSchemes(page, async () => {
    await page.mouse.move(10, 400);
    await expectToken(approval.getByTestId("panel-title"), "color", "--warning");
    expect(await styleOf(approval, "border-top-color")).toBe(await resolvedColor(page, "color-mix(in oklab, var(--warning) 28%, transparent)"));
    expect(await styleOf(approval.getByTestId("approval-target"), "font-family")).toContain("monospace");
    const approve = approval.getByRole("button", { name: "Approve" });
    await expectSlot(approve, "button");
    await expectToken(approve, "background-color", "--primary");
    await expectSlot(approval.getByRole("button", { name: "Decline" }), "button");
    await expectSlot(approval.getByRole("button", { name: "More approval options" }), "menu-trigger");
  });
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(approval).toHaveCount(0);
});

test("the question panel is t3code's: kit Buttons in its header, option rows that take a key and show the choice", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await createChat(agent, { title: "Asking" });
  const panel = await openRail(page);
  await say(panel, "ask me first about the page");
  const question = panel.getByTestId("question-panel");
  await expect(question.getByTestId("panel-title")).toHaveText("Look");
  await expectSlot(question.getByRole("button", { name: "Hide question" }), "button");
  await question.getByRole("radio", { name: /Warm/ }).focus();
  await page.keyboard.press("Enter");
  await expect(question.getByTestId("panel-title")).toHaveText("Sections");
  const hero = question.getByRole("checkbox", { name: /Hero/ });
  await hero.click();
  await expect(hero).toHaveAttribute("aria-checked", "true");
  await page.mouse.move(10, 400);
  const selected = await resolvedColor(page, "color-mix(in oklab, var(--muted) 55%, transparent)");
  await expect.poll(() => styleOf(hero, "background-color")).toBe(selected);
  await expectSlot(panel.getByRole("button", { name: "Submit answers" }), "message-action");
});
