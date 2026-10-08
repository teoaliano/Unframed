import { openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { putRecords } from "./media.ts";
import { artifactColumn, expect, openRail, say, scriptFolder, startAgentEngine } from "./agent.ts";
import { test as base } from "./fixtures.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const retitle = (id: string, title: string) => ({ type: "update", id, props: { title } });

const RETITLE = {
  when: "^retitle",
  turns: [{ tools: [{ name: "canvas_write", input: { ops: [retitle("m1", "Intro (red)"), retitle("m2", "Outro (red)")] } }], text: "Retitled both." }],
};

const test = base.extend<{ agent: TestEngine }>({
  agent: async ({}, use) => {
    const engine = await startAgentEngine({ script: await scriptFolder({ retitle: RETITLE }) });
    await use(engine);
    await engine.dispose();
  },
});

/** Two motions: Intro beside the starter prompts, Outro far off to the right, out of view. */
const twoMotions = async (engine: TestEngine) => {
  const [intro, outro] = artifactColumn([
    { id: "shape:m1", kind: "motion", title: "Intro" },
    { id: "shape:m2", kind: "motion", title: "Outro" },
  ]);
  await putRecords(engine, [intro, { ...outro, x: 6000, y: 3000 }]);
};

const titleOf = async (engine: TestEngine, id: string) => (await roomShapes(engine, "default", "motion")).find((shape) => shape.id === id)?.props.title;

test("after a turn the recap card lists what it touched with Editor and Locate, folds with Hide and Show, and strikes a deleted shape through", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await twoMotions(agent);
  const panel = await openRail(page);
  await say(panel, "retitle both please");
  await expect(panel.locator("[data-role='assistant']").last()).toContainText("Retitled both.");

  const card = panel.getByTestId("recap-card");
  const toggle = card.getByTestId("recap-toggle");
  await expect(toggle).toHaveText("2 filesHide");
  const rows = card.getByTestId("recap-row");
  await expect(rows.getByTestId("recap-label")).toHaveText(["Intro (red)", "Outro (red)"]);
  await expect(rows.nth(1).getByRole("button", { name: "Locate on canvas" })).toBeVisible();
  await expect(rows.getByRole("button", { name: "Editor" })).toHaveCount(2);
  await expect(card.getByRole("button", { name: "View diff" })).toHaveCount(0);

  await expect(shapeOnScreen(page, "shape:m2")).not.toBeInViewport();
  await rows.nth(1).getByRole("button", { name: "Locate on canvas" }).click();
  await expect(shapeOnScreen(page, "shape:m2")).toBeInViewport();

  await toggle.click();
  await expect(toggle).toHaveText("2 filesShow");
  await expect(rows).toHaveCount(0);
  await toggle.click();
  await expect(rows).toHaveCount(2);

  await (await agent.rpc()).call("testCanvas.apply", { project: "default", change: { put: [], remove: ["shape:m2"] }, origin: { kind: "server", id: "test" } });
  await expect(rows.nth(1)).toHaveAttribute("data-deleted", "");
  await expect(rows.nth(1)).toHaveText("Outro (red)deleted");
  await expect(rows.nth(1).getByRole("button")).toHaveCount(0);
  await expect(rows.nth(1).getByTestId("recap-label")).toHaveCSS("text-decoration-line", "line-through");

  // Editor goes into the editor (spec 09).
  await rows.nth(0).getByRole("button", { name: "Editor" }).click();
  const region = page.getByRole("region", { name: "Editing Intro (red)" });
  await expect(region).toBeVisible();
  await region.getByRole("button", { name: "Back to canvas" }).click();
  await expect(region).toHaveCount(0);
});

test("Revert this turn takes the turn's changes back and reads Reverted", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await twoMotions(agent);
  const panel = await openRail(page);
  await say(panel, "retitle both please");
  const card = panel.getByTestId("recap-card");
  await card.getByRole("button", { name: "Revert this turn" }).click();
  await expect(card.getByTestId("recap-reverted")).toHaveText("Reverted");
  await expect(card.getByRole("button", { name: "Revert this turn" })).toHaveCount(0);
  await expect.poll(() => titleOf(agent, "shape:m1")).toBe("Intro");
  await expect.poll(() => titleOf(agent, "shape:m2")).toBe("Outro");
  await expect(card.getByTestId("recap-skipped")).toHaveCount(0);
});

test("a revert names the shape it left alone because the person changed it since", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await twoMotions(agent);
  const panel = await openRail(page);
  await say(panel, "retitle both please");
  const card = panel.getByTestId("recap-card");
  await expect(card.getByRole("button", { name: "Revert this turn" })).toBeVisible();

  const [intro] = artifactColumn([{ id: "shape:m1", kind: "motion", title: "Hand-made" }]);
  await putRecords(agent, [intro]);
  await card.getByRole("button", { name: "Revert this turn" }).click();
  await expect(card.getByTestId("recap-reverted")).toHaveText("Reverted");
  await expect(card.getByTestId("recap-skipped")).toHaveText("Left 1 shape alone because they changed since: Hand-made (by the person).");
  await expect.poll(() => titleOf(agent, "shape:m2")).toBe("Outro");
  expect(await titleOf(agent, "shape:m1")).toBe("Hand-made");
});
