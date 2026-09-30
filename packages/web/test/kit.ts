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

/** A token's colour as `rgb(r, g, b)`, drawn through a canvas: what an sRGB colour set from it computes to. */
export const tokenRgb = (page: Page, token: string): Promise<string> =>
  page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const context = new OffscreenCanvas(1, 1).getContext("2d")!;
    context.fillStyle = getComputedStyle(probe).color;
    probe.remove();
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  }, token);

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

/**
 * The controls on screen that no kit component rendered: every visible button, menu item,
 * field and dialog must carry a kit `data-slot`. tldraw's own UI is themed, not rebuilt,
 * so it is left out, and so are spec 12's native exceptions (the hidden file picker and
 * the video scrubber). Answers a short description of each offender.
 */
export const unkittedControls = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const CONTROLS =
      "button, [role=button], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=combobox], input, textarea, select, [role=dialog], [role=alertdialog]";
    const TLDRAW = ".tlui-layout, .tlui-menu, .tlui-popover__content, .tlui-dialog__content, .tlui-button, [data-radix-popper-content-wrapper], [data-testid^='tl-watermark']";
    const offenders: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(CONTROLS)) {
      if (element.closest(TLDRAW)) continue;
      if (element instanceof HTMLInputElement && ["hidden", "file", "range"].includes(element.type)) continue;
      // Base UI's form inputs behind a Select or Combobox are hidden from people and assistive tech.
      if (element instanceof HTMLInputElement && element.getAttribute("aria-hidden") === "true") continue;
      if (!element.checkVisibility({ visibilityProperty: true })) continue;
      // Tiptap's editable surface is the third-party editor the kit's composer recipe dresses.
      if (element.isContentEditable) continue;
      // Base UI's toast root carries no slot of its own; the kit's toast viewport around it does.
      if (element.closest("[data-slot='toast-viewport'], [data-slot='toast-viewport-anchored']") && !element.matches("button")) continue;
      // The diff panel is t3code's diff panel shell (spec 12), a feature surface with a dialog role, not the kit Dialog.
      if (element.matches("[data-testid='diff-panel']")) continue;
      if (element.hasAttribute("data-slot")) continue;
      const name = element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 40) ?? "";
      const attributes = [...element.attributes].map((attribute) => attribute.name).filter((attribute) => attribute !== "class" && attribute !== "style");
      offenders.push(`<${element.tagName.toLowerCase()} ${attributes.join(" ")}> ${name}`);
    }
    return offenders;
  });
