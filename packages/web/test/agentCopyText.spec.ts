import { openCanvas } from "./canvas.ts";
import { putRecords } from "./media.ts";
import { artifactColumn, expect, openRail, promptBox, say, test } from "./agent.ts";

// Copy writes the system clipboard: this runs in the clipboard project (playwright.config.ts).
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("copying text across a person's message and a reply puts that text on the clipboard as text/plain, with shapes selected on the canvas", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, artifactColumn([{ id: "shape:m1", kind: "motion", title: "Intro" }]));
  // Select the canvas shapes first: tldraw's own copy handler only steps aside when nothing is selected.
  await page.mouse.click(10, 400);
  await page.keyboard.press("ControlOrMeta+a");
  const panel = await openRail(page);
  await say(panel, "what is on the board?");
  await expect(panel.locator("[data-role='assistant']")).toContainText("Three shapes: motion m1");

  // Select from the middle of the person's message into the reply, then copy with the keyboard.
  const selected = await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const user = document.querySelector("aside[aria-label='Agent'] [data-role='user'] [data-testid='message-text']")!.firstChild!;
    const reply = document.querySelector("aside[aria-label='Agent'] [data-role='assistant'] .chat-markdown p")!.firstChild!;
    const range = document.createRange();
    range.setStart(user, 4);
    range.setEnd(reply, (reply.textContent ?? "").length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selected).toContain("on the board?");
  expect(selected).toContain("Three shapes");

  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types));
  expect(types).toContain("text/plain");
  expect(types).not.toContain("application/tldraw");
});

test("copying from the composer still copies what the person typed, with shapes selected on the canvas", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, artifactColumn([{ id: "shape:m1", kind: "motion", title: "Intro" }]));
  await page.mouse.click(10, 400);
  await page.keyboard.press("ControlOrMeta+a");
  const panel = await openRail(page);
  const box = promptBox(panel);
  await box.click();
  await box.pressSequentially("make the titles red");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("make the titles red");
});
