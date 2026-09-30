import { emptyCanvasPoint, openCanvas } from "./canvas.ts";
import { clickShape } from "./generation.ts";
import { putRecords } from "./media.ts";
import { artifactColumn, createChat, expect, openRail, tabs, test } from "./agent.ts";

const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;

test("selecting artifacts filters the tabs to the chats tagged with any of them, with the empty strip's copy, and the active tab stays visible", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(
    agent,
    artifactColumn([
      { id: "shape:p1", title: "Alpha" },
      { id: "shape:p2", title: "Beta" },
      { id: "shape:p3", title: "Gamma" },
      { id: "shape:p4", title: "Delta" },
    ]),
  );
  await createChat(agent, { title: "About alpha", tags: ["shape:p1"], createdAt: at(1) });
  await createChat(agent, { title: "About beta", tags: ["shape:p2"], createdAt: at(2) });
  await createChat(agent, { title: "About both", tags: ["shape:p1", "shape:p2"], createdAt: at(3) });
  await createChat(agent, { title: "Loose", createdAt: at(4) });
  // Opened again, the view fits the new shapes too.
  await openCanvas(page, agent);
  const panel = await openRail(page);
  await expect(tabs(page)).toHaveText(["Loose", "About both", "About beta"]);

  // Choose a chat, then select an artifact it is not about: the active tab moves to one that is shown.
  await tabs(page).filter({ hasText: "About beta" }).click();
  await clickShape(page, "shape:p1");
  await expect(tabs(page)).toHaveText(["About both", "About alpha"]);
  await expect(tabs(page).filter({ hasText: "About both" })).toHaveAttribute("aria-selected", "true");

  // Any of the selected artifacts: two selected show the chats about either.
  await clickShape(page, "shape:p2", ["Shift"]);
  await expect(tabs(page)).toHaveText(["About both", "About beta", "About alpha"]);

  // Two artifacts nobody has talked about: the strip says the first message starts a chat.
  await clickShape(page, "shape:p3");
  await clickShape(page, "shape:p4", ["Shift"]);
  await expect(tabs(page)).toHaveCount(0);
  await expect(panel.getByText("Nothing said about these yet. Your first message starts a chat.", { exact: true })).toBeVisible();

  // Exactly one: the strip says nothing, since the composer already asks for the first message.
  await clickShape(page, "shape:p3");
  await expect(tabs(page)).toHaveCount(0);
  await expect(panel.getByTestId("chat-tabs")).toHaveText("");

  // Nothing selected shows every chat again.
  const empty = await emptyCanvasPoint(page);
  await page.mouse.click(empty.x - 300, empty.y);
  await expect(tabs(page)).toHaveText(["Loose", "About both", "About beta"]);
});
