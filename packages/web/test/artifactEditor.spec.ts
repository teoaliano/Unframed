import type { Page } from "@playwright/test";
import { centre, openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";
import { createChat, expect, openRail, test } from "./agent.ts";
import { putRecords } from "./media.ts";
import { artifactShape, filledArtifact } from "./artifacts.ts";
import { connectTab } from "../../engine/test/syncClient.ts";
import { expectSlot, expectToken, inBothSchemes, styleOf } from "./kit.ts";

const editor = (page: Page) => page.getByTestId("artifact-editor");
const column = (page: Page, name: "rail" | "centre" | "parameters") => editor(page).locator(`[data-editor-column="${name}"]`);

const onBoard = async (page: Page, engine: Parameters<typeof openCanvas>[1]) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: "<h1>Welcome</h1>" });
  await putRecords(engine, [artifactShape({ id: "shape:draft", kind: "motion", ref: "151", at: { x: -520, y: 300 }, size: { w: 300, h: 180 } })]);
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await expect(shapeOnScreen(page, "shape:draft")).toBeVisible();
};

test("double-click opens the editor: rail, live frame and parameters, with Back and Esc restoring the camera", async ({ page, agent }) => {
  await onBoard(page, agent);
  const before = await shapeOnScreen(page, "shape:landing").boundingBox();
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);

  const region = page.getByRole("region", { name: "Editing Landing" });
  await expect(region).toBeVisible();
  await expect(editor(page).locator("[data-editor-column]")).toHaveCount(3);
  await expect(column(page, "rail").getByRole("complementary", { name: "Agent" })).toBeVisible();
  await expect(column(page, "rail").getByRole("button", { name: "Close" })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "Back to canvas" })).toBeVisible();
  await expect(region.getByTestId("artifact-editor-title")).toHaveText("Landing");
  await expect(region.getByTestId("artifact-editor-kind")).toHaveText("page");
  await expect(region.getByRole("button", { name: "Open in a new tab" })).toBeVisible();
  const frame = region.locator("iframe[data-artifact-frame]");
  await expect(frame).not.toHaveAttribute("loading", "lazy");
  await expect(region.frameLocator("iframe[data-artifact-frame]").getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(column(page, "parameters")).toContainText("Parameters");
  // The canvas's own frames unload while the editor is open.
  await expect(shapeOnScreen(page, "shape:landing").locator("iframe")).toHaveCount(0);
  // tldraw's watermark stays visible below the editor.
  await expect(page.locator(".tl-watermark_SEE-LICENSE")).toBeVisible();

  await region.getByRole("button", { name: "Back to canvas" }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(await shapeOnScreen(page, "shape:landing").boundingBox()).toEqual(before);
  // The double-click opened the editor and nothing else: no prompt where it landed.
  expect((await roomRecords(agent, "default")).filter((record) => record.type === "text")).toHaveLength(2);

  // Deselect and pan away (a selected artifact's frame takes a double-click as its own), open again, and Escape comes back to exactly where it was.
  await page.mouse.click(640, 560);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(120, 60);
  await page.waitForTimeout(300);
  const moved = await shapeOnScreen(page, "shape:landing").boundingBox();
  const again = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(again.x, again.y);
  await expect(region).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  expect(await shapeOnScreen(page, "shape:landing").boundingBox()).toEqual(moved);
});

test("the rail's header makes room for the shell's window buttons inline, moving down only as far as the card did, and follows the card live", async ({ page, agent }) => {
  await onBoard(page, agent);
  const railHeader = column(page, "rail").locator("header").first();
  const icon = railHeader.locator("svg").first();
  const back = column(page, "centre").getByRole("button", { name: "Back to canvas" });
  const middle = async (locator: typeof railHeader) => {
    const box = (await locator.boundingBox())!;
    return box.y + box.height / 2;
  };
  const shellStyle = async (css: string | undefined) =>
    page.evaluate((content) => {
      document.getElementById("shell-style")?.remove();
      if (content === undefined) return;
      const style = document.createElement("style");
      style.id = "shell-style";
      style.textContent = content;
      document.head.append(style);
    }, css);
  const card = async () => (await page.locator(".unframed-chrome-left").boundingBox())!;

  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(railHeader).toBeVisible();
  const plain = { header: (await railHeader.boundingBox())!, icon: (await icon.boundingBox())! };
  // In a browser the three headers line up.
  expect(Math.abs((await middle(railHeader)) - (await middle(back)))).toBeLessThanOrEqual(1);

  // The shell's buttons sit left of where it put the card: the header's content starts at the card's left edge and stays level.
  await shellStyle(".unframed-chrome-left { top: 8px; left: 80px; }");
  await expect.poll(async () => (await icon.boundingBox())!.x).toBeGreaterThanOrEqual((await card()).x);
  expect((await railHeader.boundingBox())!.y).toBe(plain.header.y);
  expect(Math.abs((await middle(railHeader)) - (await middle(back)))).toBeLessThanOrEqual(1);

  // Moved down as well, the header comes down by as much as the card did, and no more.
  await shellStyle(".unframed-chrome-left { top: 40px; left: 80px; }");
  await expect.poll(async () => (await railHeader.boundingBox())!.y).toBe(plain.header.y + 32);
  expect((await icon.boundingBox())!.x).toBeGreaterThanOrEqual((await card()).x);
  expect((await back.boundingBox())!.y).toBeLessThan((await railHeader.boundingBox())!.y);

  // The style removed, the header goes back.
  await shellStyle(undefined);
  await expect.poll(async () => (await railHeader.boundingBox())!.y).toBe(plain.header.y);
  await expect.poll(async () => (await icon.boundingBox())!.x).toBe(plain.icon.x);
});

test("Escape closes the editor from a button in its chat column, though not from the composer", async ({ page, agent }) => {
  await onBoard(page, agent);
  await createChat(agent, { title: "Brief", tags: ["shape:landing"] });
  await createChat(agent, { title: "Other", tags: ["shape:landing"] });
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(editor(page)).toBeVisible();
  await column(page, "rail").getByRole("textbox", { name: "Message the agent" }).click();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeVisible();
  // As after a click on a tab or on the recap card's Editor: the focus is on a button in the column.
  // (A click on the active tab opens its menu, which Escape closes first.)
  await column(page, "rail").getByRole("tab", { selected: false }).click();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
});

test("nothing covers the editor's chat header, with the canvas rail docked or closed, in a browser or with the shell's card moved", async ({ page, agent }) => {
  await openCanvas(page, agent);
  // Right of where the docked rail sits, so a double-click reaches it with the rail open.
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "150", at: { x: 600, y: 60 }, size: { w: 300, h: 200 }, title: "Landing", html: "<h1>Welcome</h1>" });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  const railHeader = column(page, "rail").locator("header").first();
  /** Whether every point along the header's left half hits the header itself. */
  const headerUncovered = async () => {
    const box = (await railHeader.boundingBox())!;
    return page.evaluate(
      ({ x, y, width }) => {
        for (let at = x + 4; at < x + width / 2; at += 16) {
          if (!document.elementFromPoint(at, y)?.closest("[data-editor-column='rail'] header")) return false;
        }
        return true;
      },
      { x: box.x, y: box.y + box.height / 2, width: box.width },
    );
  };
  const middle = async (locator: ReturnType<typeof column>) => {
    const box = (await locator.boundingBox())!;
    return box.y + box.height / 2;
  };

  for (const shell of [false, true]) {
    if (shell) {
      await page.evaluate(() => {
        const style = document.createElement("style");
        style.textContent = ".unframed-chrome-left { top: 40px; left: 80px; }";
        document.head.append(style);
      });
    }
    for (const docked of [false, true]) {
      const panel = docked ? await openRail(page) : undefined;
      await page.mouse.click(1000, 560);
      const at = await centre(shapeOnScreen(page, "shape:landing"));
      await page.mouse.dblclick(at.x, at.y);
      await expect(railHeader).toBeVisible();
      await page.waitForTimeout(100);
      expect(await headerUncovered(), `shell ${shell}, rail docked ${docked}`).toBe(true);
      // In a browser the three column headers line up.
      if (!shell) expect(Math.abs((await middle(railHeader)) - (await middle(column(page, "centre").getByRole("button", { name: "Back to canvas" }))))).toBeLessThanOrEqual(1);
      await page.keyboard.press("Escape");
      await expect(editor(page)).toHaveCount(0);
      if (panel) {
        await panel.getByRole("button", { name: "Close" }).click();
        await expect(panel).toHaveCount(0);
      }
    }
  }
});

test("Escape typed in the composer or the parameter box stays in the editor, and canvas shortcuts do nothing while it is open", async ({ page, agent }) => {
  await onBoard(page, agent);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  const region = page.getByRole("region", { name: "Editing Landing" });
  await expect(region).toBeVisible();

  await editor(page).getByRole("textbox", { name: "Message the agent" }).click();
  await page.keyboard.press("Escape");
  await expect(region).toBeVisible();
  await editor(page).getByRole("textbox", { name: "Add a parameter" }).click();
  await page.keyboard.press("Escape");
  await expect(region).toBeVisible();

  // Focus on the editor's own controls: Delete, Backspace and tool keys reach no canvas shortcut.
  await region.getByRole("button", { name: "Back to canvas" }).focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("r");
  await page.keyboard.press("Shift+P");
  await page.waitForTimeout(300);
  expect((await roomRecords(agent, "default")).some((record) => record.id === "shape:landing")).toBe(true);
  expect((await roomRecords(agent, "default")).filter((record) => record.type === "page")).toHaveLength(1);
  // The first Escape closes the Back button's tooltip; the next closes the editor.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(region).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select — V" })).toHaveAttribute("aria-pressed", "true");
});

test("an artifact with no file says so and offers no new tab; Open in a new tab opens the artifact's URL", async ({ page, agent }) => {
  await onBoard(page, agent);
  const empty = await centre(shapeOnScreen(page, "shape:draft"));
  await page.mouse.dblclick(empty.x, empty.y - 30);
  const region = page.getByRole("region", { name: "Editing draft" });
  await expect(region).toBeVisible();
  await expect(region.getByTestId("artifact-editor-kind")).toHaveText("motion");
  await expect(region.getByText("This motion has no file yet. Ask the agent to write one.")).toBeVisible();
  await expect(region.getByRole("button", { name: "Open in a new tab" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  const landing = page.getByRole("region", { name: "Editing Landing" });
  const file = (await roomRecords(agent, "default")).find((record) => record.id === "shape:landing")!.props.file as string;
  const opened = page.context().waitForEvent("page");
  await landing.getByRole("button", { name: "Open in a new tab" }).click();
  const tab = await opened;
  await tab.waitForLoadState();
  // The app is on localhost, so the artifact is on the other loopback name.
  expect(tab.url()).toBe(`http://127.0.0.1:${agent.previewPort}/p/default/${file}`);
  await expect(tab.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await tab.close();
});

test("deleting the artifact from another tab closes the editor", async ({ page, agent }) => {
  await onBoard(page, agent);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();

  // Another tab's delete reaches this one as a remote change of the room, as this one does.
  const tab = await connectTab(agent.port, "default");
  await tab.loaded;
  await tab.remove(["shape:landing"]);
  await tab.close();
  await expect(editor(page)).toHaveCount(0, { timeout: 10_000 });
  await expect(shapeOnScreen(page, "shape:landing")).toHaveCount(0);
});

test("the editor's columns, header actions and parameter box are the kit's, in both schemes", async ({ page, agent }) => {
  await onBoard(page, agent);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  const region = page.getByRole("region", { name: "Editing Landing" });
  await expect(region).toBeVisible();
  // The grid stays 360, flexible, 320, with 12 px gaps and padding.
  expect((await column(page, "rail").boundingBox())!.width).toBe(360);
  expect((await column(page, "parameters").boundingBox())!.width).toBe(320);
  const [rail, centreColumn] = [(await column(page, "rail").boundingBox())!, (await column(page, "centre").boundingBox())!];
  expect(centreColumn.x - (rail.x + rail.width)).toBe(12);
  expect(rail.x).toBe(12);
  // The centre's frame fills the space under the header.
  const frame = (await region.locator("iframe[data-artifact-frame]").boundingBox())!;
  expect(frame.width).toBeGreaterThan(centreColumn.width - 4);
  expect(frame.y + frame.height).toBeGreaterThan(centreColumn.y + centreColumn.height - 4);

  const back = region.getByRole("button", { name: "Back to canvas" });
  const newTab = region.getByRole("button", { name: "Open in a new tab" });
  const box = editor(page).getByRole("textbox", { name: "Add a parameter" });
  const add = editor(page).getByRole("button", { name: "Add", exact: true });
  await expectSlot(back, "tooltip-trigger");
  await expectSlot(newTab, "tooltip-trigger");
  await expectSlot(box, "textarea");
  await expectSlot(add, "button");
  expect((await back.boundingBox())!.height).toBe(32);
  await page.mouse.move(640, 700);
  await inBothSchemes(page, async () => {
    for (const name of ["rail", "centre", "parameters"] as const) {
      await expectToken(column(page, name), "background-color", "--card");
      await expectToken(column(page, name), "border-top-color", "--color-border");
    }
    expect(await styleOf(back, "background-color")).toBe("rgba(0, 0, 0, 0)");
    await expectToken(region.getByTestId("artifact-editor-title"), "color", "--color-foreground");
    await expectToken(region.getByTestId("artifact-editor-kind"), "color", "--color-muted-foreground");
    await expectToken(editor(page).getByText("The agent writes it"), "color", "--color-muted-foreground");
    await expectToken(editor(page), "background-color", "--background");
  });
});
