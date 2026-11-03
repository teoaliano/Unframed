/**
 * The engine-owned headless Chrome (spec 09) that snapshots and the agent's previews use:
 * the Chromium the Chrome finder found, launched on first need and closed after five
 * minutes without work. It only ever loads the preview origin.
 *
 * It must never outlive the engine. It talks to the engine over a pipe, so it exits when the
 * engine does, even after a SIGKILL; its profile is one the engine owns and deletes; a
 * reaper process deletes it when the engine dies before it can; and the engine's `exit`
 * kills it outright.
 */
import type { ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Browser } from "puppeteer-core";
import { killGroup, spawnReaper } from "../lifeline.ts";
import { errorText, logError } from "../log.ts";
import { makeChromeProfile } from "./chromeProfiles.ts";

/** How long the browser stays up with nothing to do. */
const IDLE_MS = 5 * 60_000;
/**
 * How long Chrome gets to close by itself before it is killed. A clean close can take seconds
 * on a busy machine, past the shutdown budget, and nothing in the throwaway profile is worth it.
 */
const CLOSE_GRACE_MS = 300;
/** How long a killed Chrome gets to exit before its profile is deleted anyway. */
const KILL_WAIT_MS = 500;
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 } as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

export class HeadlessChrome {
  private browser: Promise<Browser | undefined> | undefined;
  private busy = 0;
  /** Held open by something that outlives one piece of work (a chat's preview tab). */
  private readonly holds = new Set<string>();
  private idle: ReturnType<typeof setTimeout> | undefined;
  private readonly find: () => Promise<string | undefined>;
  /** Ends what the running browser leaves behind: its process, its profile, its reaper. */
  private teardown: (() => Promise<void>) | undefined;

  constructor(find: () => Promise<string | undefined>) {
    this.find = find;
  }

  private launch(): Promise<Browser | undefined> {
    this.browser ??= (async () => {
      const executablePath = await this.find();
      if (executablePath === undefined) return undefined;
      const puppeteer = await import("puppeteer-core");
      const profile = await makeChromeProfile();
      // Both are in place before Chrome starts, so an engine that dies mid-launch leaves nothing either.
      const reaper = spawnReaper({ matching: [`--user-data-dir=${profile}`], paths: [profile] });
      let child: ChildProcess | null = null;
      const running = () => child?.pid !== undefined && child.exitCode === null && child.signalCode === null;
      const onExit = () => {
        // While launching, puppeteer's own exit hook kills Chrome.
        if (running()) killGroup(child!.pid!);
        try {
          rmSync(profile, RM_OPTIONS);
        } catch {
          // exiting anyway; the reaper or the next engine's sweep gets it
        }
      };
      process.on("exit", onExit);
      let browser: Browser;
      try {
        browser = await puppeteer.launch({
          executablePath,
          headless: true,
          pipe: true,
          userDataDir: profile,
          // main.ts owns the signals: puppeteer's SIGINT handler would exit before the shutdown hooks run.
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false,
          args: [
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--mute-audio",
            "--hide-scrollbars",
            // Chrome on a Mac otherwise copies its whole app into the temp folder on every launch.
            "--disable-features=MacAppCodeSignClone",
          ],
        });
      } catch (error) {
        process.off("exit", onExit);
        await rm(profile, RM_OPTIONS).catch(() => undefined);
        reaper?.dismiss();
        throw error;
      }
      child = browser.process();
      const exited = new Promise<void>((resolve) => (running() ? child!.once("exit", () => resolve()) : resolve()));
      let done: Promise<void> | undefined;
      const teardown = () =>
        (done ??= (async () => {
          process.off("exit", onExit);
          if (running()) killGroup(child!.pid!);
          await Promise.race([exited, sleep(KILL_WAIT_MS)]);
          await rm(profile, RM_OPTIONS).catch(() => undefined);
          reaper?.dismiss();
          if (this.teardown === teardown) this.teardown = undefined;
        })());
      this.teardown = teardown;
      browser.on("disconnected", () => {
        this.browser = undefined;
        void teardown();
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
    if (browser !== undefined) await Promise.race([browser.close().catch(() => undefined), sleep(CLOSE_GRACE_MS)]);
    await this.teardown?.();
  }
}
