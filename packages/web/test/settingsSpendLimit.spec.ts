import { expect, test } from "./fixtures.ts";
import { openApp, openSettings, startSettingsEngine } from "./settings.ts";

test("Connect an agent sets a spend limit, the row shows it, and Limit changes it or removes it", async ({ page }) => {
  const { engine } = await startSettingsEngine();
  try {
    await openApp(page, engine);
    const dialog = await openSettings(page);

    // Neither field is filled in by default; an amount needs a period before the connection can be made.
    await dialog.getByRole("button", { name: "Connect an agent" }).click();
    const connect = page.getByRole("dialog", { name: "Connect an agent" });
    await expect(connect.getByLabel("Spend limit amount")).toHaveValue("");
    await expect(connect.getByRole("combobox", { name: "Limit period" })).toHaveText("Choose a period");
    await connect.getByLabel("Spend limit amount").fill("5");
    await expect(connect.getByText("Choose a period for the limit.")).toBeVisible();
    await expect(connect.getByRole("button", { name: "Create connection" })).toBeDisabled();
    await connect.getByRole("combobox", { name: "Limit period" }).click();
    await page.getByRole("option", { name: "Per day" }).click();
    await expect(connect.getByRole("button", { name: "Create connection" })).toBeEnabled();
    await connect.getByRole("button", { name: "Create connection" }).click();
    await connect.getByRole("button", { name: "Done" }).click();

    const row = dialog.getByTestId("outside-connection");
    await expect(row.getByTestId("outside-spend")).toHaveText("Spent $0.00 of $5.00 per day");
    const connections = async () => (await (await engine.rpc()).call("agentConnections.list")).connections as ReadonlyArray<{ spendLimit: unknown }>;
    await expect.poll(async () => (await connections())[0]!.spendLimit).toEqual({ usd: 5, period: "day" });

    // Limit changes the amount and the period, and the row says so at once.
    await row.getByRole("button", { name: "Limit" }).click();
    const limit = page.getByRole("dialog", { name: "Limit for Claude Code" });
    await expect(limit.getByLabel("Spend limit amount")).toHaveValue("5");
    await limit.getByLabel("Spend limit amount").fill("12.5");
    await limit.getByRole("combobox", { name: "Limit period" }).click();
    await page.getByRole("option", { name: "Per week" }).click();
    await limit.getByRole("button", { name: "Save limit" }).click();
    await expect(row.getByTestId("outside-spend")).toHaveText("Spent $0.00 of $12.50 per week");
    await expect.poll(async () => (await connections())[0]!.spendLimit).toEqual({ usd: 12.5, period: "week" });

    // An amount with three decimals cannot be kept, so Save waits.
    await row.getByRole("button", { name: "Limit" }).click();
    await expect(limit.getByLabel("Spend limit amount")).toHaveValue("12.5");
    await limit.getByLabel("Spend limit amount").fill("1.234");
    await expect(limit.getByText("Enter an amount above zero, or leave it empty for no limit.")).toBeVisible();
    await expect(limit.getByRole("button", { name: "Save limit" })).toBeDisabled();

    // An empty amount removes the limit.
    await limit.getByLabel("Spend limit amount").fill("");
    await limit.getByRole("button", { name: "Save limit" }).click();
    await expect(row.getByTestId("outside-spend")).toHaveText("Spent $0.00, no limit");
    await expect.poll(async () => (await connections())[0]!.spendLimit).toBeNull();
  } finally {
    await engine.dispose();
  }
});
