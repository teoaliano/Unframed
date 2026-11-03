import type { Locator, Page } from "@playwright/test";
import { openCanvas, shapeOnScreen, toast } from "./canvas.ts";
import { clickShape, composer, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { filledMedia, putRecords } from "./media.ts";
import { artifactColumn, chosenControl, createChat, enablePlanMode, engineChats, expect, onlyChat, openRail, promptBox, rail, rpcOf, say, scriptFolder, startAgentEngine, tabs, test, userTexts } from "./agent.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { expectSlot, expectToken, inBothSchemes, resolvedColor, styleOf } from "./kit.ts";
import { platformOf } from "./platform.ts";
import { writeProjectFile } from "./artifacts.ts";

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

test("the error line is a notice above the composer: it fades in, a clipped one shows its whole text on demand, and Dismiss clears it", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  const name = `${"a-very-long-file-name-".repeat(6)}.bin`;
  await fileEvents(page, "aside[aria-label='Agent'] [data-testid='chat-tabs']", ["dragenter", "drop"], [{ name, mime: "application/octet-stream", size: 51 * 1024 * 1024 }]);
  const sentence = `'${name}' exceeds the 50 MB attachment limit.`;
  const notice = panel.getByTestId("composer-notices").getByRole("alert");
  await expect(notice).toHaveText(sentence);
  // Above the composer, in the tray, with t3code's fade in.
  const noticeBox = (await notice.boundingBox())!;
  const composerBox = (await panel.getByTestId("agent-composer").boundingBox())!;
  expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(composerBox.y);
  await expect(notice).toHaveClass(/starting:opacity-0/);

  const details = notice.getByRole("button", { name: `Show full title: ${sentence}` });
  await details.hover();
  await expect(page.getByRole("dialog", { name: "Notice details" })).toHaveText(sentence);

  await notice.getByRole("button", { name: "Dismiss error" }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
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
  const { mac } = await platformOf(page);
  const hint = mac ? "⌘⇧V" : "Ctrl+Shift+V";
  await expect(toastDescription(page, `35.2 KB · Use ${hint} to keep a large paste inline.`)).toBeVisible();
  await expect(box).toHaveText("");

  await pasteText(page, big);
  await expect(files).toHaveText(["pasted-text.txt", "pasted-text-2.txt"]);

  // Cmd+Shift+V first: the next paste goes into the box as it is.
  await page.evaluate((mac) => {
    document.querySelector("aside[aria-label='Agent'] .ProseMirror")!.dispatchEvent(new KeyboardEvent("keydown", { key: "V", shiftKey: true, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true }));
  }, mac);
  await pasteText(page, "x".repeat(33 * 1024));
  await expect(files).toHaveCount(2);
  await expect.poll(async () => (await box.textContent())?.length).toBe(33 * 1024);
});

test("Cmd+S stashes the draft and clears it; the badge's drawer restores and deletes; the 21st drops the oldest", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  const box = promptBox(panel);
  const badge = panel.getByTestId("stash-badge");
  const drawer = panel.getByTestId("stash-drawer");
  const rows = drawer.getByRole("list", { name: "Stashed prompts" }).getByRole("listitem");
  const { shortcut } = await platformOf(page);

  // An empty stash: no badge, and Cmd+S in an empty box opens the drawer with its hint.
  await box.click();
  await expect(badge).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(rows).toHaveText([`Nothing stashed yet. Press ${shortcut("S")} with a prompt in the composer to stash it.`]);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  await box.click();
  await box.pressSequentially("first idea");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(box).toHaveText("");
  await expect(badge).toHaveAttribute("aria-label", "Stashed prompts: 1. Open stash.");
  // Each stash replays the count's pulse.
  await expect(badge.getByTestId("stash-count")).toHaveClass(/animate-stash-pulse-count/);
  // One entry: Cmd+S in the empty box brings it back.
  await page.keyboard.press("ControlOrMeta+s");
  await expect(box).toHaveText("first idea");
  await expect(badge).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+s");
  await box.pressSequentially("second idea");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(badge).toHaveAttribute("aria-label", "Stashed prompts: 2. Open stash.");

  // The drawer docks above the composer; its keys work from the box, which keeps the focus.
  await badge.click();
  await expect(rows).toHaveText([/^second ideajust now/, /^first ideajust now/]);
  await expect(drawer.getByRole("button", { name: "Close stash" })).toBeVisible();
  await expect(box).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ControlOrMeta+Backspace");
  await expect(rows).toHaveText([/^first idea/]);
  await page.keyboard.press("Enter");
  await expect(box).toHaveText("first idea");
  await expect(drawer).toHaveCount(0);
  await expect(badge).toHaveCount(0);

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

test("the stash drawer takes its keys only from the box, itself or the badge; a click outside closes it", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  const box = promptBox(panel);
  const drawer = panel.getByTestId("stash-drawer");
  const rows = drawer.getByRole("list", { name: "Stashed prompts" }).getByRole("listitem");
  await box.click();
  for (const idea of ["first idea", "second idea"]) {
    await box.pressSequentially(idea);
    await page.keyboard.press("ControlOrMeta+s");
  }
  // Keys in another field are that field's (t3code's scoping): the badge keeps the focus where it was.
  await panel.getByRole("button", { name: "Search chats" }).click();
  const search = panel.getByRole("textbox", { name: "Search chats" });
  await expect(search).toBeFocused();
  await panel.getByTestId("stash-badge").click();
  await expect(rows).toHaveCount(2);
  await expect(search).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+Backspace");
  await expect(rows).toHaveCount(2);
  await expect(box).toHaveText("");

  // An attachment-only entry reads as what it holds.
  await page.mouse.click(5, 5);
  await expect(drawer).toHaveCount(0);
  const chooser = page.waitForEvent("filechooser");
  await panel.getByRole("button", { name: "Attach files" }).click();
  await (await chooser).setFiles([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("eleven char") }]);
  await expect(panel.getByTestId("attachments").locator("[data-chip='file'][data-status='ready']")).toHaveCount(1);
  await box.click();
  await page.keyboard.press("ControlOrMeta+s");
  await panel.getByTestId("stash-badge").click();
  await expect(rows.first()).toHaveText(/^\(1 file\)/);
  await expect(rows.first().getByLabel("1 file", { exact: true })).toBeVisible();
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

test("restoring a stashed prompt puts it after the draft and adds only the files the draft lacks", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  const box = promptBox(panel);
  const shelf = panel.getByTestId("attachments");
  const attach = async () => {
    const chooser = page.waitForEvent("filechooser");
    await panel.getByRole("button", { name: "Attach files" }).click();
    await (await chooser).setFiles([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("eleven char") }]);
    await expect(shelf.locator("[data-chip='file'][data-status='ready']")).toHaveCount(1);
  };
  await attach();
  await box.click();
  await box.pressSequentially("set aside");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(box).toHaveText("");
  await expect(shelf).toHaveCount(0);

  await box.pressSequentially("now typing");
  await attach();
  await panel.getByTestId("stash-badge").click();
  await panel.getByTestId("stash-drawer").getByRole("button", { name: /^Restore stashed prompt/ }).first().click();
  await expect(panel.locator(".ProseMirror p")).toHaveText(["now typing", "", "set aside"]);
  await expect(shelf.locator("[data-chip='file']")).toHaveText(["notes.txt11 B"]);
});

test("a prompt over 120,000 characters says by how much under the box and cannot be sent", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  const box = promptBox(panel);
  await box.click();
  await page.keyboard.insertText("x".repeat(120_002));
  const error = panel.getByTestId("prompt-length-error");
  await expect(error).toHaveText("Prompt is 2 characters over the 120,000-character limit. Shorten or split it before sending.");
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(panel.locator("[data-role='user']")).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await expect(error).toHaveText("Prompt is 1 character over the 120,000-character limit. Shorten or split it before sending.");
  await page.keyboard.press("Backspace");
  await expect(error).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
});

test("ArrowUp recalls a repeated message once, moves through a wrapped line before it recalls, and is off while a file is staged", async ({ page }) => {
  const agent = await startAgentEngine({ script: await scriptFolder({ history: { when: "^history", turns: [{ text: "One." }, { text: "Two." }, { text: "Three." }] } }) });
  try {
    await openCanvas(page, agent);
    const panel = await openRail(page);
    const box = promptBox(panel);
    const lines = panel.locator(".ProseMirror p");
    const long = `history long ${"word ".repeat(40).trim()}`;
    await box.click();
    for (const [index, message] of [long, "history short", "history short"].entries()) {
      await page.keyboard.type(message);
      await page.keyboard.press("Enter");
      await expect(panel.locator("[data-role='assistant']")).toHaveCount(index + 1);
    }

    await page.keyboard.press("ArrowUp");
    await expect(lines).toHaveText(["history short"]);
    await page.keyboard.press("ArrowUp");
    await expect(lines).toHaveText([long]);
    // The caret is on the last of several wrapped lines: ArrowUp moves it up a line first.
    await page.keyboard.press("ArrowUp");
    await expect(lines).toHaveText([long]);
    await page.keyboard.press("ArrowDown");
    await expect(lines).toHaveText([long]);
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowDown");
    await expect(lines).toHaveText(["history short"]);
    await page.keyboard.press("ArrowDown");
    await expect(box).toHaveText("");

    const chooser = page.waitForEvent("filechooser");
    await panel.getByRole("button", { name: "Attach files" }).click();
    await (await chooser).setFiles([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("eleven char") }]);
    await box.click();
    await page.keyboard.press("ArrowUp");
    await expect(box).toHaveText("");
  } finally {
    await agent.dispose();
  }
});

const MENU_GLASS = "color-mix(in srgb, var(--popover) 18%, color-mix(in srgb, var(--popover) var(--glass-opacity), transparent))";

test("the Agent tray is t3code's composer on the kit: the rounded shell, kit chips and controls, the round Send, the kit menu look", async ({ page, agent }) => {
  await enablePlanMode(agent);
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
    await expectSlot(tray.getByRole("button", { name: "More composer controls" }), "menu-trigger");
    // The mode sits in the More menu as the kit's radio items; Shift+Tab flips it from the box.
    await promptBox(tray).click();
    await page.keyboard.press("Shift+Tab");
    expect(await chosenControl(tray, "Mode")).toBe("Plan");
    await promptBox(tray).click();
    await page.keyboard.press("Shift+Tab");
    expect(await chosenControl(tray, "Mode")).toBe("Build");
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

test("a chat's unsent draft follows it between the canvas rail and the editor's rail, both ways; another chat keeps its own", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeProjectFile(agent, "alpha.html", "<h1>Alpha</h1>");
  await putRecords(agent, artifactColumn([{ id: "shape:p1", title: "Alpha", file: "alpha.html" }]));
  await openCanvas(page, agent);
  await createChat(agent, { title: "Brief", tags: ["shape:p1"] });
  await createChat(agent, { title: "Other", tags: ["shape:p1"] });
  const panel = await openRail(page);
  await panel.getByRole("tab", { name: "Brief" }).click();
  await promptBox(panel).click();
  await promptBox(panel).pressSequentially("Make the title bigger");

  // Another chat starts empty, and coming back brings the draft back.
  await panel.getByRole("tab", { name: "Other" }).click();
  await expect(promptBox(panel)).toHaveText("");
  await panel.getByRole("tab", { name: "Brief" }).click();
  await expect(promptBox(panel)).toHaveText("Make the title bigger");

  const editor = page.getByTestId("artifact-editor");
  const editorRail = editor.locator("[data-editor-column='rail']");
  const at = (await shapeOnScreen(page, "shape:p1").boundingBox())!;
  await page.mouse.dblclick(at.x + at.width / 2, at.y + at.height / 2);
  await expect(editor).toBeVisible();
  await editorRail.getByRole("tab", { name: "Brief" }).click();
  await expect(promptBox(editorRail)).toHaveText("Make the title bigger");

  await promptBox(editorRail).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and red");
  await editor.getByRole("button", { name: "Back to canvas" }).click();
  await expect(editor).toHaveCount(0);
  await expect(promptBox(panel)).toHaveText("Make the title bigger and red");

  // Closed and opened again, the rail still has it.
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
  await openRail(page);
  await expect(promptBox(panel)).toHaveText("Make the title bigger and red");

  // A new chat's draft goes once it is sent: the next new chat starts empty.
  await panel.getByRole("button", { name: "New chat" }).click();
  await expect(promptBox(panel)).toHaveText("");
  await promptBox(panel).click();
  await promptBox(panel).pressSequentially("Start something new");
  await promptBox(panel).press("Enter");
  await expect(panel.getByRole("tab")).toHaveCount(3);
  await panel.getByRole("button", { name: "New chat" }).click();
  await expect(promptBox(panel)).toHaveText("");
});

test("a context chip from a draft's @ mention follows the draft between chats; the canvas selection's chips stay", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, artifactColumn([{ id: "shape:p1", title: "Alpha" }]));
  await openCanvas(page, agent);
  await createChat(agent, { title: "Brief" });
  await createChat(agent, { title: "Other" });
  const panel = await openRail(page);
  const context = panel.getByRole("list", { name: "Context" }).getByRole("listitem");
  await panel.getByRole("tab", { name: "Brief" }).click();
  await promptBox(panel).click();
  await promptBox(panel).pressSequentially("@alp");
  await page.keyboard.press("Tab");
  await expect(context).toHaveText(["Alpha"]);

  await panel.getByRole("tab", { name: "Other" }).click();
  await expect(promptBox(panel)).toHaveText("");
  await expect(context).toHaveCount(0);
  await panel.getByRole("tab", { name: "Brief" }).click();
  await expect(promptBox(panel).locator("[data-agent-chip]")).toHaveText(["Alpha"]);
  await expect(context).toHaveText(["Alpha"]);
});

test("a draft shown again after a tab switch is not an undo step", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await createChat(agent, { title: "Brief" });
  await createChat(agent, { title: "Other" });
  const panel = await openRail(page);
  await panel.getByRole("tab", { name: "Brief" }).click();
  await promptBox(panel).click();
  await promptBox(panel).pressSequentially("Make the title bigger");
  await panel.getByRole("tab", { name: "Other" }).click();
  await panel.getByRole("tab", { name: "Brief" }).click();
  await expect(promptBox(panel)).toHaveText("Make the title bigger");
  await promptBox(panel).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(promptBox(panel)).not.toHaveText("");
});

/** The drafts the engine keeps for the default project, by chat. */
const storedDrafts = async (agent: TestEngine) => {
  const { values } = await (await rpcOf(agent)).call("preferences.get", { keys: ["agent.drafts.default"] });
  return (values["agent.drafts.default"] ?? null) as Record<string, { text: string; attachments: Array<{ name: string }> }> | null;
};

test("each chat's draft keeps its attachments, and every draft survives a reload until it is sent", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const brief = await createChat(agent, { title: "Brief" });
  await createChat(agent, { title: "Other" });
  const panel = await openRail(page);
  const box = promptBox(panel);
  const shelf = panel.getByTestId("attachments");
  await panel.getByRole("tab", { name: "Brief" }).click();
  const chooser = page.waitForEvent("filechooser");
  await panel.getByRole("button", { name: "Attach files" }).click();
  await (await chooser).setFiles([
    { name: "hero.png", mimeType: "image/png", buffer: pngBytes(20, 20) },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("eleven char") },
  ]);
  await expect(shelf.locator("[data-chip='file'][data-status='ready']")).toHaveText(["notes.txt11 B"]);
  await expect(shelf.locator("[data-status='ready']")).toHaveCount(2);
  await box.click();
  await box.pressSequentially("Keep this for later");

  // Another chat has neither the text nor the file; coming back brings both.
  await panel.getByRole("tab", { name: "Other" }).click();
  await expect(box).toHaveText("");
  await expect(shelf).toHaveCount(0);
  await box.click();
  await box.pressSequentially("Other thoughts");
  await panel.getByRole("tab", { name: "Brief" }).click();
  await expect(box).toHaveText("Keep this for later");
  await expect(shelf.locator("[data-chip='file']")).toHaveText(["notes.txt11 B"]);
  await expect(shelf.getByRole("link", { name: "Preview hero.png" })).toBeVisible();

  // Written to the preferences store, then a reload: both drafts come back.
  await expect
    .poll(async () => {
      const draft = (await storedDrafts(agent))?.[brief];
      return draft && { text: draft.text, names: draft.attachments.map((item) => item.name).sort() };
    })
    .toEqual({ text: "Keep this for later", names: ["hero.png", "notes.txt"] });
  await page.reload();
  const again = await openRail(page);
  await again.getByRole("tab", { name: "Brief" }).click();
  await expect(promptBox(again)).toHaveText("Keep this for later");
  await expect(again.getByTestId("attachments").locator("[data-chip='file']")).toHaveText(["notes.txt11 B"]);
  await expect(again.getByTestId("attachments").getByLabel("Preview hero.png")).toBeVisible();
  // The restored image's thumbnail is the stored file, loaded, not a blank tile.
  await expect.poll(() => again.getByTestId("attachments").getByLabel("Preview hero.png").locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(20);
  await again.getByRole("tab", { name: "Other" }).click();
  await expect(promptBox(again)).toHaveText("Other thoughts");

  // Sent, the draft goes, here and in the store.
  await again.getByRole("tab", { name: "Brief" }).click();
  await promptBox(again).click();
  await page.keyboard.press("Enter");
  await expect(again.locator("[data-role='user']")).toHaveCount(1);
  await expect(promptBox(again)).toHaveText("");
  await expect(again.getByTestId("attachments")).toHaveCount(0);
  await expect.poll(async () => Object.keys((await storedDrafts(agent)) ?? {})).not.toContain(brief);
});

test("the toolbar's Agent tray keeps its own draft across a reload", async ({ page, agent }) => {
  await pageAndImages(page, agent);
  await openAgentTray(page);
  await promptBox(composer(page)).pressSequentially("from the toolbar");
  await expect.poll(async () => (await storedDrafts(agent))?.toolbar?.text).toBe("from the toolbar");
  await page.reload();
  await clickShape(page, "shape:p1");
  await openAgentTray(page);
  await expect(promptBox(composer(page))).toHaveText("from the toolbar");
  const panel = await openRail(page);
  await expect(promptBox(panel)).toHaveText("");
});

test("a file pasted or dropped into a prompt with text puts its chip at the caret; removing the file or the chip removes the other", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  const box = promptBox(panel);
  const shelf = panel.getByTestId("attachments");
  const inline = box.locator("[data-agent-chip]");
  await box.click();
  await box.pressSequentially("compare  with the brief");
  // A person pastes once the caret has moved. A loaded headless page can lose the editor's
  // hold on a caret moved by keys, so the caret is placed again until it stays.
  const beforeCaret = () =>
    box.evaluate((element) => {
      const selection = element.ownerDocument.getSelection();
      if (!selection?.focusNode) return null;
      const range = element.ownerDocument.createRange();
      range.setStart(element, 0);
      range.setEnd(selection.focusNode, selection.focusOffset);
      return range.toString();
    });
  await expect(async () => {
    await page.keyboard.press("End");
    for (let n = 0; n < " with the brief".length; n++) await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(250);
    expect(await beforeCaret()).toBe("compare ");
  }).toPass({ timeout: 15_000 });

  // A paste into the text: the chip lands where the caret was, once the image is uploaded.
  await fileEvents(page, "aside[aria-label='Agent'] .ProseMirror", ["paste"], [{ name: "pasted.png", mime: "image/png", bytes: pngBytes(12, 12, 3) }]);
  await expect(shelf.getByRole("link", { name: "Preview pasted.png" })).toBeVisible();
  await expect(inline).toHaveText(["pasted.png"]);
  await expect(box).toHaveText(/^compare  ?pasted\.png ?with the brief$/);

  // Removing the image removes its chip.
  await shelf.getByRole("button", { name: "Remove pasted.png" }).click();
  await expect(inline).toHaveCount(0);
  await expect(box).toHaveText(/^compare +with the brief$/);

  // A dropped file joins the text too; deleting its chip removes the file, and undo brings both back.
  await page.keyboard.press("End");
  await fileEvents(page, "aside[aria-label='Agent'] [data-testid='chat-tabs']", ["dragenter", "drop"], [{ name: "brief.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF-1.4 brief") }]);
  await expect(inline).toHaveText(["brief.pdf"]);
  await expect(shelf.locator("[data-chip='file']")).toHaveText(["brief.pdf14 B"]);
  await box.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(inline).toHaveCount(0);
  await expect(shelf).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(inline).toHaveText(["brief.pdf"]);
  await expect(shelf.locator("[data-chip='file']")).toHaveText(["brief.pdf14 B"]);

  // A paste into an empty prompt attaches without a chip.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await expect(box).toHaveText("");
  await expect(shelf).toHaveCount(0);
  await fileEvents(page, "aside[aria-label='Agent'] .ProseMirror", ["paste"], [{ name: "alone.png", mime: "image/png", bytes: pngBytes(10, 10, 1) }]);
  await expect(panel.getByTestId("attachments").getByRole("link", { name: "Preview alone.png" })).toBeVisible();
  await expect(inline).toHaveCount(0);
});

test("the model reads an attachment's chip by its id; a chip copied from one unsent draft brings its file into another", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await createChat(agent, { title: "Brief" });
  await createChat(agent, { title: "Other" });
  const panel = await openRail(page);
  const box = promptBox(panel);
  const shelf = panel.getByTestId("attachments");
  await panel.getByRole("tab", { name: "Brief" }).click();
  await box.click();
  await box.pressSequentially("look at");
  await fileEvents(page, "aside[aria-label='Agent'] .ProseMirror", ["paste"], [{ name: "pasted.png", mime: "image/png", bytes: pngBytes(12, 12, 3) }]);
  await expect(box.locator("[data-agent-chip]")).toHaveText(["pasted.png"]);
  const chipHtml = await box.locator("[data-agent-chip]").evaluate((element) => element.outerHTML);

  // Pasted into another chat's draft, the chip brings the image with it.
  await panel.getByRole("tab", { name: "Other" }).click();
  await expect(shelf).toHaveCount(0);
  await box.click();
  await box.pressSequentially("and this ");
  await page.evaluate((html) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    transfer.setData("text/plain", "pasted.png");
    document.querySelector("aside[aria-label='Agent'] .ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, chipHtml);
  await expect(box.locator("[data-agent-chip]")).toHaveText(["pasted.png"]);
  await expect(shelf.getByLabel("Preview pasted.png")).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(panel.locator("[data-role='user']")).toHaveCount(1);
  const other = (await engineChats(agent)).find((chat) => chat.title === "Other")!;
  await expect.poll(() => userTexts(agent, other.id)).toEqual([expect.stringMatching(/^and this \[Image: pasted\.png; ref=[0-9a-f]{32}\.png\]\s*$/)]);
});

test("the Send shortcut: Cmd+Enter for several lines sends one line on Enter and breaks a multiline one; Cmd+Enter always leaves Enter to break the line", async ({ page, agent }) => {
  await (await rpcOf(agent)).call("preferences.set", { key: "agent.sendShortcut", value: "mod-enter-multiline" });
  await openCanvas(page, agent);
  const panel = await openRail(page);
  const box = promptBox(panel);
  const lines = panel.locator(".ProseMirror p");
  await box.click();
  await page.keyboard.type("one line");
  await page.keyboard.press("Enter");
  await expect(panel.locator("[data-role='assistant']")).toHaveCount(1);
  const chatId = (await onlyChat(agent)).id;

  await page.keyboard.type("first");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second");
  await page.keyboard.press("Enter");
  await expect(lines).toHaveCount(2);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(panel.locator("[data-role='assistant']")).toHaveCount(2);
  await expect.poll(() => userTexts(agent, chatId)).toEqual(["one line", "first\nsecond"]);

  await (await rpcOf(agent)).call("preferences.set", { key: "agent.sendShortcut", value: "mod-enter" });
  await page.keyboard.type("only with the chord");
  await page.keyboard.press("Enter");
  await expect(lines).toHaveText(["only with the chord", ""]);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await userTexts(agent, chatId)).at(-1)).toBe("only with the chord");
  await expect(box).toHaveText("");
});

test("Cmd+Option+Enter sends and opens a new chat, from a chat and from a new one", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  const box = promptBox(panel);
  await say(panel, "start here");
  await expect(panel.locator("[data-role='assistant']")).toHaveCount(1);
  await expect(tabs(page)).toHaveCount(1);
  const first = (await onlyChat(agent)).id;

  await box.click();
  await page.keyboard.type("one more, then a new chat");
  await page.keyboard.press("ControlOrMeta+Alt+Enter");
  await expect.poll(async () => (await userTexts(agent, first)).at(-1)).toBe("one more, then a new chat");
  await expect(tabs(page).and(page.locator("[aria-selected='true']"))).toHaveCount(0);
  await expect(box).toHaveText("");
  await expect(box).toBeFocused();

  await page.keyboard.type("a fresh one");
  await page.keyboard.press("ControlOrMeta+Alt+Enter");
  await expect.poll(async () => (await engineChats(agent)).length).toBe(2);
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).and(page.locator("[aria-selected='true']"))).toHaveCount(0);
  await expect(box).toHaveText("");
});

test("in the rail, a key or a paste outside a field goes to the composer: after a click on the transcript or a chat tab, never from the canvas, a menu or a field", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  const box = promptBox(panel);
  await say(panel, "hello there");
  await expect(panel.locator("[data-role='assistant']")).toHaveCount(1);

  // A click on a message leaves no field focused: typing goes to the end of the box.
  await box.pressSequentially("draft ");
  await panel.locator("[data-role='user'] [data-testid='message-text']").click();
  await expect(box).not.toBeFocused();
  await page.keyboard.type("typed");
  await expect(box).toBeFocused();
  await expect(box).toHaveText("draft typed");

  // A paste goes there too.
  await panel.locator("[data-role='user'] [data-testid='message-text']").click();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", " pasted");
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await expect(box).toHaveText("draft typed pasted");

  // From the chat's tab as well.
  await tabs(page).first().focus();
  await page.keyboard.type("!");
  await expect(box).toHaveText("draft typed pasted!");

  // An open menu keeps its keys.
  await panel.getByRole("button", { name: "More composer controls" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");
  await expect(box).toHaveText("draft typed pasted!");

  // The canvas keeps its keys: tldraw's shortcuts, not the composer.
  await page.mouse.click(700, 400);
  await page.keyboard.type("q");
  await expect(box).toHaveText("draft typed pasted!");
});

const LONG_REPLY = Array.from({ length: 60 }, (_, index) => `Line ${index + 1} of a long answer.`).join("\n\n");

/** A chat whose one reply is longer than the rail, open in the rail, its box empty and focused. */
const longChat = async (page: Page, agent: TestEngine) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  await say(panel, "long answer please");
  await expect(panel.locator("[data-role='assistant']")).toContainText("Line 60 of a long answer.");
  return panel;
};

/** One wheel gesture over the transcript, after the last one ended (typing during a gesture keeps it from resting the composer). */
const wheelOverTranscript = async (page: Page, panel: Locator, deltaY: number) => {
  await page.waitForTimeout(200);
  const box = (await panel.getByTestId("transcript").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
};

test("the composer rests on one line with its controls in a strip once the person scrolls up a long chat, and expands on a click, typing or the end", async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { animated: string[] }).animated = seen;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, keyframes, options) {
      seen.push(JSON.stringify(keyframes));
      return animate.call(this, keyframes, options);
    };
  });
  const agent = await startAgentEngine({ script: await scriptFolder({ long: { when: "^long answer", turns: [{ text: LONG_REPLY }] } }) });
  try {
    const panel = await longChat(page, agent);
    const shell = panel.getByTestId("agent-composer");
    const box = promptBox(panel);
    await expect(shell).not.toHaveAttribute("data-resting");

    // A wheel up the transcript rests it: one line, the controls in the strip under it, Send beside the line.
    await wheelOverTranscript(page, panel, -300);
    await expect(shell).toHaveAttribute("data-resting", "true");
    await expect(shell.getByTestId("resting-controls").getByRole("button", { name: "More composer controls" })).toBeVisible();
    await expect.poll(() => shell.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
    expect((await box.boundingBox())!.height).toBeLessThanOrEqual(33);
    const send = (await shell.getByRole("button", { name: "Send", exact: true }).boundingBox())!;
    const line = (await box.boundingBox())!;
    expect(Math.abs(send.y + send.height / 2 - (line.y + line.height / 2))).toBeLessThan(8);
    // The shell's height moved on t3code's drawer curve, the arriving strip with a 4 px drift.
    await expect.poll(() => page.evaluate(() => (window as unknown as { animated: string[] }).animated.join(" "))).toContain("height");
    expect(await page.evaluate(() => (window as unknown as { animated: string[] }).animated.join(" "))).toContain("translateY(-4px)");

    // A click on the line expands it.
    await box.click();
    await expect(shell).not.toHaveAttribute("data-resting");

    // Typing expands it too, even with the box still focused.
    await wheelOverTranscript(page, panel, -300);
    await expect(shell).toHaveAttribute("data-resting", "true");
    await page.keyboard.type("one line");
    await expect(shell).not.toHaveAttribute("data-resting");

    // A one-line draft still rests; scrolling back down to the end expands it.
    await wheelOverTranscript(page, panel, -300);
    await expect(shell).toHaveAttribute("data-resting", "true");
    await wheelOverTranscript(page, panel, 100_000);
    await expect(shell).not.toHaveAttribute("data-resting");

    // A draft of several lines never rests.
    await box.click();
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("second line");
    await wheelOverTranscript(page, panel, -300);
    await page.waitForTimeout(300);
    await expect(shell).not.toHaveAttribute("data-resting");
  } finally {
    await agent.dispose();
  }
});

test("with reduced motion the composer rests and expands without moving anything", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { animated: string[] }).animated = seen;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, keyframes, options) {
      seen.push(JSON.stringify(keyframes));
      return animate.call(this, keyframes, options);
    };
  });
  const agent = await startAgentEngine({ script: await scriptFolder({ long: { when: "^long answer", turns: [{ text: LONG_REPLY }] } }) });
  try {
    const panel = await longChat(page, agent);
    const shell = panel.getByTestId("agent-composer");
    await wheelOverTranscript(page, panel, -300);
    await expect(shell).toHaveAttribute("data-resting", "true");
    await promptBox(panel).click();
    await expect(shell).not.toHaveAttribute("data-resting");
    const animated = await page.evaluate(() => (window as unknown as { animated: string[] }).animated.join(" "));
    expect(animated).not.toContain("height");
    expect(animated).not.toContain("transform");
  } finally {
    await agent.dispose();
  }
});
