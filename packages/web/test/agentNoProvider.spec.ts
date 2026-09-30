import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeCodex } from "../../engine/test/agentFakes.ts";
import { openCanvas } from "./canvas.ts";
import { expect, openRail, promptBox, startDetectingEngine } from "./agent.ts";
import { test } from "./fixtures.ts";
import { platformOf } from "./platform.ts";

test("with no provider ready the rail shows each status and how to install, Send stays off, and Check again re-checks", async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), "unframed-noprovider-"));
  const engine = await startDetectingEngine(dir);
  try {
    await openCanvas(page, engine);
    const panel = await openRail(page);
    const none = panel.getByTestId("no-provider");
    await expect(none).toHaveAttribute("data-slot", "empty");
    await expect(none.getByRole("button", { name: "Check again" })).toHaveAttribute("data-slot", "button");
    await expect(none.getByText(`No Claude or Codex found on this ${(await platformOf(page)).machine}.`, { exact: true })).toBeVisible();
    await expect(none.getByText("Install one and sign in, and the agent runs on your plan. Nothing is sent anywhere until then.", { exact: true })).toBeVisible();
    const claude = none.locator("li[data-provider='claude']");
    await expect(claude).toHaveText("Claude · Claude is not installed or not on PATH. How to install");
    await expect(claude.getByRole("link", { name: "How to install" })).toHaveAttribute("href", "https://claude.com/product/claude-code");
    await expect(claude.getByRole("link", { name: "How to install" })).toHaveAttribute("target", "_blank");
    await expect(none.locator("li[data-provider='codex']")).toHaveText("Codex · Codex is not installed or not on PATH. How to install");

    // Nothing can be sent, even with text in the box.
    await expect(panel.locator("[data-placeholder]")).toHaveAttribute("data-placeholder", "Connect Claude or Codex to start");
    await promptBox(panel).click();
    await promptBox(panel).pressSequentially("hello");
    await expect(panel.getByRole("button", { name: "Send" })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "New chat" })).toBeDisabled();

    // Codex arrives, slow to answer: Check again shows the check running, then the rail opens up.
    await fakeCodex(join(dir, "bin"), "codex-real");
    await writeFile(join(dir, "bin", "codex"), `#!/bin/sh\nif [ "$1" = "--version" ]; then sleep 1; fi\nexec "${join(dir, "bin", "codex-real")}" "$@"\n`);
    await chmod(join(dir, "bin", "codex"), 0o755);
    await none.getByRole("button", { name: "Check again" }).click();
    await expect(none.locator("li[data-provider='codex']")).toHaveText("Codex · checking…");
    await expect(none.getByRole("button", { name: "Check again" })).toHaveAttribute("aria-busy", "true");
    await expect(none).toHaveCount(0, { timeout: 15_000 });
    await expect(panel.getByRole("button", { name: "Send" })).toBeEnabled();
    await expect(panel.getByRole("button", { name: "New chat" })).toBeEnabled();
  } finally {
    await engine.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
