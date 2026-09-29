import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { putRecords, promptRecord } from "./media.ts";
import { artifactColumn, expect, openRail, rail, rpcOf, say, scriptFolder, startAgentEngine } from "./agent.ts";
import { test as base } from "./fixtures.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const SCRIPT = {
  when: "^rewrite",
  turns: [
    { text: "Rewrote the landing page.", tools: [{ name: "canvas_write", input: { ops: [{ type: "update", id: "pg1", props: { file: "landing-v2.html" } }] } }] },
    { text: "Retitled the note.", tools: [{ name: "canvas_write", input: { ops: [{ type: "update", id: "n1", props: { text: "a calmer note" } }] } }] },
  ],
};

const test = base.extend<{ agent: TestEngine }>({
  agent: async ({}, use) => {
    const engine = await startAgentEngine({ script: await scriptFolder({ diffs: SCRIPT }) });
    await use(engine);
    await engine.dispose();
  },
});

const V1 = '<!doctype html>\n<html>\n<body>\n<h1 class="title">Landing</h1>\n<p>One</p>\n</body>\n</html>\n';
const V2 = '<!doctype html>\n<html>\n<body>\n<h1 class="title">Landing, again</h1>\n<p>One</p>\n<p>Two</p>\n</body>\n</html>\n';

/** A page on landing-v1.html and a note; the chat's first turn points the page at v2, its second changes the note. */
const twoTurns = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  const folder = join(engine.dataDir, "output", "default");
  await writeFile(join(folder, "landing-v1.html"), V1);
  await writeFile(join(folder, "landing-v2.html"), V2);
  const [landing] = artifactColumn([{ id: "shape:pg1", kind: "page", title: "Landing", file: "landing-v1.html" }]);
  await putRecords(engine, [landing, promptRecord("shape:n1", "900", "a note", { x: -600, y: 400 })]);
  const panel = await openRail(page);
  await say(panel, "rewrite the landing page");
  await expect(panel.locator("[data-role='assistant']").last()).toContainText("Rewrote the landing page.");
  await say(panel, "rewrite the note");
  await expect(panel.locator("[data-role='assistant']").last()).toContainText("Retitled the note.");
  return panel;
};

const diffPanel = (page: Page) => rail(page).getByTestId("diff-panel");

test("View diff opens the panel on that page: its turn, the changed file with its counts, and the patch highlighted as HTML", async ({ page, agent }) => {
  const panel = await twoTurns(page, agent);
  const first = panel.getByTestId("recap-card").first();
  await first.getByRole("button", { name: "View diff" }).click();

  const diff = diffPanel(page);
  await expect(diff.getByRole("button", { name: "Diff scope: Turn 1" })).toBeVisible();
  const files = diff.getByRole("navigation", { name: "Changed files" }).getByRole("button");
  await expect(files).toHaveText(["Landing+2−1"]);
  const patch = diff.locator("[data-diff-file='shape:pg1']");
  await expect(patch.locator(".unframed-agent-diff__names")).toHaveText("landing-v1.html → landing-v2.html");
  await expect(patch).toContainText("Landing, again");
  // Highlighted as HTML: a tag name is coloured apart from the text between tags.
  const colourOf = (text: string) =>
    patch.evaluate((element, wanted) => {
      const all = (scope: Element | ShadowRoot): Element[] => [...scope.querySelectorAll("*")].flatMap((node) => [node, ...(node.shadowRoot ? all(node.shadowRoot) : [])]);
      const token = all(element).find((node) => node.children.length === 0 && node.textContent === wanted);
      return token ? getComputedStyle(token).color : undefined;
    }, text);
  await expect.poll(() => colourOf("html")).toBeDefined();
  await expect.poll(async () => (await colourOf("html")) !== (await colourOf("One"))).toBe(true);

  // Escape closes it.
  await diff.focus();
  await page.keyboard.press("Escape");
  await expect(diff).toHaveCount(0);
});

test("the scope menu moves between turns and all turns, with the empty states", async ({ page, agent }) => {
  const panel = await twoTurns(page, agent);
  const cards = panel.getByTestId("recap-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first().getByRole("button", { name: "View all changes" })).toHaveCount(0);
  await cards.last().getByRole("button", { name: "View all changes" }).click();

  const diff = diffPanel(page);
  await expect(diff.getByRole("button", { name: "Diff scope: All turns" })).toBeVisible();
  await expect(diff.getByRole("navigation", { name: "Changed files" }).getByRole("button")).toHaveText(["Landing+2−1"]);

  await diff.getByRole("button", { name: "Diff scope: All turns" }).click();
  await expect(page.getByRole("menuitemradio")).toHaveText(["Latest turn", "Turn 1", "Turn 2", "All turns"]);
  await page.getByRole("menuitemradio", { name: "Latest turn" }).click();
  await expect(diff.getByRole("button", { name: "Diff scope: Latest turn" })).toBeVisible();
  await expect(diff.getByText("No page or motion changed in this selection.", { exact: true })).toBeVisible();

  await diff.getByRole("button", { name: "Diff scope: Latest turn" }).click();
  await page.getByRole("menuitemradio", { name: "Turn 1" }).click();
  await expect(diff.getByRole("navigation", { name: "Changed files" }).getByRole("button")).toHaveText(["Landing+2−1"]);

  // Rewound to before the first message, the chat has no completed turn left.
  await panel.locator("[data-role='user']").first().getByRole("button", { name: "Edit from here" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revert and keep changes" }).click();
  await expect(diff.getByText("No completed turns yet.", { exact: true })).toBeVisible();
  await diff.getByRole("button", { name: "Close diff" }).click();
  await expect(diff).toHaveCount(0);
});

test("Stacked and Split are remembered; line wrapping and whitespace say what they will do next", async ({ page, agent }) => {
  const panel = await twoTurns(page, agent);
  await panel.getByTestId("recap-card").first().getByRole("button", { name: "View diff" }).click();
  const diff = diffPanel(page);
  const stacked = diff.getByRole("button", { name: "Stacked diff view" });
  const split = diff.getByRole("button", { name: "Split diff view" });
  await expect(stacked).toHaveAttribute("aria-pressed", "true");
  await split.click();
  await expect(split).toHaveAttribute("aria-pressed", "true");
  await expect(stacked).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await (await rpcOf(agent)).call("preferences.get", { keys: ["agent.diffLayout"] })).values["agent.diffLayout"]).toBe("split");

  await diff.getByRole("button", { name: "Enable line wrapping" }).click();
  await expect(diff.getByRole("button", { name: "Disable line wrapping" })).toHaveAttribute("aria-pressed", "true");
  await diff.getByRole("button", { name: "Hide whitespace changes" }).click();
  await expect(diff.getByRole("button", { name: "Show whitespace changes" })).toHaveAttribute("aria-pressed", "true");
  await expect(diff.getByRole("navigation", { name: "Changed files" }).getByRole("button")).toHaveText(["Landing+2−1"]);

  // Opened again after a reload, the panel keeps Split.
  await page.reload();
  const again = await openRail(page);
  await again.getByTestId("recap-card").first().getByRole("button", { name: "View diff" }).click();
  await expect(diffPanel(page).getByRole("button", { name: "Split diff view" })).toHaveAttribute("aria-pressed", "true");
});
