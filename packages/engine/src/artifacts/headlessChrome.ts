/**
 * The engine-owned headless Chrome (spec 09) that snapshots and the agent's previews use:
 * the Chromium the Chrome finder found, launched on first need and closed after five
 * minutes without work. It only ever loads the preview origin.
 */
import type { Browser } from "puppeteer-core";
import { errorText, logError } from "../log.ts";

/** How long the browser stays up with nothing to do. */
const IDLE_MS = 5 * 60_000;

export class HeadlessChrome {
  private browser: Promise<Browser | undefined> | undefined;
  private busy = 0;
  /** Held open by something that outlives one piece of work (a chat's preview tab). */
  private readonly holds = new Set<string>();
  private idle: ReturnType<typeof setTimeout> | undefined;
  private readonly find: () => Promise<string | undefined>;

  constructor(find: () => Promise<string | undefined>) {
    this.find = find;
  }

  private launch(): Promise<Browser | undefined> {
    this.browser ??= (async () => {
      const executablePath = await this.find();
      if (executablePath === undefined) return undefined;
      const puppeteer = await import("puppeteer-core");
      const browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: ["--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", "--hide-scrollbars"],
      });
      browser.on("disconnected", () => {
        this.browser = undefined;
      });
      return browser;
    })().catch((error: unknown) => {
      logError(`could not start the headless Chrome: ${errorText(error)}`);
      this.browser = undefined;
      return undefined;
    });
    return this.browser;
  }

  private settle(): void {
    clearTimeout(this.idle);
    if (this.busy > 0 || this.holds.size > 0) return;
    this.idle = setTimeout(() => void this.close(), IDLE_MS);
    this.idle.unref();
  }

  /** Runs `work` with the browser; answers `undefined` without running it when this machine has no Chromium. */
  async use<T>(work: (browser: Browser) => Promise<T>): Promise<T | undefined> {
    this.busy++;
    clearTimeout(this.idle);
    try {
      const browser = await this.launch();
      return browser === undefined ? undefined : await work(browser);
    } finally {
      this.busy--;
      this.settle();
    }
  }

  /** Keeps the browser up while `key` holds it, whatever the idle timer says. */
  hold(key: string): void {
    this.holds.add(key);
    clearTimeout(this.idle);
  }

  release(key: string): void {
    this.holds.delete(key);
    this.settle();
  }

  async close(): Promise<void> {
    clearTimeout(this.idle);
    const browser = await this.browser?.catch(() => undefined);
    this.browser = undefined;
    await browser?.close().catch(() => undefined);
  }
}
