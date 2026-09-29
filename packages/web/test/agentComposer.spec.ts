import type { Page } from "@playwright/test";
import { openCanvas, shapeOnScreen, toast } from "./canvas.ts";
import { clickShape, composer, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { filledMedia, putRecords } from "./media.ts";
import { artifactColumn, expect, onlyChat, openRail, promptBox, rail, rpcOf, scriptFolder, startAgentEngine, test } from "./agent.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { expectSlot, expectToken, inBothSchemes, resolvedColor, styleOf } from "./kit.ts";

/** A toast's second line, by its text. */
const toastDescription = (page: Page, text: string) => page.locator("[data-slot='toast-description']").filter({ hasText: text });

/** A page and two filled images, left of the starter prompts. */
const pageAndImages = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await putRecords(engine, artifactColumn([{ id: "shape:p1", title: "Alpha" }]));
  for (const [index, id] of ["shape:i1", "shape:i2"].entries()) {
    await filledMedia(engine, { id, type: "image", ref: String(800 + index), at: { x: -360, y: 60 + index * 130 }, bytes: pngBytes(40, 40, index), name: `still-${index}.png`, mime: "image/png", natural: { w: 40, h: 40 }, width: 120 });
  }
  await openCanvas(page, engine);
  await clickShape(page, "shape:p1");
  await clickShape(page, "shape:i1", ["Shift"]);
  await clickShape(page, "shape:i2", ["Shift"]);
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("3 selected");
};

const openAgentTray = async (page: Page) => {
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(composer(page)).toHaveAttribute("data-tray", "agent");
};

const chips = (page: Page) => composer(page).getByRole("list", { name: "Context" }).getByRole("listitem");

test("the selection enters the Agent tray as chips; removing one trims the message and leaves the canvas selection alone", async ({ page, agent }) => {
  await pageAndImages(page, agent);
  await openAgentTray(page);
  await expect(chips(page)).toHaveText(["Alpha", "2 images"]);
  await expect(chips(page).first().locator("svg")).toHaveCount(2);

  await composer(page).getByRole("button", { name: "Remove 2 images" }).click();
  await expect(chips(page)).toHaveText(["Alpha"]);
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("3 selected");

  // Opened again, the tray starts from the selection.
  await openAgentTray(page);
  await expect(chips(page)).toHaveText(["Alpha", "2 images"]);
  await composer(page).getByRole("button", { name: "Remove 2 images" }).click();
  await promptBox(composer(page)).pressSequentially("what is on the board?");
  await promptBox(composer(page)).press("Enter");
  await expect(rail(page)).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("3 selected");

  const chat = await onlyChat(agent, (current) => current.messages.some((message) => message.role === "user"));
  expect(chat.messages.find((message) => message.role === "user")?.context).toEqual({ selection: ["shape:p1"] });
  expect(chat.tags).toEqual(["shape:p1"]);
});

test("@ lists the project's shapes and files; choosing one puts a chip in the text and the shape in the context", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, artifactColumn([{ id: "shape:p1", title: "Alpha" }]));
  const { file } = await filledMedia(agent, { id: "shape:i1", type: "image", ref: "800", at: { x: -360, y: 60 }, bytes: pngBytes(40, 40), name: "still.png", mime: "image/png", natural: { w: 40, h: 40 }, width: 120 });
  await expect(shapeOnScreen(page, "shape:i1")).toHaveCount(1);
  const panel = await openRail(page);
  const box = promptBox(panel);
  const menu = page.getByRole("listbox", { name: "Mentions" });
  await box.click();

  await box.pressSequentially("@zzz");
  await expect(menu.getByText("No matching shapes or files.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(panel).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");

  // Media by label, and the files the canvas names.
  await box.pressSequentially("@still");
  await expect(menu.getByRole("option")).toHaveText([/still\.png/, new RegExp(`${file.replace(".", "\\.")}File`)]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(box.locator("[data-agent-chip]")).toHaveText([file]);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");

  await box.pressSequentially("@alp");
  await expect(menu.getByRole("option")).toHaveText(["Alpha"]);
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(box.locator("[data-agent-chip]")).toHaveText(["Alpha"]);
  await expect(panel.getByRole("list", { name: "Context" }).getByRole("listitem")).toHaveText(["Alpha"]);
  await box.pressSequentially("what is on the board?");
  await box.press("Enter");

  const chat = await onlyChat(agent, (current) => current.messages.some((message) => message.role === "user"));
  const sent = chat.messages.find((message) => message.role === "user")!;
  expect(sent.text).toBe("[Page: Alpha; ref=p1] what is on the board?");
  expect(sent.context).toEqual({ selection: ["shape:p1"] });
});

/** Files as a page event carries them: drag events on an element, or a paste into the box. */
const fileEvents = (page: Page, selector: string, events: string[], files: Array<{ name: string; mime: string; bytes?: Buffer; size?: number }>) =>
  page.evaluate(
    ({ selector, events, files }) => {
      const transfer = new DataTransfer();
      for (const file of files) {
        const bytes = file.size !== undefined ? new Uint8Array(file.size) : Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
        transfer.items.add(new File([bytes], file.name, { type: file.mime }));
      }
      const target = document.querySelector(selector)!;
      for (const type of events) {
        const event = type === "paste" ? new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }) : new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
        target.dispatchEvent(event);
      }
    },
    { selector, events, files: files.map((file) => ({ name: file.name, mime: file.mime, base64: file.bytes?.toString("base64") ?? "", size: file.size })) },
  );

test("attach by button, by drag and by paste: thumbnails and file chips, a remove, and the limit said in words", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  const chooser = page.waitForEvent("filechooser");
  await panel.getByRole("button", { name: "Attach files" }).click();
  await (await chooser).setFiles([
    { name: "hero.png", mimeType: "image/png", buffer: pngBytes(20, 20) },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("eleven char") },
  ]);
  const shelf = panel.getByTestId("attachments");
  await expect(shelf.getByRole("link", { name: "Preview hero.png" })).toBeVisible();
  await expect(shelf.locator("[data-chip='file']")).toHaveText(["notes.txt11 B"]);
  await shelf.getByRole("button", { name: "Remove notes.txt" }).click();
  await expect(shelf.locator("[data-chip='file']")).toHaveCount(0);

  // Dragging files over the rail shows the overlay; dropping them attaches them.
  await fileEvents(page, "aside[aria-label='Agent'] [data-testid='chat-tabs']", ["dragenter", "dragover"], [{ name: "brief.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF-1.4 brief") }]);
  await expect(panel.getByTestId("drop-overlay")).toHaveText("Drop files to attach");
  await fileEvents(page, "aside[aria-label='Agent'] [data-testid='chat-tabs']", ["drop"], [{ name: "brief.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF-1.4 brief") }]);
  await expect(panel.getByTestId("drop-overlay")).toHaveCount(0);
  await expect(shelf.locator("[data-chip='file']")).toHaveText(["brief.pdf14 B"]);

  // A pasted file attaches too.
  await fileEvents(page, "aside[aria-label='Agent'] .ProseMirror", ["paste"], [{ name: "pasted.png", mime: "image/png", bytes: pngBytes(12, 12, 3) }]);
  await expect(shelf.getByRole("link", { name: "Preview pasted.png" })).toBeVisible();

  // Over the limit: the exact sentence, and nothing staged.
  await fileEvents(page, "aside[aria-label='Agent'] [data-testid='chat-tabs']", ["dragenter", "drop"], [{ name: "huge.bin", mime: "application/octet-stream", size: 51 * 1024 * 1024 }]);
  await expect(panel.getByRole("alert")).toHaveText("'huge.bin' exceeds the 50 MB attachment limit.");
  await expect(shelf.locator("[data-chip='file']")).toHaveText(["brief.pdf14 B"]);

  await promptBox(panel).click();
  await promptBox(panel).pressSequentially("what is in this picture?");
  await promptBox(panel).press("Enter");
  await expect(panel.locator("[data-role='assistant']")).toContainText("A small red square.");
  await expect(panel.locator("[data-role='user']").getByRole("listitem")).toHaveText(["hero.png", "brief.pdf", "pasted.png"]);
  await expect(panel.getByTestId("attachments")).toHaveCount(0);
  const chat = await onlyChat(agent, (current) => current.latestTurn?.state === "completed");
  const sent = chat.messages.find((message) => message.role === "user")!;
  expect(sent.attachments?.map(({ name, type, kind, size }) => ({ name, type, kind, size }))).toEqual([
    { name: "hero.png", type: "image/png", kind: "image", size: pngBytes(20, 20).length },
    { name: "brief.pdf", type: "application/pdf", kind: "file", size: 14 },
    { name: "pasted.png", type: "image/png", kind: "image", size: pngBytes(12, 12, 3).length },
  ]);
});

/** A paste of text into the rail's box, as the page receives it. */
const pasteText = (page: Page, text: string) =>
  page.evaluate((text) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", text);
    document.querySelector("aside[aria-label='Agent'] .ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, text);

test("a large paste becomes pasted-text.txt with a toast; Cmd+Shift+V keeps it inline", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  const box = promptBox(panel);
  await box.click();
  const big = "log line\n".repeat(4000);
  await pasteText(page, big);
  const files = panel.getByTestId("attachments").locator("[data-chip='file'] [data-testid='chip-label']");
  await expect(files).toHaveText(["pasted-text.txt"]);
  const notice = toast(page, "Large paste attached as pasted-text.txt");
  await expect(notice).toBeVisible();
  const hint = process.platform === "darwin" ? "⌘⇧V" : "Ctrl+Shift+V";
  await expect(toastDescription(page, `35.2 KB · Use ${hint} to keep a large paste inline.`)).toBeVisible();
  await expect(box).toHaveText("");

  await pasteText(page, big);
  await expect(files).toHaveText(["pasted-text.txt", "pasted-text-2.txt"]);

  // Cmd+Shift+V first: the next paste goes into the box as it is.
  await page.evaluate((mac) => {
    document.querySelector("aside[aria-label='Agent'] .ProseMirror")!.dispatchEvent(new KeyboardEvent("keydown", { key: "V", shiftKey: true, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true }));
  }, process.platform === "darwin");
  await pasteText(page, "x".repeat(33 * 1024));
  await expect(files).toHaveCount(2);
  await expect.poll(async () => (await box.textContent())?.length).toBe(33 * 1024);
});

test("Cmd+S stashes the draft and clears it; the badge's menu restores and deletes; the 21st drops the oldest", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  const box = promptBox(panel);
  const badge = panel.getByTestId("stash-badge");
  const menu = page.getByRole("menu", { name: "Stashed prompts" });
  const mac = process.platform === "darwin";

  // An empty stash: Cmd+S in an empty box opens the menu with its hint.
  await box.click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(menu.getByText(`Nothing stashed yet. Press ${mac ? "⌘S" : "Ctrl+S"} with a prompt in the composer to stash it.`, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await box.click();
  await box.pressSequentially("first idea");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(box).toHaveText("");
  await expect(badge).toHaveAttribute("aria-label", "Stashed prompts: 1. Open stash.");
  // One entry: Cmd+S in the empty box brings it back.
  await page.keyboard.press("ControlOrMeta+s");
  await expect(box).toHaveText("first idea");
  await expect(badge).toHaveAttribute("aria-label", "Stashed prompts: 0. Open stash.");
  await page.keyboard.press("ControlOrMeta+s");
  await box.pressSequentially("second idea");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(badge).toHaveAttribute("aria-label", "Stashed prompts: 2. Open stash.");

  await badge.click();
  await expect(menu.getByRole("menuitem")).toHaveText([/^second ideajust now/, /^first ideajust now/]);
  await menu.getByRole("menuitem").first().hover();
  await page.keyboard.press(mac ? "Meta+Backspace" : "Control+Backspace");
  await expect(menu.getByRole("menuitem")).toHaveText([/^first idea/]);
  await menu.getByRole("menuitem").first().click();
  await expect(box).toHaveText("first idea");
  await expect(badge).toHaveAttribute("aria-label", "Stashed prompts: 0. Open stash.");

  // Twenty-one stashes: the oldest goes, with a toast.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  for (let n = 1; n <= 21; n++) {
    await box.pressSequentially(`idea ${n}`);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(box).toHaveText("");
  }
  const notice = toast(page, "Oldest stashed prompt discarded");
  await expect(notice).toBeVisible();
  await expect(toastDescription(page, "The stash holds 20 prompts; the oldest was removed to make room.")).toBeVisible();
  await expect(badge).toHaveAttribute("aria-label", "Stashed prompts: 20. Open stash.");
  await expect
    .poll(async () => {
      const { values } = await (await rpcOf(agent)).call("preferences.get", { keys: ["agent.stash.default"] });
      return (values["agent.stash.default"] as Array<{ text: string }> | undefined)?.map((entry) => entry.text);
    })
    .toEqual(Array.from({ length: 20 }, (_, index) => `idea ${21 - index}`));
});

test("ArrowUp in an empty box recalls this chat's earlier messages, newest first; ArrowDown past the newest clears", async ({ page }) => {
  const agent = await startAgentEngine({ script: await scriptFolder({ history: { when: "^history", turns: [{ text: "One." }, { text: "Two." }, { text: "Three." }] } }) });
  try {
    await openCanvas(page, agent);
    const panel = await openRail(page);
    const box = promptBox(panel);
    const lines = panel.locator(".ProseMirror p");
    await box.click();
    for (const [index, message] of ["history one", "history two\nsecond line", "history three"].entries()) {
      for (const [at, line] of message.split("\n").entries()) {
        if (at > 0) await page.keyboard.press("Shift+Enter");
        await page.keyboard.type(line);
      }
      await page.keyboard.press("Enter");
      await expect(panel.locator("[data-role='assistant']")).toHaveCount(index + 1);
    }

    await page.keyboard.press("ArrowUp");
    await expect(lines).toHaveText(["history three"]);
    await page.keyboard.press("ArrowUp");
    await expect(lines).toHaveText(["history two", "second line"]);
    // The caret is on the last line: ArrowUp moves it to the first before it recalls again.
    await page.keyboard.press("ArrowUp");
    await expect(lines).toHaveText(["history two", "second line"]);
    await page.keyboard.press("ArrowUp");
    await expect(lines).toHaveText(["history one"]);
    await page.keyboard.press("ArrowUp");
    await expect(lines).toHaveText(["history one"]);

    await page.keyboard.press("ArrowDown");
    await expect(lines).toHaveText(["history two", "second line"]);
    await page.keyboard.press("ArrowDown");
    await expect(lines).toHaveText(["history three"]);
    await page.keyboard.press("ArrowDown");
    await expect(box).toHaveText("");

    // Editing a recalled message ends the recall: the arrows move the caret again.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.type(" edited");
    await page.keyboard.press("ArrowUp");
    await expect(lines).toHaveText(["history three edited"]);
  } finally {
    await agent.dispose();
  }
});

const MENU_GLASS = "color-mix(in srgb, var(--popover) 18%, color-mix(in srgb, var(--popover) var(--glass-opacity), transparent))";

test("the Agent tray is t3code's composer on the kit: the rounded shell, kit chips and controls, the round Send, the kit menu look", async ({ page, agent }) => {
  await pageAndImages(page, agent);
  await openAgentTray(page);
  const tray = composer(page);
  const shell = tray.getByTestId("agent-composer");
  await inBothSchemes(page, async (scheme) => {
    await page.mouse.move(10, 10);
    expect(await styleOf(shell, "border-top-left-radius")).toBe("22px");
    // t3code's composer shadow in light; none in dark.
    expect((await styleOf(shell, "box-shadow")).includes("0px 12px 28px -18px")).toBe(scheme === "light");
    for (const chip of await chips(page).all()) await expectSlot(chip, "badge");
    await expectSlot(tray.getByRole("button", { name: "Remove Alpha" }), "button");
    await expectSlot(tray.getByRole("button", { name: "Attach files" }), "tooltip-trigger");
    await expectSlot(tray.getByTestId("model-picker"), "popover-trigger");
    await expectSlot(tray.getByRole("combobox", { name: "Runtime mode" }), "tooltip-trigger");
    await expectSlot(tray.getByTestId("stash-badge"), "menu-trigger");
    // The plan toggle is the kit Toggle, on the accent while pressed (Shift+Tab flips it from the box).
    const toggle = tray.getByTestId("plan-toggle");
    await promptBox(tray).click();
    await page.keyboard.press("Shift+Tab");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(10, 10);
    await expectToken(toggle, "background-color", "--accent");
    await page.keyboard.press("Shift+Tab");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    // Send is t3code's round message action.
    const send = tray.getByRole("button", { name: "Send", exact: true });
    await expectSlot(send, "message-action");
    await expectToken(send, "background-color", "--message-action");

    // The @ menu has the kit's menu popup look.
    await promptBox(tray).click();
    await promptBox(tray).pressSequentially("@");
    const mentions = page.getByRole("listbox", { name: "Mentions" });
    await expect(mentions).toBeVisible();
    expect(await styleOf(mentions, "background-color")).toBe(await resolvedColor(page, MENU_GLASS));
    await page.keyboard.press("Backspace");
    await expect(mentions).toHaveCount(0);
  });
});
