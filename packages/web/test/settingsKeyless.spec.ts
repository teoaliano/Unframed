import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { toast } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { expectSlot, expectToken } from "./kit.ts";
import { openApp, settingsButton, settingsDialog, startSettingsEngine } from "./settings.ts";

const INTRO =
  "Unframed has no image model of its own. It sends your prompts to OpenRouter, which runs the model and bills your OpenRouter account per image (a few cents for most models). Connecting takes you there to approve Unframed; the key it gives back is saved on this machine and used only by your local server.";

test("a keyless first load opens the dialog by itself, with the intro, Connect, and no Save until the paste field is revealed", async ({ page }) => {
  const { engine } = await startSettingsEngine({ key: false });
  try {
    await openApp(page, engine);
    const dialog = settingsDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Connect OpenRouter to start" })).toBeVisible();
    await expect(dialog.getByText(INTRO)).toBeVisible();
    await expect(dialog.getByRole("link", { name: "OpenRouter", exact: true })).toHaveAttribute("href", "https://openrouter.ai");
    await expect(dialog.getByRole("button", { name: "Connect OpenRouter" })).toBeVisible();
    await expectSlot(dialog, "dialog-popup");
    await expectSlot(dialog.getByRole("button", { name: "Connect OpenRouter" }), "button");
    await expectToken(dialog.getByRole("button", { name: "Connect OpenRouter" }), "background-color", "--primary");
    await expectSlot(dialog.getByRole("button", { name: "or paste a key instead" }), "button");
    await expect(dialog.getByText("Default models")).toHaveCount(0);
    await expect(dialog.getByText("Output folder")).toHaveCount(0);
    await expect(dialog.getByText("Local agents")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
    await expect(dialog.getByLabel("API key")).toHaveCount(0);

    await dialog.getByRole("button", { name: "or paste a key instead" }).click();
    await expect(dialog.getByRole("heading", { name: "API key" })).toBeVisible();
    const field = dialog.getByLabel("API key");
    await expect(field).toHaveAttribute("type", "password");
    await expect(field).toHaveAttribute("placeholder", "sk-or-v1-…");
    await expect(field).toBeFocused();
    await expect(dialog.getByTestId("key-status")).toHaveText("Make a key at openrouter.ai/keys and paste it here. It starts with sk-or-.");
    await expect(dialog.getByRole("link", { name: "openrouter.ai/keys" })).toHaveAttribute("href", "https://openrouter.ai/keys");
    await expect(dialog.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Remove key" })).toHaveCount(0);

    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    const button = settingsButton(page);
    await expect(button).toHaveAccessibleName("Add your API key");
    await button.hover();
    await expect(page.getByText("No OpenRouter key yet. Click to add one")).toBeVisible();

    // The reveal resets each time the dialog opens.
    await button.click();
    await expect(dialog.getByRole("button", { name: "or paste a key instead" })).toBeVisible();
  } finally {
    await engine.dispose();
  }
});

test("pasting: a bad key shows the key error in the banner, a good one closes the dialog with a toast and the button becomes Settings", async ({ page }) => {
  const { engine } = await startSettingsEngine({ key: false });
  try {
    await openApp(page, engine);
    const dialog = settingsDialog(page);
    await dialog.getByRole("button", { name: "or paste a key instead" }).click();
    const field = dialog.getByLabel("API key");
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
