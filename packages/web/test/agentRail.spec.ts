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
        document.querySelector<HTMLElement>("[data-testid='bottom-toolbar'] button[aria-label='Agent']")!.click();
      }),
  );

test("the Agent button slides the rail in from the left, the top-left card becomes its top row, and Close slides it out and removes it", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const card = page.locator(".unframed-chrome-left");
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
  // Opacity can reach 1 a frame before the slide's last fraction of a pixel.
  await expect.poll(async () => ["none", "matrix(1, 0, 0, 1, 0, 0)"].includes((await computed(panel, "transform")).transform ?? "")).toBe(true);
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeCloseTo(0, 0);
  expect(box.y).toBe(0);

  // The top-left card becomes the rail's top row: no frame of its own, still usable, over
  // the rail's chrome row, with the Agent header below it.
  await expect(card).toHaveAttribute("data-docked", "");
  await expect(card).not.toHaveAttribute("inert");
  expect(await computed(card, "background-color", "border-top-color")).toEqual({ "background-color": "rgba(0, 0, 0, 0)", "border-top-color": "rgba(0, 0, 0, 0)" });
  const cardBox = (await card.boundingBox())!;
  const row = (await panel.getByTestId("rail-chrome-row").boundingBox())!;
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(row.y + row.height);
  expect((await panel.getByRole("heading", { name: "Agent" }).boundingBox())!.y).toBeGreaterThanOrEqual(row.y + row.height);
  await expect(card.getByRole("button", { name: /^(Settings|Add your API key)$/ })).toBeVisible();

  // Close runs the faster exit, then the rail leaves the page.
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveAttribute("data-state", "closed");
  expect(await computed(panel, "transition-duration")).toEqual({ "transition-duration": "0.2s, 0.16s" });
  await expect(panel).toHaveCount(0);
  await expect(card).not.toHaveAttribute("data-docked");

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
    for (const name of ["Search chats", "New chat", "Delete chat", "Clear all chats", "Close"]) await expectSlot(panel.getByRole("button", { name, exact: true }), "tooltip-trigger");

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

test.describe("on a window of 980 px or less", () => {
  test.use({ viewport: { width: 900, height: 760 } });

  test("the rail opens as the kit Sheet from the left, over a backdrop, and Close or Escape closes it", async ({ page, agent }) => {
    await openCanvas(page, agent);
    await agentChromeButton(page).click();
    const sheet = page.locator("[data-slot='sheet-popup']");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("complementary", { name: "Agent" })).toBeVisible();
    await expect(page.locator("[data-slot='sheet-backdrop']")).toBeVisible();
    // Once it has slid in, it meets the left edge.
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.x)).toBe(0);
    expect((await sheet.boundingBox())!.width).toBeLessThanOrEqual(384);
    // Docked, the top-left card joins the rail; under the Sheet it stays as it is.
    await expect(page.locator(".unframed-chrome-left")).not.toHaveAttribute("data-docked", /.*/);

    // Escape in one of the rail's own menus closes that menu, not the Sheet.
    await sheet.getByRole("button", { name: "More composer controls" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(sheet).toBeVisible();

    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toHaveCount(0);
    await agentChromeButton(page).click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });
});
