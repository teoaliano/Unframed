import { rm } from "node:fs/promises";
import { makeTempDir } from "../../engine/test/engineProcess.ts";
import { openCanvas, plainText, roomShapes } from "./canvas.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";

test.describe("project activation", () => {
  test("opens the remembered project, and still remembers it after an engine restart on a new port", async ({ page }) => {
    const dataDir = await makeTempDir();
    const first = await startHostedEngine({ dataDir });
    try {
      const rpc = await first.rpc();
      await rpc.call("projects.create", { name: "alpha" });
      await rpc.call("projects.create", { name: "beta" });
      await rpc.call("preferences.set", { key: "project.active", value: "beta" });
      expect(await openCanvas(page, first)).toBe("beta");
      await expect(page.getByTestId("active-project")).toHaveText("beta");
      await first.stop();

      const second = await startHostedEngine({ dataDir });
      try {
        expect(second.port).not.toBe(first.port);
        expect(await openCanvas(page, second)).toBe("beta");
      } finally {
        await second.dispose();
      }
    } finally {
      await first.dispose();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test("opens the first project when none is remembered or the remembered one is gone, and remembers what it opened", async ({ page, engine }) => {
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "beta" });
    await rpc.call("projects.create", { name: "alpha" });
    expect(await openCanvas(page, engine)).toBe("alpha");
    await expect.poll(async () => (await rpc.call("preferences.get", { keys: ["project.active"] })).values["project.active"]).toBe("alpha");

    await rpc.call("preferences.set", { key: "project.active", value: "gone" });
    expect(await openCanvas(page, engine)).toBe("alpha");
  });

  test("creates and opens default, with its starter prompts, when there are no projects", async ({ page, engine }) => {
    expect(await openCanvas(page, engine)).toBe("default");
    const rpc = await engine.rpc();
    expect((await rpc.call("projects.list")).projects).toEqual(["default"]);
    const prompts = await roomShapes(engine, "default", "text");
    expect(prompts.map(plainText).sort()).toEqual(["A @100 on a windswept cliff at golden hour, cinematic, 35mm", "lone red fox"]);
    await expect(page.locator(".tl-shape[data-shape-type='text']")).toHaveCount(2);
  });

  test("a switch made while the initial load is still in flight wins over the load", async ({ page, engine }) => {
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "alpha" });
    await rpc.call("projects.create", { name: "beta" });

    // Hold back the answer to the app's first project list, as a slow engine would.
    let firstList: string | undefined;
    let releaseFirstList: () => void = () => {};
    await page.routeWebSocket("**/ws", (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        const frame = JSON.parse(String(message));
        if (firstList === undefined && frame._tag === "Request" && frame.tag === "projects.list") firstList = frame.id;
        server.send(message);
      });
      server.onMessage((message) => {
        const frame = JSON.parse(String(message));
        if (frame._tag === "Exit" && frame.requestId === firstList) {
          releaseFirstList = () => socket.send(message);
          return;
        }
        socket.send(message);
      });
    });
    await page.goto(engine.origin);
    await expect.poll(() => firstList).toBeDefined();

    await page.getByRole("button", { name: "Project", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "beta" }).click();
    await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible();

    releaseFirstList();
    await page.waitForTimeout(1500);
    await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible();
    await expect(page.locator("[data-canvas-project='alpha']")).toHaveCount(0);
    expect((await rpc.call("preferences.get", { keys: ["project.active"] })).values["project.active"]).toBe("beta");
  });
});
