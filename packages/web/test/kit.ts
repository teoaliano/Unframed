import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures.ts";

/**
 * Spec 12's design contract at the browser seam: which kit component rendered a control
 * (its `data-slot`), and what a token resolves to in the scheme on screen.
 */

/** The colour a CSS colour expression resolves to on this page, written the way getComputedStyle writes it. */
export const resolvedColor = (page: Page, expression: string): Promise<string> =>
  page.evaluate((value) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = value;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
  }, expression);

/** The colour a token such as `--primary` resolves to in the scheme on screen. */
export const tokenColor = (page: Page, token: string): Promise<string> => resolvedColor(page, `var(${token})`);

/** One computed style property of the element. */
export const styleOf = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

/** Asserts the element is the kit component with this `data-slot`. */
export const expectSlot = (locator: Locator, slot: string) => expect(locator).toHaveAttribute("data-slot", slot);

/** Asserts a style property equals what the token resolves to, polling while a theme switch lands. */
export const expectToken = async (locator: Locator, property: string, token: string) => {
  const page = locator.page();
  await expect
    .poll(async () => {
      const [actual, expected] = [await styleOf(locator, property), await tokenColor(page, token)];
      return actual === expected ? "match" : `${property} ${actual}, ${token} ${expected}`;
    })
    .toBe("match");
};

/** Runs the check in light, then in dark, then leaves the page in light. */
export const inBothSchemes = async (page: Page, check: (scheme: "light" | "dark") => Promise<void>) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator("html")).toHaveAttribute("data-unframed-theme", scheme);
    await check(scheme);
  }
  await page.emulateMedia({ colorScheme: "light" });
};
