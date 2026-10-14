import { expect, test } from "./fixtures.ts";
import { openApp, openSettings, startSettingsEngine } from "./settings.ts";

/** The connect dialog's setup text, and the token in its code. */
const tokenIn = (text: string) => /UNFRAMED_MCP_TOKEN=(ufx_[0-9a-f]{64})/.exec(text)![1]!;

test("Connect an agent shows Codex's setup once, the row says Never used, and a call with the token makes it Last used", async ({ page }) => {
  const { engine } = await startSettingsEngine();
  try {
    await openApp(page, engine);
    const dialog = await openSettings(page);
    await expect(dialog.getByRole("heading", { name: "Agents outside Unframed" })).toBeVisible();
    await expect(dialog.getByTestId("outside-connection")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Connect an agent" }).click();
    const connect = page.getByRole("dialog", { name: "Connect an agent" });
    await connect.getByText("Codex", { exact: true }).click();
    await expect(connect.getByLabel("Name")).toHaveValue("Codex");
    await connect.getByLabel("Name").fill("Codex in the IDE");
    await connect.getByRole("button", { name: "Create connection" }).click();

    const code = connect.getByTestId("setup-code").first();
    await expect(code).toContainText("codex mcp add unframed-app");
    await expect(connect.getByTestId("setup-code")).toHaveCount(2);
    await expect(connect.getByText("This setup holds a key to your canvas. Unframed shows it once.")).toBeVisible();
    const token = tokenIn(await code.innerText());

    await connect.getByRole("button", { name: "Done" }).click();
    const row = dialog.getByTestId("outside-connection");
    await expect(row).toContainText("Codex in the IDE");
    await expect(row).toContainText("Codex");
    await expect(row).toContainText("Never used");

    const answer = await engine.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } }),
    });
    expect(answer.status).toBe(200);
    await page.keyboard.press("Escape");
    const reopened = await openSettings(page);
    await expect(reopened.getByTestId("outside-connection")).toContainText("Last used just now");
  } finally {
    await engine.dispose();
  }
});

test("Revoke asks first, then the row is gone and the revoked token answers 401", async ({ page }) => {
  const { engine } = await startSettingsEngine();
  try {
    const rpc = await engine.rpc();
    const made = await rpc.call("agentConnections.create", { name: "Laptop", client: "claude-code" });
    await openApp(page, engine);
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "Revoke" }).click();
    const ask = page.getByRole("alertdialog", { name: "Revoke Laptop?" });
    await expect(ask).toContainText("The agent loses access at once. Its chats and the changes it made stay.");
    await expect(dialog.getByTestId("outside-connection")).toHaveCount(1);
    await ask.getByRole("button", { name: "Revoke" }).click();
    await expect(dialog.getByTestId("outside-connection")).toHaveCount(0);

    const refused = await engine.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${made.token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(refused.status).toBe(401);
  } finally {
    await engine.dispose();
  }
});
