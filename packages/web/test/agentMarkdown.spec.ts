import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openCanvas } from "./canvas.ts";
import { putRecords } from "./media.ts";
import { artifactColumn, expect, FIXTURES, openRail, say, scriptFolder, startAgentEngine } from "./agent.ts";
import { test } from "./fixtures.ts";

// Copy code and Copy as Markdown write the system clipboard: this runs in the clipboard project (playwright.config.ts).
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("a reply renders as markdown: headings, a table to copy, a task list, a code block to copy, a quote and a link to a new tab", async ({ page }) => {
  const markdown = JSON.parse(await readFile(join(FIXTURES, "markdown.json"), "utf8"));
  const agent = await startAgentEngine({ script: await scriptFolder({ markdown }) });
  try {
    await openCanvas(page, agent);
    await putRecords(agent, artifactColumn([{ id: "shape:m1", kind: "motion", title: "Intro" }, { id: "shape:m2", kind: "motion", title: "Outro" }]));
    const panel = await openRail(page);
    await say(panel, "show me the markdown formatting");
    const reply = panel.locator("[data-role='assistant'] .chat-markdown");
    await expect(reply.getByRole("heading", { level: 2 })).toHaveText("What I changed");
    await expect(reply.getByRole("heading", { level: 3 })).toHaveText("The two motions");

    const table = reply.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText(["Shape", "Title", "Duration"]);
    await reply.getByRole("button", { name: "Table actions" }).click();
    await page.getByRole("menuitem", { name: "Copy as Markdown" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("| Shape | Title | Duration |\n| --- | --- | --- |\n| m1 | Intro (red) | 2s |\n| m2 | Outro (red) | 2s |");
    await reply.getByRole("button", { name: "Table actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Copy as CSV" })).toBeVisible();
    await page.keyboard.press("Escape");

    const tasks = reply.getByRole("checkbox");
    await expect(tasks).toHaveCount(2);
    await expect(tasks.first()).toBeChecked();
    await expect(tasks.nth(1)).not.toBeChecked();
    await expect(reply.locator("ol > li")).toHaveCount(3);

    const code = reply.getByTestId("code-block");
    await expect(code).toHaveAttribute("data-language", "json");
    await expect(code.getByText("json", { exact: true })).toBeVisible();
    await code.getByRole("button", { name: "Copy code" }).click();
    await expect(code.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('"type": "update", "id": "m1"');
    await expect(code.getByRole("button", { name: "Copy code" })).toBeVisible({ timeout: 3000 });
    await code.getByRole("button", { name: "Wrap lines" }).click();
    await expect(code.getByRole("button", { name: "Disable line wrap" })).toBeVisible();

    await expect(reply.locator("blockquote")).toContainText("The titles are shape labels, not text inside the compositions.");
    const link = reply.getByRole("link", { name: "HyperFrames contract" });
    await expect(link).toHaveAttribute("href", "https://example.com/contract");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  } finally {
    await agent.dispose();
  }
});

test("HTML in a reply shows as text and never runs; the person's own **text** stays literal", async ({ page }) => {
  const agent = await startAgentEngine({
    script: await scriptFolder({
      html: { when: "^html", turns: [{ text: 'Inline <b>bold</b> and <img src="x" onerror="window.__ran = true">.\n\n<script>window.__ran = true</script>\n\n[a trap](javascript:window.__ran=true)' }] },
    }),
  });
  try {
    await openCanvas(page, agent);
    const panel = await openRail(page);
    await say(panel, "html **not bold** # nor a heading");
    await expect(panel.locator("[data-role='user'] [data-testid='message-text']")).toHaveText("html **not bold** # nor a heading");
    await expect(panel.locator("[data-role='user'] strong")).toHaveCount(0);
    const reply = panel.locator("[data-role='assistant'] .chat-markdown");
    await expect(reply).toContainText("Inline <b>bold</b> and <img src=\"x\" onerror=\"window.__ran = true\">.");
    await expect(reply).toContainText("<script>window.__ran = true</script>");
    await expect(reply.locator("b, img, script")).toHaveCount(0);
    await expect(reply.getByRole("link", { name: "a trap" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __ran?: boolean }).__ran)).toBeUndefined();
  } finally {
    await agent.dispose();
  }
});
