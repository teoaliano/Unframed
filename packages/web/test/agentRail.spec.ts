import type { Locator } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { agentChromeButton, createChat, expect, openRail, rail, tabs, test } from "./agent.ts";
import { expectSlot, expectToken, inBothSchemes, resolvedColor, styleOf, tokenColor } from "./kit.ts";

const MENU_GLASS = "color-mix(in srgb, var(--popover) 18%, color-mix(in srgb, var(--popover) var(--glass-opacity), transparent))";

const computed = (locator: Locator, ...names: string[]) =>
  locator.evaluate((element, names) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]));
  }, names);

/** The transitions running on the rail right after it mounts: which properties move. */
const transitionsOnOpen = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const found = () => document.querySelector<HTMLElement>("aside[aria-label='Agent']");
        const read = (element: HTMLElement) =>
          requestAnimationFrame(() => resolve(element.getAnimations().map((animation) => (animation as CSSTransition).transitionProperty).sort()));
        const observer = new MutationObserver(() => {
          const element = found();
          if (!element) return;
          observer.disconnect();
          read(element);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        document.querySelector<HTMLElement>(".unframed-chrome-right button[aria-label='Agent']")!.click();
      }),
  );

test("the Agent button slides the rail in, the top-right card steps aside, and Close slides it out and removes it", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const card = page.locator(".unframed-chrome-right");
  await expect(agentChromeButton(page)).toBeVisible();

  expect(await transitionsOnOpen(page)).toEqual(["opacity", "transform"]);
  const panel = rail(page);
  await expect(panel).toHaveAttribute("data-state", "open");
  expect(await computed(panel, "width", "transition-property", "transition-duration", "transition-timing-function")).toEqual({
    width: "380px",
    "transition-property": "transform, opacity",
    "transition-duration": "0.26s, 0.2s",
    "transition-timing-function": "cubic-bezier(0.32, 0.72, 0, 1), ease-out",
  });
  await expect.poll(async () => (await computed(panel, "transform", "opacity")).opacity).toBe("1");
  expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain((await computed(panel, "transform")).transform);
  const box = (await panel.boundingBox())!;
  expect(box.x + box.width).toBeCloseTo(page.viewportSize()!.width, 0);
  expect(box.y).toBe(0);

  // The top-right card fades out, drifts right and takes no input while the rail is open.
  await expect(card).toHaveAttribute("inert", "");
  expect(await computed(card, "transition-duration")).toEqual({ "transition-duration": "0.16s, 0.2s" });
  await expect.poll(async () => (await computed(card, "opacity")).opacity).toBe("0");
  expect((await computed(card, "transform")).transform).toBe("matrix(1, 0, 0, 1, 8, 0)");

  // Close runs the faster exit, then the rail leaves the page.
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveAttribute("data-state", "closed");
  expect(await computed(panel, "transition-duration")).toEqual({ "transition-duration": "0.2s, 0.16s" });
  await expect(panel).toHaveCount(0);
  await expect(card).not.toHaveAttribute("inert");
  await expect.poll(async () => (await computed(card, "opacity")).opacity).toBe("1");

  // Reopened, it comes back at rest.
  await openRail(page);
});

test("with reduced motion the rail only fades, and still leaves the page on Close", async ({ page, agent }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openCanvas(page, agent);
  expect(await transitionsOnOpen(page)).toEqual(["opacity"]);
  const panel = rail(page);
  expect(await computed(panel, "transform", "transition-property", "transition-duration")).toEqual({
    transform: "none",
    "transition-property": "opacity",
    "transition-duration": "0.16s",
  });
  await expect.poll(async () => (await computed(panel, "opacity")).opacity).toBe("1");
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveAttribute("data-state", "closed");
  expect((await computed(panel, "transform")).transform).toBe("none");
  await expect(panel).toHaveCount(0);
});

test("the rail is t3code's chat panel on the kit: a shell on --background with a left border, kit header buttons, panel tabs, a kit More menu and search field", async ({ page, agent }) => {
  await openCanvas(page, agent);
  for (const [index, title] of ["First", "Second", "Third", "Fourth"].entries()) await createChat(agent, { title, createdAt: `2026-09-0${index + 1}T10:00:00.000Z` });
  const panel = await openRail(page);
  await expect(tabs(page)).toHaveText(["Fourth", "Third", "Second"]);
  await inBothSchemes(page, async () => {
    await page.mouse.move(10, 400);
    // Solid --background, not glass: spec 12's budget decides, and the glass rail crossed spec 02's pan budget.
    await expectToken(panel, "background-color", "--background");
    await expectToken(panel, "border-left-color", "--color-border");
    await expect(panel.getByRole("heading", { name: "Agent" })).toBeVisible();
    for (const name of ["Search chats", "New chat", "Delete chat", "Close"]) await expectSlot(panel.getByRole("button", { name, exact: true }), "tooltip-trigger");

    // Panel tabs: 24 px rows, the active one on the accent in the foreground, the rest muted.
    const [active, other] = [tabs(page).first(), tabs(page).nth(1)];
    expect((await active.boundingBox())!.height).toBe(24);
    await expectToken(active, "background-color", "--accent");
    await expectToken(active, "color", "--color-foreground");
    await expectToken(other, "color", "--color-muted-foreground");

    const more = panel.getByRole("button", { name: "More chats" });
    await expectSlot(more, "menu-trigger");
    await more.click();
    const popup = page.locator("[data-slot='menu-popup']");
    await expect(popup).toBeVisible();
    expect(await styleOf(popup, "background-color")).toBe(await resolvedColor(page, MENU_GLASS));
    await expectSlot(popup.getByRole("menuitem", { name: "First" }), "menu-item");
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);

    await panel.getByRole("button", { name: "Search chats" }).click();
    const field = panel.getByRole("textbox", { name: "Search chats" });
    await expectSlot(field, "input");
    await field.press("Escape");
    await expect(field).toHaveCount(0);
  });
});
