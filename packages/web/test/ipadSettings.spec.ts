import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deviceRequest, readAuthority, TEST_NAME } from "../../engine/test/ipadClient.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { expect, test } from "./fixtures.ts";
import { openApp, openSettings, startSettingsEngine } from "./settings.ts";

const testIpad = (extra: Record<string, string> = {}) => ({ UNFRAMED_TEST_IPAD: TEST_NAME, IPAD_PORT: "0", ...extra });

const section = (page: Page) => page.getByTestId("ipad-section");

const ipadPort = async (engine: TestEngine): Promise<number> => {
  const status = await (await engine.rpc()).call("ipad.status");
  return status.port;
};

const accessSwitch = (page: Page) => section(page).getByRole("switch", { name: "iPad access" });

const turnOn = async (page: Page) => {
  await accessSwitch(page).click();
  await expect(accessSwitch(page)).toBeChecked();
  await expect(section(page).getByTestId("ipad-address")).toBeVisible();
};

test("the app tells the engine at boot whether its key covers this Mac", async ({ page }) => {
  const { engine } = await startSettingsEngine({ env: testIpad() });
  try {
    const sent: string[] = [];
    page.on("websocket", (socket) => {
      if (new URL(socket.url()).pathname !== "/ws") return;
      socket.on("framesent", ({ payload }) => {
        try {
          const message = JSON.parse(String(payload));
          if (typeof message?.tag === "string") sent.push(message.tag);
        } catch {
          sent.push("");
        }
      });
    });
    await openApp(page, engine);
    await expect.poll(() => sent.includes("ipad.setAvailability"), { timeout: 20_000 }).toBe(true);
  } finally {
    await engine.dispose();
  }
});

test("the iPad section is absent when the tldraw key does not cover this Mac", async ({ page }) => {
  const { engine } = await startSettingsEngine();
  try {
    await openApp(page, engine);
    const dialog = await openSettings(page);
    await expect(dialog.getByRole("heading", { name: "Agents outside Unframed" })).toBeVisible();
    await expect(page.getByTestId("ipad-section")).toHaveCount(0);
  } finally {
    await engine.dispose();
  }
});

test("the section shows with a covered name: the switch writes at once and the address appears", async ({ page }) => {
  const { engine } = await startSettingsEngine({ env: testIpad() });
  try {
    await openApp(page, engine);
    await openSettings(page);
    await expect(section(page).getByRole("heading", { name: "iPad" })).toBeVisible();
    await expect(section(page)).toContainText("Draw on this canvas from your iPad over your home Wi-Fi. Only devices you pair can connect.");
    await expect(section(page).getByTestId("ipad-address")).toHaveCount(0);

    await turnOn(page);
    const port = await ipadPort(engine);
    await expect(section(page).getByTestId("ipad-address")).toHaveText(`https://${TEST_NAME}:${port}`);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toContain("IPAD_ACCESS=on");
    const steps = section(page).getByTestId("ipad-steps").getByRole("listitem");
    await expect(steps).toHaveCount(3);
    await expect(steps.first()).toContainText("Trust the certificate");
    await expect(steps.last()).toContainText("Add to Home Screen");

    await accessSwitch(page).click();
    await expect(accessSwitch(page)).not.toBeChecked();
    await expect(section(page).getByTestId("ipad-address")).toHaveCount(0);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).not.toContain("IPAD_ACCESS");
  } finally {
    await engine.dispose();
  }
});

test("the port is saved with the other fields, and a bad one is refused", async ({ page }) => {
  const { engine } = await startSettingsEngine({ env: testIpad(), dotenv: "OPENROUTER_API_KEY=sk-or-v1-test-key-0000abcd\nIPAD_ACCESS=on\n" });
  try {
    await openApp(page, engine);
    const dialog = await openSettings(page);
    await expect(section(page).getByLabel("Port", { exact: true })).toHaveValue("0");

    await section(page).getByLabel("Port", { exact: true }).fill("80");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toContainText("The iPad port has to be a whole number from 1024 to 65535.");

    await section(page).getByLabel("Port", { exact: true }).fill("18999");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toContainText("Saved to .env");
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toContain("IPAD_PORT=18999");
    await expect.poll(async () => (await (await engine.rpc()).call("ipad.status")).port).toBe(18999);
  } finally {
    await engine.dispose();
  }
});

test("a port another app holds shows the warning and leaves the switch on", async ({ page }) => {
  const other = createServer((_request, response) => response.end("someone else"));
  await new Promise<void>((done) => other.listen(0, "0.0.0.0", done));
  const address = other.address();
  const taken = typeof address === "object" && address !== null ? address.port : 0;
  const { engine } = await startSettingsEngine({
    env: testIpad({ IPAD_PORT: String(taken) }),
    dotenv: `OPENROUTER_API_KEY=sk-or-v1-test-key-0000abcd\nIPAD_ACCESS=on\nIPAD_PORT=${taken}\n`,
  });
  try {
    await openApp(page, engine);
    await openSettings(page);
    await expect(section(page).getByTestId("ipad-port-taken")).toContainText(`Port ${taken} is in use by another app. Choose another port and save.`);
    await expect(accessSwitch(page)).toBeChecked();
    await expect(section(page).getByTestId("ipad-address")).toHaveText(`https://${TEST_NAME}:${taken}`);
  } finally {
    await engine.dispose();
    other.close();
  }
});

test("Export iPad profile writes the profile and reveals it", async ({ page }) => {
  const { engine } = await startSettingsEngine({ env: testIpad(), dotenv: "OPENROUTER_API_KEY=sk-or-v1-test-key-0000abcd\nIPAD_ACCESS=on\n" });
  try {
    await openApp(page, engine);
    await openSettings(page);
    await section(page).getByRole("button", { name: "Export iPad profile" }).click();

    const path = join(engine.dataDir, "ipad", `Unframed-${TEST_NAME}.mobileconfig`);
    await expect.poll(() => readFile(path, "utf8").then(() => true, () => false)).toBe(true);
    expect(await readFile(path, "utf8")).toContain("com.apple.security.root");
    await engine.waitForMessage((message) => message.type === "reveal" && message.files.includes(path));
  } finally {
    await engine.dispose();
  }
});

test("Pair an iPad shows a code and a QR, and closes itself when the iPad uses it", async ({ page }) => {
  const { engine } = await startSettingsEngine({ env: testIpad(), dotenv: "OPENROUTER_API_KEY=sk-or-v1-test-key-0000abcd\nIPAD_ACCESS=on\n" });
  try {
    await openApp(page, engine);
    await openSettings(page);
    await section(page).getByRole("button", { name: "Pair an iPad" }).click();

    const dialog = page.getByTestId("ipad-pair-dialog");
    await expect(dialog.getByTestId("ipad-code")).toHaveText(/^\d{6}$/);
    await expect(dialog.getByTestId("ipad-qr")).toBeVisible();
    await expect(dialog.getByTestId("ipad-countdown")).toHaveText(/^[0-4]:\d{2} left$/);

    const code = await dialog.getByTestId("ipad-code").innerText();
    const port = await ipadPort(engine);
    const answer = await deviceRequest(port, await readAuthority(engine.dataDir), "/api/ipad/pair", {
      method: "POST",
      body: `code=${code}`,
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" },
    });
    expect(answer.status).toBe(303);

    await expect(dialog).toBeHidden();
    await expect(page.getByText(/^iPad \(.+\) is paired\.$/)).toBeVisible();
    await expect(section(page).getByTestId("ipad-device")).toContainText("Never used");
  } finally {
    await engine.dispose();
  }
});

test("Revoke asks first, then the device is gone and its cookie is refused", async ({ page }) => {
  const { engine } = await startSettingsEngine({ env: testIpad(), dotenv: "OPENROUTER_API_KEY=sk-or-v1-test-key-0000abcd\nIPAD_ACCESS=on\n" });
  try {
    await openApp(page, engine);
    await openSettings(page);
    const port = await ipadPort(engine);
    const ca = await readAuthority(engine.dataDir);
    const started = await (await engine.rpc()).call("ipad.pairStart");
    const paired = await deviceRequest(port, ca, "/api/ipad/pair", {
      method: "POST",
      body: `code=${started.code}`,
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" },
    });
    const token = /unframed_device=([0-9a-f]+)/.exec(String(paired.headers["set-cookie"]?.[0]))![1]!;

    await page.keyboard.press("Escape");
    await openSettings(page);
    const row = section(page).getByTestId("ipad-device");
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row.getByRole("button", { name: "Yes, revoke" })).toBeVisible();
    await row.getByRole("button", { name: "Yes, revoke" }).click();
    await expect(section(page).getByTestId("ipad-device")).toHaveCount(0);

    const refused = await deviceRequest(port, ca, "/", { token, headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
    expect(refused.status).toBe(303);
    expect(refused.headers.location).toBe("/pair");
  } finally {
    await engine.dispose();
  }
});
