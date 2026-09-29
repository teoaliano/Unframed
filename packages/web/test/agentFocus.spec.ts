import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { putRecords } from "./media.ts";
import { artifactColumn, createChat, expect, openRail, rail, test } from "./agent.ts";
import { expectToken, inBothSchemes } from "./kit.ts";

test("the active chat's artifacts wear the focus mark, and switching tabs moves it", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(
    agent,
    artifactColumn([
      { id: "shape:m1", kind: "motion", title: "Intro" },
      { id: "shape:m2", kind: "motion", title: "Outro" },
      { id: "shape:g1", kind: "page", title: "Landing" },
    ]),
  );
  await createChat(agent, { title: "About the intro", tags: ["shape:m1", "shape:g1"], createdAt: "2026-09-01T10:00:00.000Z" });
  await createChat(agent, { title: "About the outro", tags: ["shape:m2", "shape:gone"], createdAt: "2026-09-02T10:00:00.000Z" });
  await openCanvas(page, agent);
  const intro = shapeOnScreen(page, "shape:m1");
  const outro = shapeOnScreen(page, "shape:m2");
  const landing = shapeOnScreen(page, "shape:g1");
  await expect(outro).not.toHaveAttribute("data-agent-focus");

  await openRail(page);
  await expect(outro).toHaveAttribute("data-agent-focus", "");
  await expect(intro).not.toHaveAttribute("data-agent-focus");
  await expect(landing).not.toHaveAttribute("data-agent-focus");
  // The label fills with the primary colour in both schemes.
  const label = outro.locator("[data-shape-label], .unframed-shape-label");
  await inBothSchemes(page, async () => {
    await expectToken(label, "background-color", "--primary");
    await expectToken(label, "color", "--primary-foreground");
  });

  await rail(page).getByRole("tab", { name: "About the intro" }).click();
  await expect(intro).toHaveAttribute("data-agent-focus", "");
  await expect(landing).toHaveAttribute("data-agent-focus", "");
  await expect(outro).not.toHaveAttribute("data-agent-focus");

  // Closing the rail takes the mark away.
  await rail(page).getByRole("button", { name: "Close" }).click();
  await expect(intro).not.toHaveAttribute("data-agent-focus");
});
