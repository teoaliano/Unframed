import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { toast } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { expectSlot, expectToken } from "./kit.ts";
import { openApp, openSettings, settingsButton, settingsDialog, showSection, startSettingsEngine } from "./settings.ts";

const INTRO =
  "Unframed has no image model of its own. It sends your prompts to OpenRouter, which runs the model and bills your OpenRouter account per image (a few cents for most models). Connecting takes you there to approve Unframed; the key it gives back is saved on this machine and used only by your local server.";

test("a keyless first load opens nothing by itself; the gear opens Settings on Generation with the intro, Connect, and no Save until the paste field is revealed", async ({ page }) => {
  const { engine } = await startSettingsEngine({ key: false });
  try {
    await openApp(page, engine);
    await page.waitForTimeout(500);
    await expect(settingsDialog(page)).toHaveCount(0);
    const button = settingsButton(page);
    await expect(button).toHaveAccessibleName("Settings");
    await expect(button).not.toHaveAttribute("data-keyless");
    expect(await button.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    await button.hover();
    await expect(page.locator("[data-slot=tooltip-popup]")).toHaveText("Settings");

    const dialog = await openSettings(page);
    await expect(dialog.locator("[data-slot='dialog-title']")).toHaveText("Settings");
    await expect(dialog.getByRole("tab", { name: "Generation" })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByText(INTRO)).toBeVisible();
    await expect(dialog.getByRole("link", { name: "OpenRouter", exact: true })).toHaveAttribute("href", "https://openrouter.ai");
    await expect(dialog.getByRole("button", { name: "Connect OpenRouter" })).toBeVisible();
    await expectSlot(dialog, "dialog-popup");
    await expectSlot(dialog.getByRole("button", { name: "Connect OpenRouter" }), "button");
    await expectToken(dialog.getByRole("button", { name: "Connect OpenRouter" }), "background-color", "--primary");
    await expectSlot(dialog.getByRole("button", { name: "or paste a key instead" }), "button");
    await expect(dialog.getByTestId("models-need-key")).toHaveText("Connect OpenRouter to choose the models Generate starts on.");
    await expect(dialog.getByRole("combobox", { name: "Image", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
    await expect(dialog.getByLabel("API key", { exact: true })).toHaveCount(0);

    await dialog.getByRole("button", { name: "or paste a key instead" }).click();
    await expect(dialog.getByRole("heading", { name: "API key" })).toBeVisible();
    const field = dialog.getByLabel("API key", { exact: true });
    await expect(field).toHaveAttribute("type", "password");
    await expect(field).toHaveAttribute("placeholder", "sk-or-v1-…");
    await expect(field).toBeFocused();
    await expect(dialog.getByTestId("key-status")).toHaveText("Make a key at openrouter.ai/keys and paste it here. It starts with sk-or-.");
    await expect(dialog.getByRole("link", { name: "openrouter.ai/keys" })).toHaveAttribute("href", "https://openrouter.ai/keys");
    await expect(dialog.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Remove key" })).toHaveCount(0);

    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    // The reveal resets each time the dialog opens.
    await button.click();
    await expect(dialog.getByRole("button", { name: "or paste a key instead" })).toBeVisible();
  } finally {
    await engine.dispose();
  }
});

test("without a key, Agents, Connections and General work: the local agents, outside connections and the output folder are all there", async ({ page }) => {
  const { engine } = await startSettingsEngine({ key: false });
  try {
    await openApp(page, engine);
    const dialog = await openSettings(page);

    await showSection(dialog, "Agents");
    const agents = dialog.getByRole("region", { name: "Local agents" });
    await expect(agents.getByRole("button", { name: "Check again" })).toBeVisible();
    await expect(dialog.getByLabel("Claude command or path")).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Follow-up behavior" })).toHaveText("Queue");
    await expect(dialog.getByRole("button", { name: "Save" })).toBeVisible();

    await showSection(dialog, "Connections");
    await expect(dialog.getByText("Agents outside Unframed")).toBeVisible();
    await expect(dialog.getByTestId("agents-generate-need-key")).toContainText("Connect OpenRouter to let agents generate.");
    await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Connect an agent" }).click();
    const connect = page.getByRole("dialog", { name: "Connect an agent" });
    await expect(connect.getByTestId("agents-generate-need-key")).toHaveText("Connect OpenRouter to let agents generate.");
    await expect(connect.getByLabel("Spend limit amount")).toHaveCount(0);
    await connect.getByRole("button", { name: "Create connection" }).click();
    await expect(connect.getByTestId("setup-code").first()).toBeVisible();
    await connect.getByRole("button", { name: "Done" }).click();
    await expect(dialog.getByTestId("outside-connection")).toHaveCount(1);
    await expect(dialog.getByTestId("outside-connection").getByRole("button", { name: "Limit" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Connect OpenRouter to let agents generate" }).click();
    await expect(dialog.getByRole("tab", { name: "Generation" })).toHaveAttribute("aria-selected", "true");

    await showSection(dialog, "General");
    const folder = dialog.getByLabel("Output folder");
    await expect(folder).toHaveValue(join(engine.dataDir, "output"));
    await folder.fill(join(engine.dataDir, "elsewhere"));
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Saved to .env" })).toBeVisible();
    await expect(dialog).toBeVisible();
    expect((await (await engine.rpc()).call("settings.get")).outputDir).toBe(join(engine.dataDir, "elsewhere"));
  } finally {
    await engine.dispose();
  }
});

test("pasting: a bad key shows the key error in the banner, a good one closes the dialog with a toast and the button becomes Settings", async ({ page }) => {
  const { engine } = await startSettingsEngine({ key: false });
  try {
    await openApp(page, engine);
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "or paste a key instead" }).click();
    const field = dialog.getByLabel("API key", { exact: true });
    await field.fill("not-a-key");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toHaveText('That does not look like an OpenRouter key. Keys start with "sk-or-".');
    // Editing clears the banner.
    await field.fill("sk-or-v1-pasted-by-hand-9876");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await field.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(toast(page, "Key saved. Unframed is ready to generate.")).toBeVisible();
    await expect(settingsButton(page)).toHaveAccessibleName("Settings");
    await settingsButton(page).hover();
    await expect(page.getByText("Settings: key …9876, default models, output folder")).toBeVisible();
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("OPENROUTER_API_KEY=sk-or-v1-pasted-by-hand-9876\n");
  } finally {
    await engine.dispose();
  }
});
