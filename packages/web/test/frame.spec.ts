import { expect, isSettingsChunk, test, watchRpcSockets } from "./fixtures.ts";

const readHooks = () => ({
  theme: document.documentElement.getAttribute("data-unframed-theme"),
  secondary: getComputedStyle(document.documentElement).getPropertyValue("--unframed-text-secondary").trim(),
  body: getComputedStyle(document.body).backgroundColor,
  title: document.title,
  left: document.querySelectorAll(".unframed-chrome-left").length,
  right: document.querySelectorAll(".unframed-chrome-right").length,
});

test.describe("web frame", () => {
  test("connects to /ws and shows the frame with every hook the shell targets, in light", async ({ page, engine }) => {
    await page.emulateMedia({ colorScheme: "light" });
    const watch = watchRpcSockets(page);
    await page.goto(engine.origin);
    await watch.frame(0, isSettingsChunk());
    expect(new URL(watch.sockets[0]!.socket.url()).host).toBe(`localhost:${engine.port}`);

    await expect(page.locator(".unframed-chrome-left")).toBeVisible();
    await expect(page.locator(".unframed-chrome-right")).toBeVisible();
    expect(await page.evaluate(readHooks)).toEqual({
      theme: "light",
      secondary: "#525252",
      body: "rgb(247, 247, 247)",
      title: "Unframed",
      left: 1,
      right: 1,
    });
  });

  test("follows the dark scheme, and switches live when the system preference changes", async ({ page, engine }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(engine.origin);
    await expect(page.locator("html")).toHaveAttribute("data-unframed-theme", "dark");
    expect(await page.evaluate(readHooks)).toMatchObject({
      theme: "dark",
      secondary: "#a3a3a3",
      body: "rgb(26, 26, 26)",
    });

    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-unframed-theme", "light");
    expect(await page.evaluate(readHooks)).toMatchObject({ secondary: "#525252", body: "rgb(247, 247, 247)" });
  });

  test("positions the chrome cards with ordinary CSS the shell can override", async ({ page, engine }) => {
    await page.goto(engine.origin);
    await page.addStyleTag({ content: ".unframed-chrome-left { top: 40px; left: 80px; }" });
    const box = await page.locator(".unframed-chrome-left").boundingBox();
    expect(box).toMatchObject({ x: 80, y: 40 });
  });
});

test.describe("the page's host", () => {
  test("an element appended to <body> survives, and the web never changes document.title", async ({ page, engine }) => {
    const watch = watchRpcSockets(page);
    await page.goto(engine.origin);
    await watch.frame(0, isSettingsChunk());
    await page.evaluate(() => {
      const pill = document.createElement("div");
      pill.id = "shell-update-pill";
      pill.textContent = "Update ready";
      document.body.appendChild(pill);
      const titles: string[] = [];
      (window as unknown as { titleChanges: string[] }).titleChanges = titles;
      new MutationObserver(() => titles.push(document.title)).observe(document.head, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      document.title = "Set by the shell";
    });

    // Make the app render again: a settings change and a theme change.
    await (await engine.rpc()).call("settings.update", { textModel: "host/check" });
    await watch.frame(0, isSettingsChunk("host/check"));
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-unframed-theme", "dark");

    await expect(page.locator("body > #shell-update-pill")).toHaveText("Update ready");
    expect(await page.evaluate(() => document.title)).toBe("Set by the shell");
    expect(await page.evaluate(() => (window as unknown as { titleChanges: string[] }).titleChanges)).toEqual([
      "Set by the shell",
    ]);
  });
});
