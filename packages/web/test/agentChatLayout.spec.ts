import type { Locator, Page } from "@playwright/test";
import { openCanvas, shapeOnScreen } from "./canvas.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { agentChromeButton, expect, promptBox, rail, rpcOf, say, tabs, test } from "./agent.ts";
import { dialsPage, filledArtifact, writeBridge } from "./artifacts.ts";
import { clickShape } from "./generation.ts";
import { openSettings, showSection } from "./settings.ts";

const setLayout = async (engine: TestEngine, value: "panel" | "composer" | "window") => {
  await (await rpcOf(engine)).call("preferences.set", { key: "agent.chatLayout", value });
};

const conversation = (page: Page): Locator => rail(page).getByTestId("agent-conversation");

const floatingComposer = (page: Page): Locator => rail(page).getByTestId("agent-floating-composer");

const boxOf = async (locator: Locator) => (await locator.boundingBox())!;

/** The element on top at a point: the canvas, or the part of the chat that would take the click. */
const hitAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return { canvas: hit?.closest(".tl-container") !== null, chat: hit?.closest("aside[aria-label='Agent']") !== null };
    },
    { x, y },
  );

/** The floating composer's column spans the bottom toolbar, kept 8 px inside the window's sides. */
const expectToolbarSpan = async (page: Page, locator: Locator) => {
  const toolbar = await boxOf(page.getByTestId("bottom-toolbar"));
  const width = page.viewportSize()!.width;
  const left = Math.max(8, toolbar.x);
  const right = Math.min(width - 8, toolbar.x + toolbar.width);
  const box = await boxOf(locator);
  expect(Math.abs(box.x - left)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.x + box.width - right)).toBeLessThanOrEqual(2);
};

/** Whether the empty prompt's placeholder fits on one line of the prompt. */
const placeholderFits = (scope: Locator) =>
  scope.locator("[data-agent-prompt] p.is-editor-empty").evaluate((line) => {
    const probe = document.createElement("span");
    const before = getComputedStyle(line, "::before");
    for (const property of ["font-family", "font-size", "font-weight", "font-style", "letter-spacing"]) probe.style.setProperty(property, before.getPropertyValue(property));
    probe.style.whiteSpace = "nowrap";
    probe.style.position = "absolute";
    probe.textContent = line.getAttribute("data-placeholder");
    document.body.append(probe);
    const needed = probe.getBoundingClientRect().width;
    probe.remove();
    return needed <= line.clientWidth;
  });

const drag = async (page: Page, from: { x: number; y: number }, dx: number, dy: number) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) await page.mouse.move(from.x + (dx * step) / 8, from.y + (dy * step) / 8);
  await page.mouse.up();
};

test("Agent chat layout sits in Settings → Agents: Side panel by default, three options with hints, saved at once and kept across a reload", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const dialog = await openSettings(page);
  await showSection(dialog, "Agents");
  const select = dialog.getByRole("combobox", { name: "Agent chat layout" });
  await expect(select).toHaveText("Side panel");
  await select.click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await expect(page.getByRole("option", { name: /Side panel/ })).toContainText("Left panel, as today");
  await expect(page.getByRole("option", { name: /Floating composer/ })).toContainText("Composer at the bottom center, conversation opens above it");
  await expect(page.getByRole("option", { name: /Floating window/ })).toContainText("A movable, resizable window, like Parameters");
  await page.getByRole("option", { name: /Floating window/ }).click();
  await expect(select).toHaveText("Floating window");
  await expect.poll(async () => (await (await rpcOf(agent)).call("preferences.get", { keys: ["agent.chatLayout"] })).values["agent.chatLayout"]).toBe("window");

  await page.reload();
  await openCanvas(page, agent);
  await agentChromeButton(page).click();
  await expect(rail(page)).toHaveAttribute("data-layout", "window");
  const reopened = await openSettings(page);
  await showSection(reopened, "Agents");
  await expect(reopened.getByRole("combobox", { name: "Agent chat layout" })).toHaveText("Floating window");
});

test("an unknown saved layout reads as the side panel", async ({ page, agent }) => {
  await (await rpcOf(agent)).call("preferences.set", { key: "agent.chatLayout", value: "sidebar" });
  await openCanvas(page, agent);
  await agentChromeButton(page).click();
  await expect(rail(page)).toHaveAttribute("data-layout", "rail");
  await expect(rail(page)).toHaveAttribute("data-slot", "docked-rail");
});

test("changing the layout moves the same chat between the side panel, the floating composer and the floating window, keeping the conversation, the tab and the draft", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await agentChromeButton(page).click();
  const panel = rail(page);
  await expect(panel).toHaveAttribute("data-state", "open");
  await say(panel, "what is on the board?");
  await expect(panel.locator("[data-role='assistant']")).toContainText("Three shapes: motion m1");
  await expect(tabs(page)).toHaveText(["What is on the board"]);
  const box = promptBox(panel);
  await box.click();
  await box.pressSequentially("keep this draft");
  // The same elements throughout: nothing in the chat is mounted again.
  await page.evaluate(() => {
    const scope = window as unknown as Record<string, unknown>;
    scope.chatPrompt = document.querySelector("aside[aria-label='Agent'] .ProseMirror");
    scope.chatTranscript = document.querySelector("aside[aria-label='Agent'] [data-testid='transcript']");
  });
  const same = () =>
    page.evaluate(() => {
      const scope = window as unknown as Record<string, unknown>;
      return (
        scope.chatPrompt === document.querySelector("aside[aria-label='Agent'] .ProseMirror") &&
        scope.chatTranscript === document.querySelector("aside[aria-label='Agent'] [data-testid='transcript']")
      );
    });

  for (const [layout, shown] of [
    ["composer", "composer"],
    ["window", "window"],
    ["panel", "rail"],
    ["window", "window"],
    ["composer", "composer"],
  ] as const) {
    await setLayout(agent, layout);
    await expect(panel).toHaveAttribute("data-layout", shown);
    await expect(panel.locator("[data-role='assistant']")).toContainText("Three shapes: motion m1");
    await expect(panel.locator("[data-role='assistant']")).toBeVisible();
    await expect(tabs(page)).toHaveText(["What is on the board"]);
    await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");
    await expect(box).toHaveText("keep this draft");
    expect(await same()).toBe(true);
    // The side panel and the window keep the two-row tray, the model named on its picker; the floating composer shows its logo alone.
    const picker = panel.getByTestId("model-picker");
    if (shown === "composer") {
      await expect(picker).toHaveText("");
      await expect(picker).toHaveAccessibleName("Model: Scripted");
    } else {
      await expect(picker).toContainText("Scripted");
      await expect(picker).toHaveAccessibleName("Model");
    }
  }
});

test("the floating composer sits above the bottom toolbar, its conversation opens over the canvas from the Agent button or the composer, Escape closes it, and closed it leaves the canvas usable", async ({ page, agent }) => {
  await setLayout(agent, "composer");
  await openCanvas(page, agent);
  const composer = floatingComposer(page);
  await expect(composer).toBeVisible();
  await expect(conversation(page)).toHaveAttribute("data-state", "closed");
  await expect(conversation(page)).toBeHidden();
  await expect(rail(page)).not.toHaveAttribute("data-slot", "docked-rail");

  const toolbar = await boxOf(page.getByTestId("bottom-toolbar"));
  const shell = await boxOf(composer);
  expect(shell.y + shell.height).toBeLessThanOrEqual(toolbar.y - 8);
  await expectToolbarSpan(page, composer);
  // The canvas stays where it was: nothing docked, the toolbar and the zoom controls in place.
  expect((await page.locator(".tlui-navigation-panel").boundingBox())!.x).toBe(0);

  // Closed, the conversation's place belongs to the canvas.
  const viewport = page.viewportSize()!;
  expect(await hitAt(page, viewport.width / 2, viewport.height / 3)).toEqual({ canvas: true, chat: false });
  expect(await hitAt(page, viewport.width / 2, shell.y - 20)).toEqual({ canvas: true, chat: false });

  // Typing into the composer, then opening the conversation from it, keeps the draft and the keys going to it.
  const box = promptBox(composer);
  await box.click();
  await box.pressSequentially("draft");
  await composer.getByRole("button", { name: "Show conversation" }).click();
  await expect(conversation(page)).toHaveAttribute("data-state", "open");
  await expect(conversation(page)).toBeVisible();
  await expect(agentChromeButton(page)).toHaveAttribute("data-isactive", "true");
  await page.keyboard.type(" more");
  await expect(box).toHaveText("draft more");
  await expectToolbarSpan(page, conversation(page));
  const open = await boxOf(conversation(page));
  expect(open.y).toBeGreaterThanOrEqual(36);
  expect(open.y + open.height).toBeLessThanOrEqual((await boxOf(composer)).y);
  expect(await hitAt(page, viewport.width / 2, viewport.height / 3)).toEqual({ canvas: false, chat: true });

  // Escape from the composer closes the conversation and leaves the composer.
  await box.click();
  await page.keyboard.press("Escape");
  await expect(conversation(page)).toHaveAttribute("data-state", "closed");
  await expect(conversation(page)).toBeHidden();
  await expect(composer).toBeVisible();
  await expect(box).toHaveText("draft more");
  expect(await hitAt(page, viewport.width / 2, viewport.height / 3)).toEqual({ canvas: true, chat: false });

  // The Agent button toggles the conversation, never the composer.
  await agentChromeButton(page).click();
  await expect(conversation(page)).toHaveAttribute("data-state", "open");
  await say(composer, "what is on the board?");
  await expect(conversation(page).locator("[data-role='assistant']")).toContainText("Three shapes: motion m1");
  // Escape from inside the conversation too, and the next key still reaches the composer.
  await conversation(page).locator("[data-role='assistant']").click();
  await page.keyboard.press("Escape");
  await expect(conversation(page)).toHaveAttribute("data-state", "closed");
  await page.keyboard.type("next");
  await expect(box).toHaveText("next");
  await agentChromeButton(page).click();
  await expect(conversation(page)).toHaveAttribute("data-state", "open");
  await conversation(page).getByRole("button", { name: "Close" }).click();
  await expect(conversation(page)).toHaveAttribute("data-state", "closed");
  await composer.getByRole("button", { name: "Show conversation" }).click();
  await expect(conversation(page)).toHaveAttribute("data-state", "open");
  await composer.getByRole("button", { name: "Hide conversation" }).click();
  await expect(conversation(page)).toHaveAttribute("data-state", "closed");
  await expect(composer).toBeVisible();

  // With the conversation closed, a drag on the canvas where it was draws on the canvas.
  const before = await page.locator(".tl-shape").count();
  await page.keyboard.press("Escape");
  await page.locator(".tl-canvas").click({ position: { x: 10, y: 200 } });
  await page.keyboard.press("r");
  await drag(page, { x: viewport.width / 2 - 60, y: viewport.height / 3 - 40 }, 120, 80);
  await expect.poll(() => page.locator(".tl-shape").count()).toBe(before + 1);
});

test("on a narrow window the floating composer stays, and its conversation fits between the top bar and the composer", async ({ page, agent }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await setLayout(agent, "composer");
  await openCanvas(page, agent);
  const composer = floatingComposer(page);
  await expect(composer).toBeVisible();
  await agentChromeButton(page).click();
  await expect(conversation(page)).toHaveAttribute("data-state", "open");
  const open = await boxOf(conversation(page));
  const shell = await boxOf(composer);
  const toolbar = await boxOf(page.getByTestId("bottom-toolbar"));
  expect(open.x).toBeGreaterThanOrEqual(0);
  expect(open.x + open.width).toBeLessThanOrEqual(900);
  expect(open.y).toBeGreaterThanOrEqual(36);
  expect(open.y + open.height).toBeLessThanOrEqual(shell.y);
  expect(shell.y + shell.height).toBeLessThanOrEqual(toolbar.y - 8);
  await expectToolbarSpan(page, composer);
  await expectToolbarSpan(page, conversation(page));

  // Narrower than the toolbar's room, the column keeps 8 px inside the window.
  await page.setViewportSize({ width: 420, height: 640 });
  await expect.poll(async () => Math.round((await boxOf(composer)).x)).toBeGreaterThanOrEqual(8);
  await expectToolbarSpan(page, composer);
  await expectToolbarSpan(page, conversation(page));
  const capped = await boxOf(composer);
  expect(capped.x + capped.width).toBeLessThanOrEqual(420 - 8);
  expect((await boxOf(conversation(page))).y + (await boxOf(conversation(page))).height).toBeLessThanOrEqual(capped.y);
});

test("at 1024 px the floating composer is one row about the bottom toolbar's height and as wide, on its centre, with icon controls, a one-line placeholder, upward growth for more lines, and its conversation the same width", async ({ page, agent }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await setLayout(agent, "composer");
  await openCanvas(page, agent);
  const composer = floatingComposer(page);
  await expect(composer).toBeVisible();
  await expectToolbarSpan(page, composer);
  const toolbar = await boxOf(page.getByTestId("bottom-toolbar"));
  const shell = await boxOf(composer);
  expect(Math.abs(shell.x + shell.width / 2 - (toolbar.x + toolbar.width / 2))).toBeLessThanOrEqual(2);
  expect(shell.y + shell.height).toBeLessThanOrEqual(toolbar.y - 8);
  expect(await placeholderFits(composer)).toBe(true);

  // Idle, it is one row: about the toolbar's height, with the controls and the prompt side by side.
  const shellBox = composer.getByTestId("agent-composer");
  const idle = await boxOf(shellBox);
  expect(Math.abs(idle.height - toolbar.height)).toBeLessThanOrEqual(8);
  const prompt = await boxOf(promptBox(composer));
  const attach = composer.getByRole("button", { name: "Attach files" });
  const picker = composer.getByTestId("model-picker");
  const send = composer.getByRole("button", { name: "Send" });
  const more = composer.locator("[data-composer-actions]").getByRole("button").first();
  for (const control of [composer.getByRole("button", { name: "Show conversation" }), attach, picker, more, send]) {
    const at = await boxOf(control);
    expect(at.y).toBeGreaterThanOrEqual(idle.y);
    expect(at.y + at.height).toBeLessThanOrEqual(idle.y + idle.height);
  }
  // The leading icon buttons share one box and one centre line with the prompt and the trailing more and send.
  const leading = await Promise.all([composer.getByRole("button", { name: "Show conversation" }), attach, picker].map(boxOf));
  for (const at of leading) {
    expect(at.width).toBeCloseTo(leading[0]!.width, 0);
    expect(at.height).toBeCloseTo(leading[0]!.height, 0);
  }
  const centre = leading[0]!.y + leading[0]!.height / 2;
  for (const at of [...leading, await boxOf(more), await boxOf(send), prompt]) expect(Math.abs(at.y + at.height / 2 - centre)).toBeLessThanOrEqual(1);
  expect((await boxOf(picker)).x + (await boxOf(picker)).width).toBeLessThanOrEqual(prompt.x);
  expect(prompt.x + prompt.width).toBeLessThanOrEqual((await boxOf(more)).x);
  expect((await boxOf(more)).x).toBeLessThan((await boxOf(send)).x);

  // Attach and the model are icon buttons; the model is named in its label and tooltip, and opens the same menu.
  await expect(attach).toHaveText("");
  expect(Math.round((await boxOf(attach)).width)).toBeLessThanOrEqual(32);
  await expect(picker).toHaveText("");
  await expect(picker).toHaveAccessibleName("Model: Scripted");
  expect(Math.round((await boxOf(picker)).width)).toBeLessThanOrEqual(32);
  await picker.hover();
  await expect(page.getByText("Model: Scripted", { exact: true })).toBeVisible();
  await picker.click();
  const models = page.getByRole("dialog", { name: "Models" });
  await expect(models).toBeVisible();
  await expect(models.getByRole("tablist", { name: "Providers" })).toBeVisible();
  await expect(models.getByTestId("model-name").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(models).toBeHidden();

  // More lines grow it upward from the same bottom, clear of the toolbar; cleared, it is one row again.
  const box = promptBox(composer);
  await box.click();
  await box.pressSequentially("first line");
  for (const line of ["second", "third", "fourth"]) {
    await box.press("Shift+Enter");
    await box.pressSequentially(line);
  }
  await expect.poll(async () => (await boxOf(shellBox)).height).toBeGreaterThan(idle.height + 48);
  const grown = await boxOf(shellBox);
  expect(Math.abs(grown.y + grown.height - (idle.y + idle.height))).toBeLessThanOrEqual(1);
  expect(grown.y + grown.height).toBeLessThanOrEqual(toolbar.y - 8);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await expect(box).toHaveText("");
  await expect.poll(async () => Math.round((await boxOf(shellBox)).height)).toBe(Math.round(idle.height));
  // One long line stays one row too.
  await box.pressSequentially("a single line that is long enough to run past the width of the composer and keep on going well beyond its edge");
  await expect.poll(async () => Math.round((await boxOf(shellBox)).height)).toBe(Math.round(idle.height));
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");

  await composer.getByRole("button", { name: "Show conversation" }).click();
  await expect(conversation(page)).toHaveAttribute("data-state", "open");
  await conversation(page).evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  await expectToolbarSpan(page, conversation(page));
  expect((await boxOf(conversation(page))).y + (await boxOf(conversation(page))).height).toBeLessThanOrEqual((await boxOf(composer)).y);
});

test("on a narrow window the floating window is the left Sheet, as the side panel is", async ({ page, agent }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await setLayout(agent, "window");
  await openCanvas(page, agent);
  await agentChromeButton(page).click();
  const sheet = page.locator("[data-slot='sheet-popup']");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("complementary", { name: "Agent" })).toBeVisible();
  await expect(sheet.getByRole("complementary", { name: "Agent" })).not.toHaveAttribute("data-layout");
});

test("the floating window opens from the Agent button below the top bar, moves by its header, resizes from its edges within limits, stays on screen, and comes back where it was left", async ({ page, agent }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setLayout(agent, "window");
  await openCanvas(page, agent);
  await agentChromeButton(page).click();
  const chat = rail(page);
  await expect(chat).toHaveAttribute("data-layout", "window");
  await expect(chat).toHaveAttribute("data-state", "open");
  await expect(chat).not.toHaveAttribute("data-slot", "docked-rail");
  await expect(agentChromeButton(page)).toHaveAttribute("data-isactive", "true");
  // Nothing docked: the canvas keeps its bottom row.
  expect((await page.locator(".tlui-navigation-panel").boundingBox())!.x).toBe(0);
  const settled = () => chat.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  await settled();
  const first = await boxOf(chat);
  expect(first.x).toBeGreaterThanOrEqual(8);
  expect(first.y).toBeGreaterThanOrEqual(36 + 8);
  expect(Math.round(first.width)).toBe(400);
  expect(Math.round(first.height)).toBe(560);

  // The transcript and the composer are no handles: a drag there leaves the window in place.
  const transcript = await boxOf(chat.getByTestId("transcript"));
  await drag(page, { x: transcript.x + transcript.width / 2, y: transcript.y + transcript.height / 2 }, 100, 50);
  expect(await boxOf(chat)).toEqual(first);

  const header = await boxOf(chat.locator("header").first());
  await drag(page, { x: header.x + 120, y: header.y + header.height / 2 }, 300, 120);
  await expect.poll(async () => Math.round((await boxOf(chat)).x)).toBe(Math.round(first.x) + 300);
  expect(Math.round((await boxOf(chat)).y)).toBe(Math.round(first.y) + 120);

  // Dragged off the screen, it stays 8 px inside it and below the top bar.
  const moved = await boxOf(chat.locator("header").first());
  await drag(page, { x: moved.x + 120, y: moved.y + moved.height / 2 }, -3000, -3000);
  await expect.poll(async () => Math.round((await boxOf(chat)).x)).toBe(8);
  expect(Math.round((await boxOf(chat)).y)).toBe(36 + 8);

  // The bottom-right corner resizes it; it never shrinks under its minimum.
  const corner = chat.locator("[data-panel-edge='se']");
  const cornerBox = await boxOf(corner);
  await drag(page, { x: cornerBox.x + cornerBox.width / 2, y: cornerBox.y + cornerBox.height / 2 }, 100, -60);
  await expect.poll(async () => Math.round((await boxOf(chat)).width)).toBe(500);
  expect(Math.round((await boxOf(chat)).height)).toBe(500);
  const smaller = await boxOf(corner);
  await drag(page, { x: smaller.x + smaller.width / 2, y: smaller.y + smaller.height / 2 }, -1000, -1000);
  await expect.poll(async () => Math.round((await boxOf(chat)).width)).toBe(320);
  expect(Math.round((await boxOf(chat)).height)).toBe(320);
  const larger = await boxOf(corner);
  await drag(page, { x: larger.x + larger.width / 2, y: larger.y + larger.height / 2 }, 180, 240);
  await expect.poll(async () => Math.round((await boxOf(chat)).width)).toBe(500);
  const kept = await boxOf(chat);
  await expect
    .poll(async () => (await (await rpcOf(agent)).call("preferences.get", { keys: ["agent.chatWindow"] })).values["agent.chatWindow"])
    .toEqual({ mode: "float", x: Math.round(kept.x), y: Math.round(kept.y), w: 500, h: 560 });

  // Escape from inside closes it; the Agent button brings it back where it was.
  await promptBox(chat).click();
  await page.keyboard.press("Escape");
  await expect(chat).toHaveCount(0);
  await expect(agentChromeButton(page)).not.toHaveAttribute("data-isactive", "true");
  await agentChromeButton(page).click();
  await settled();
  expect(await boxOf(rail(page))).toEqual(kept);
  // The Agent button closes it too.
  await agentChromeButton(page).click();
  await expect(rail(page)).toHaveCount(0);

  await page.reload();
  await openCanvas(page, agent);
  await agentChromeButton(page).click();
  await expect(rail(page)).toHaveAttribute("data-state", "open");
  await rail(page).evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  expect(await boxOf(rail(page))).toEqual(kept);
});

test("the floating window and a floating Parameters panel sit on the canvas together, each moving on its own", async ({ page, agent }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setLayout(agent, "window");
  await (await rpcOf(agent)).call("preferences.set", { key: "agent.chatWindow", value: { mode: "float", x: 980, y: 60, w: 400, h: 500 } });
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [10, 0, 100, 1], accent: "#a78bfa" }) });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();

  await agentChromeButton(page).click();
  const chat = rail(page);
  await expect(chat).toHaveAttribute("data-state", "open");
  await clickShape(page, "shape:tuned");
  await page.getByTestId("selection-toolbar").getByRole("button", { name: "Parameters" }).click();
  const parameters = page.getByRole("region", { name: "Parameters for Tuned" });
  await expect(parameters).toBeVisible();
  await expect(parameters).toHaveAttribute("data-shown", "float");
  await expect(chat).toBeVisible();
  await chat.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  await parameters.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const parametersAt = await boxOf(parameters);
  const chatAt = await boxOf(chat);
  expect(Math.round(chatAt.x)).toBe(980);

  const header = await boxOf(chat.locator("header").first());
  await drag(page, { x: header.x + 120, y: header.y + header.height / 2 }, -100, 40);
  await expect.poll(async () => Math.round((await boxOf(chat)).x)).toBe(880);
  expect(await boxOf(parameters)).toEqual(parametersAt);
  await expect(parameters).toBeVisible();

  const parametersHeader = await boxOf(parameters.locator("header"));
  await drag(page, { x: parametersHeader.x + 150, y: parametersHeader.y + parametersHeader.height / 2 }, 0, 120);
  await expect.poll(async () => Math.round((await boxOf(parameters)).y)).toBe(Math.round(parametersAt.y) + 120);
  expect(Math.round((await boxOf(chat)).x)).toBe(880);
  await expect(chat).toBeVisible();
});
