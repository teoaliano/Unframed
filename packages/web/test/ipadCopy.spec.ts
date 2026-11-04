import { TEST_NAME } from "../../engine/test/ipadClient.ts";
import { expect, test } from "./fixtures.ts";
import { openApp, openSettings, startSettingsEngine } from "./settings.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("Copy puts the iPad address on the clipboard", async ({ page }) => {
  const { engine } = await startSettingsEngine({
    env: { UNFRAMED_TEST_IPAD: TEST_NAME, IPAD_PORT: "0" },
    dotenv: "OPENROUTER_API_KEY=sk-or-v1-test-key-0000abcd\nIPAD_ACCESS=on\n",
  });
  try {
    await openApp(page, engine);
    await openSettings(page);
    const section = page.getByTestId("ipad-section");
    const address = await section.getByTestId("ipad-address").innerText();
    expect(address).toMatch(new RegExp(`^https://${TEST_NAME}:\\d+$`));

    await section.getByRole("button", { name: "Copy" }).click();
    await expect(section.getByRole("button", { name: "Copied" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  } finally {
    await engine.dispose();
  }
});
