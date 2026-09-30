import type { Page } from "@playwright/test";

/**
 * The platform the page runs on, read the way the app reads it (`src/canvas/platform.ts`),
 * and the labels that depend on it. Tests derive every modifier label and reveal label from
 * here: the suite runs on macOS locally and on Linux in CI, and each must see its own. Keys
 * are pressed with Playwright's `ControlOrMeta`, never a hard-coded Meta or Control.
 */
export interface Platform {
  readonly name: "darwin" | "win32" | "linux";
  readonly mac: boolean;
  /** A menu shortcut hint as tldraw and the context menu print it: `⌘X`, `⇧⌘G`, `Ctrl+X`, `Ctrl+⇧G`. */
  readonly shortcut: (key: string, options?: { shift?: boolean }) => string;
  /** The context menu's reveal item: `Reveal in Finder`, `Show in Explorer` or `Show in file manager`, with ` (n)` past one file. */
  readonly reveal: (count?: number) => string;
  /** How the no-provider copy names the machine. */
  readonly machine: string;
}

export const platformOf = async (page: Page): Promise<Platform> => {
  const name = await page.evaluate(() => {
    const reported = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
    if (/mac/i.test(reported)) return "darwin" as const;
    if (/win/i.test(reported)) return "win32" as const;
    return "linux" as const;
  });
  const mac = name === "darwin";
  const revealLabel = mac ? "Reveal in Finder" : name === "win32" ? "Show in Explorer" : "Show in file manager";
  return {
    name,
    mac,
    shortcut: (key, { shift = false } = {}) => (mac ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "⇧" : ""}${key}`),
    reveal: (count = 1) => (count > 1 ? `${revealLabel} (${count})` : revealLabel),
    machine: mac ? "Mac" : "computer",
  };
};
