import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { createChat, engineChat, expect, FIXTURES, openRail, pendingRequest, promptBox, say, scriptFolder, sendThrough, startAgentEngine, test } from "./agent.ts";
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

test("an approval offers the provider's answers: its reason under the target, no standing grant when it says so, and a warning on an answer", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await createChat(agent, { runtimeMode: "approval-required", title: "Guarded" });
  const panel = await openRail(page);
  await say(panel, "a guarded delete please");

  const approval = panel.getByTestId("approval-panel");
  await expect(approval.getByTestId("approval-target")).toHaveText("rm -rf ../shared/cache");
  await expect(approval.getByTestId("approval-reason")).toHaveText("This deletes files outside the project folder.");
  await expect(approval.getByRole("button")).toHaveText(["Decline", "Approve"]);
  await expect(approval.getByRole("button", { name: "More approval options" })).toHaveCount(0);
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(reply(panel).last()).toContainText("Cleared the shared cache.");

  await say(panel, "now install it");
  const runAnyway = approval.getByRole("button", { name: "Run anyway" });
  await expect(runAnyway).toHaveAttribute("aria-description", "This runs a script from the internet.");
  await expect(approval.getByTestId("approval-reason")).toHaveCount(0);
  await runAnyway.hover();
  await expect(page.locator("[data-slot='tooltip-popup']")).toHaveText("This runs a script from the internet.");
  await approval.getByRole("button", { name: "More approval options" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Stop the turn"]);
  await page.keyboard.press("Escape");
  await approval.getByRole("button", { name: "Decline" }).click();
  await expect(reply(panel).last()).toContainText("I did not install it.");
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
    await expectToken(approval.getByTestId("panel-title"), "color", "--banner-warning-title");
    expect(await styleOf(approval, "border-top-color")).toBe(await resolvedColor(page, "color-mix(in oklab, var(--banner-warning-border) var(--banner-warning-border-opacity), transparent)"));
    expect(await styleOf(approval.getByTestId("approval-target"), "font-family")).toContain("monospace");
    const approve = approval.getByRole("button", { name: "Approve" });
    await expectSlot(approve, "button");
    await expectToken(approve, "background-color", "--button-default-surface");
    await expectSlot(approval.getByRole("button", { name: "Decline" }), "button");
    await expectSlot(approval.getByRole("button", { name: "More approval options" }), "menu-trigger");
  });
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(approval).toHaveCount(0);
});

test("the question panel is t3code's: kit Buttons in its header and for its options, which take a key and show the choice", async ({ page, agent }) => {
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
  // An option is a kit ghost Button in the checkbox or radio role; the chosen one shows the pressed fill.
  await expectSlot(hero, "button");
  await expectToken(hero, "background-color", "--button-ghost-surface-pressed");
  await expectSlot(panel.getByRole("button", { name: "Submit answers" }), "message-action");
});

test("a question that arrives over a draft sets the draft aside: the box takes the answer, and the draft comes back once it is answered", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const chatId = await createChat(agent, { title: "Asking" });
  const panel = await openRail(page);
  const box = promptBox(panel);
  await box.click();
  await box.pressSequentially("my own draft");
  await box.blur();
  await sendThrough(agent, chatId, "ask me first about the page");

  const question = panel.getByTestId("question-panel");
  await expect(question.getByTestId("panel-count")).toHaveText("1/2");
  await expect(box).toHaveText("");
  await expect(panel.locator("[data-placeholder]")).toHaveAttribute("data-placeholder", "Type your own answer, or leave this blank to use the selected option");
  await box.click();
  await box.pressSequentially("Sepia");
  await panel.getByRole("button", { name: "Next question" }).click();
  await question.getByRole("checkbox", { name: /Hero/ }).click();
  await panel.getByRole("button", { name: "Submit answers" }).click();
  await expect(question).toHaveCount(0);
  await expect(box).toHaveText("my own draft");
  const resolved = (await engineChat(agent, chatId)).activities.find((activity) => activity.kind === "user-input.resolved");
  expect((resolved?.payload as { answers?: unknown }).answers).toEqual({ "Which look should the page have?": "Sepia", "Which sections should it have?": ["Hero"] });
});

test("files attached while a question waits go with its answer, each question keeps its own, and the draft's files come back after", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const chatId = await createChat(agent, { title: "Asking" });
  const panel = await openRail(page);
  const shelf = panel.getByTestId("attachments");
  const attach = async (name: string, body: string) => {
    const chooser = page.waitForEvent("filechooser");
    await panel.getByRole("button", { name: "Attach files" }).click();
    await (await chooser).setFiles([{ name, mimeType: "text/plain", buffer: Buffer.from(body) }]);
    await expect(shelf.locator("[data-chip='file'][data-status='ready']")).toHaveCount(1);
  };
  await attach("draft.txt", "kept for later");
  await sendThrough(agent, chatId, "ask me first about the page");

  const question = panel.getByTestId("question-panel");
  await expect(question.getByTestId("panel-count")).toHaveText("1/2");
  await expect(shelf).toHaveCount(0);
  // A file alone answers a question that takes an answer of one's own.
  await expect(panel.getByRole("button", { name: "Next question" })).toBeDisabled();
  await attach("mood.txt", "cream");
  await expect(shelf.locator("[data-chip='file']")).toHaveText(["mood.txt5 B"]);
  await panel.getByRole("button", { name: "Next question" }).click();
  await expect(question.getByTestId("panel-count")).toHaveText("2/2");
  await expect(shelf).toHaveCount(0);
  // A question that takes only its options takes no file.
  await expect(panel.getByRole("button", { name: "Attach files" })).toBeDisabled();
  await question.getByRole("checkbox", { name: /Hero/ }).click();
  await panel.getByRole("button", { name: "Previous" }).click();
  await expect(shelf.locator("[data-chip='file']")).toHaveText(["mood.txt5 B"]);
  await panel.getByRole("button", { name: "Next question" }).click();
  await panel.getByRole("button", { name: "Submit answers" }).click();
  await expect(question).toHaveCount(0);
  await expect(reply(panel).last()).toContainText("Thanks. I will build the page with the look and sections you picked.");
  await expect(shelf.locator("[data-chip='file']")).toHaveText(["draft.txt14 B"]);

  const resolved = (await engineChat(agent, chatId)).activities.find((activity) => activity.kind === "user-input.resolved");
  const answers = (resolved?.payload as { answers: Record<string, unknown> }).answers;
  expect(answers["Which sections should it have?"]).toEqual(["Hero"]);
  expect(answers["Which look should the page have?"]).toMatch(/^Attached file "mood\.txt": \/.+$/);
});

test("a question's text is markdown: a link opens in a new tab and markup shows as text", async ({ page }) => {
  const asking = {
    when: "^ask",
    turns: [
      {
        question: {
          questions: [
            {
              id: "look",
              header: "Look",
              question: "Which look? See [the brief](https://example.com/brief) and <b>this</b>.",
              options: [{ label: "Warm", description: "" }, { label: "Cool", description: "" }],
              multiSelect: false,
            },
          ],
        },
        text: "Thanks.",
      },
    ],
  };
  const agent = await startAgentEngine({ script: await scriptFolder({ asking }) });
  try {
    await openCanvas(page, agent);
    const panel = await openRail(page);
    await say(panel, "ask about the look");
    const text = panel.getByTestId("question-panel").getByTestId("panel-question");
    const link = text.getByRole("link", { name: "the brief" });
    await expect(link).toHaveAttribute("href", "https://example.com/brief");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(text).toHaveText("Which look? See the brief and <b>this</b>.");
    await expect(text.locator("b")).toHaveCount(0);
  } finally {
    await agent.dispose();
  }
});

test("an approval that arrives while the person types waits until they pause for 1.5 s", async ({ page, agent }) => {
  await page.clock.install();
  await openCanvas(page, agent);
  const chatId = await createChat(agent, { runtimeMode: "approval-required", title: "Cleanup" });
  const panel = await openRail(page);
  const box = promptBox(panel);
  const approval = panel.getByTestId("approval-panel");
  await box.click();
  await box.pressSequentially("a thought in progress");
  await sendThrough(agent, chatId, "clean the build please");

  // A key every 100 ms until the engine holds the approval, then for a while after it reached the page.
  let parked = false;
  const waiting = expect
    .poll(() => pendingRequest(agent, chatId), { timeout: 15_000 })
    .toBeDefined()
    .then(() => {
      parked = true;
    });
  while (!parked) {
    await box.press(".");
    await page.waitForTimeout(100);
  }
  await waiting;
  await expect(panel.locator("[data-role='user']")).toContainText("clean the build please");
  for (let n = 0; n < 8; n++) {
    await box.press(".");
    await page.waitForTimeout(100);
  }
  await expect(approval).toHaveCount(0);

  await page.clock.fastForward(1600);
  await expect(approval.getByTestId("approval-target")).toHaveText("rm -rf build");
  await expect(box).toHaveText(/^a thought in progress\.+$/);
});
