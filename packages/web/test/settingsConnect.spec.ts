import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "../../engine/test/engineProcess.ts";
import { CONNECTED_KEY, liveKey } from "../../engine/test/oauthStub.ts";
import { gate } from "../../engine/test/openRouterStub.ts";
import { toast } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { IMAGE_MODELS, openApp, settingsButton, settingsDialog, startSettingsEngine } from "./settings.ts";

/** Holds every exchange at the stub until released. */
const holdExchanges = (oauth: Awaited<ReturnType<typeof startSettingsEngine>>["oauth"]) => {
  const held = gate<void>();
  oauth.exchange(async () => {
    await held.promise;
    return { kind: "key", key: CONNECTED_KEY };
  });
  return held.release;
};

test("Connect opens a tab on the consent page that redirects to the engine; the dialog waits, then toasts and closes", async ({ page }) => {
  const { engine, oauth } = await startSettingsEngine({ key: false });
  try {
    const release = holdExchanges(oauth);
    await openApp(page, engine);
    const dialog = settingsDialog(page);
    const popup = page.waitForEvent("popup");
    await dialog.getByRole("button", { name: "Connect OpenRouter" }).click();
    const tab = await popup;

    const waiting = dialog.getByTestId("settings-waiting");
    await expect(waiting.getByText("Waiting for OpenRouter in your browser…")).toBeVisible();
    await expect(waiting).toContainText("Didn't open? Approve Unframed at OpenRouter.");
    const approve = waiting.getByRole("link", { name: "Approve Unframed at OpenRouter" });
    expect(new URL((await approve.getAttribute("href"))!).origin).toBe(engine.stub!.origin);
    await expect(waiting.getByRole("button", { name: "Cancel" })).toBeVisible();
    // The intro and its Connect give way to the waiting block.
    await expect(dialog.getByRole("button", { name: "Connect OpenRouter" })).toHaveCount(0);
    await expect.poll(() => oauth.approvals.length).toBe(1);

    release();
    await expect(tab.locator("h1")).toHaveText("Connected to OpenRouter");
    // The tab was severed from the app before it went anywhere.
    expect(await tab.evaluate(() => window.opener === null)).toBe(true);
    await expect(toast(page, "Connected to OpenRouter.")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(settingsButton(page)).toHaveAccessibleName("Settings");
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe(`OPENROUTER_API_KEY=${CONNECTED_KEY}\n`);
  } finally {
    await engine.dispose();
  }
});

test("a free-tier account keeps the dialog open with the Credits line and the loaded catalogues", async ({ page }) => {
  const { engine, oauth } = await startSettingsEngine({ key: false });
  try {
    oauth.keyStatus(() => liveKey({ is_free_tier: true, usage: 0, limit: null, limit_remaining: null }));
    await openApp(page, engine);
    const dialog = settingsDialog(page);
    await dialog.getByRole("button", { name: "Connect OpenRouter" }).click();
    await expect(toast(page, "Connected to OpenRouter.")).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(dialog.getByTestId("key-status")).toHaveText("You have not bought any credit yet, so generating will fail. Add some under Credits.");
    await expect(dialog.getByRole("link", { name: "Credits" })).toHaveAttribute("href", "https://openrouter.ai/credits");
    await dialog.getByRole("combobox", { name: "Image" }).click();
    const options = page.getByRole("option");
    await expect(options).toHaveCount(IMAGE_MODELS.length);
    expect((await options.allTextContents()).sort()).toEqual([...IMAGE_MODELS].sort());
  } finally {
    await engine.dispose();
  }
});

test("a refused exchange shows its reason in the banner, and a new Connect clears it", async ({ page }) => {
  const { engine, oauth } = await startSettingsEngine({ key: false });
  try {
    oauth.exchange(() => ({ kind: "status", status: 403, body: { error: { message: "This code was already used" } } }));
    await openApp(page, engine);
    const dialog = settingsDialog(page);
    await dialog.getByRole("button", { name: "Connect OpenRouter" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("This code was already used");
    await expect(dialog.getByRole("button", { name: "Connect OpenRouter" })).toBeVisible();

    holdExchanges(oauth);
    await dialog.getByRole("button", { name: "Connect OpenRouter" }).click();
    await expect(dialog.getByTestId("settings-waiting")).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  } finally {
    await engine.dispose();
  }
});

test("a refused exchange with the dialog closed is a toast", async ({ page }) => {
  const { engine, oauth } = await startSettingsEngine({ key: false });
  try {
    const held = gate<void>();
    oauth.exchange(async () => {
      await held.promise;
      return { kind: "status", status: 403, body: { error: { message: "Invalid code or code_verifier" } } };
    });
    await openApp(page, engine);
    const dialog = settingsDialog(page);
    await dialog.getByRole("button", { name: "Connect OpenRouter" }).click();
    await expect(dialog.getByTestId("settings-waiting")).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    held.release();
    await expect(toast(page, "Invalid code or code_verifier")).toBeVisible();
    await settingsButton(page).click();
    await expect(dialog.getByRole("button", { name: "Connect OpenRouter" })).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  } finally {
    await engine.dispose();
  }
});

test("Cancel returns to the Connect state, and a Connect straight after still completes", async ({ page }) => {
  const { engine, oauth } = await startSettingsEngine({ key: false });
  try {
    const release = holdExchanges(oauth);
    await openApp(page, engine);
    const dialog = settingsDialog(page);
    await dialog.getByRole("button", { name: "Connect OpenRouter" }).click();
    await expect(dialog.getByTestId("settings-waiting")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog.getByTestId("settings-waiting")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Connect OpenRouter" })).toBeVisible();
    oauth.exchange(() => ({ kind: "key", key: CONNECTED_KEY }));
    await dialog.getByRole("button", { name: "Connect OpenRouter" }).click();
    await expect(toast(page, "Connected to OpenRouter.")).toBeVisible();
    await expect(dialog).toBeHidden();
    // The first attempt's callback, released late, was refused.
    release();
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe(`OPENROUTER_API_KEY=${CONNECTED_KEY}\n`);
  } finally {
    await engine.dispose();
  }
});

test("the poll gives up after ten minutes", async ({ page }) => {
  const { engine, oauth } = await startSettingsEngine({ key: false });
  try {
    holdExchanges(oauth);
    await openApp(page, engine);
    const dialog = settingsDialog(page);
    const popup = page.waitForEvent("popup");
    await dialog.getByRole("button", { name: "Connect OpenRouter" }).click();
    await expect(dialog.getByTestId("settings-waiting")).toBeVisible();
    // The clock is set for every page of the context, and the tab is still loading the held callback.
    await (await popup).close();
    // Timers keep their pace; only the wall clock the poll reads jumps past ten minutes.
    await page.clock.setFixedTime(Date.now() + 10 * 60_000 + 5_000);
    await expect(dialog.getByRole("alert")).toHaveText("Nothing came back from OpenRouter. Try connecting again.");
    await expect(dialog.getByTestId("settings-waiting")).toHaveCount(0);
  } finally {
    await engine.dispose();
  }
});

test("the poll reports a lost connection when the engine restarts mid-wait", async ({ page }) => {
  const dataDir = await makeTempDir();
  const first = await startSettingsEngine({ key: false, dataDir });
  try {
    holdExchanges(first.oauth);
    await openApp(page, first.engine);
    const dialog = settingsDialog(page);
    await dialog.getByRole("button", { name: "Connect OpenRouter" }).click();
    await expect(dialog.getByTestId("settings-waiting")).toBeVisible();
    const port = first.engine.port;
    await first.engine.stop();
    const second = await startSettingsEngine({ key: false, dataDir, env: { PORT: String(port) } });
    try {
      await expect(dialog.getByRole("alert")).toHaveText("That connection was lost before it finished. Try connecting again.", { timeout: 20_000 });
      await expect(dialog.getByRole("button", { name: "Connect OpenRouter" })).toBeVisible();
    } finally {
      await second.engine.dispose();
    }
  } finally {
    await first.engine.dispose();
    await rm(dataDir, { recursive: true, force: true });
  }
});
