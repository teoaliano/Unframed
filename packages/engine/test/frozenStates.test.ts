import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toolResults } from "./agentCanvas.ts";
import { chromeOnMachine as chrome } from "./chrome.ts";
import { makeTempDir } from "./harness.ts";
import { liveAgent, stateTurn } from "./repositoryAgent.ts";

if (chrome === undefined) console.log("  frozen state tests skipped: no Chrome, Chromium, Edge or Brave on this machine");

const TODOS = `unframed.mock(({ http, data }) => {
  const todos = data("todos", [{ id: 1, title: "Apples" }, { id: 2, title: "Pears" }]);
  http.get("/api/todos", () => todos.all());
  http.post("/api/todos", ({ body }) => todos.insert(body));
});
`;

const NAME = { role: "textbox", name: "Name" };

describe.skipIf(chrome === undefined)("a frozen state", () => {
  it("saves the rows a Screen wrote and the text typed into it, and restores them before the app boots on every load", { timeout: 180_000 }, async () => {
    const { agent, proxy } = await liveAgent();
    await mkdir(join(agent.instance.worktree, ".unframed/mocks"), { recursive: true });
    await writeFile(join(agent.instance.worktree, ".unframed/mocks/todos.mock.js"), TODOS);
    const screen = agent.screen.id.replace(/^shape:/, "");
    const chat = await stateTurn(agent, [
      {
        name: "screen_state",
        input: {
          shapeId: screen,
          route: "/todos",
          state: "milk added, bread typed",
          steps: [
            { action: "type", target: NAME, text: "Milk" },
            { action: "click", target: { role: "button", name: "Add" } },
            { action: "wait", target: { text: "3 todos" } },
            { action: "type", target: NAME, text: "Bread" },
          ],
        },
      },
      { name: "state_freeze", input: { shapeId: screen, keep: [9] } },
      { name: "state_freeze", input: { shapeId: screen } },
    ]);
    const [saved] = toolResults(chat, "screen_state");
    expect(saved!.status).toBe("completed");
    const [badKeep, frozen] = toolResults(chat, "state_freeze");
    expect(badKeep).toMatchObject({ status: "failed", result: { error: "keep is a list of step numbers from 1 to 4" } });
    expect(frozen).toMatchObject({ status: "completed", result: { screen, route: expect.stringMatching(/^\/todos\?__unframed_restore=s_[0-9a-f]{32}$/), fields: 1, collections: ["todos"], steps: 0 } });
    const route = frozen!.result.route as string;

    const shown = (await agent.records()).find((record) => record.id === agent.screen.id);
    expect(shown.props).toMatchObject({ route, steps: [], state: "milk added, bread typed" });

    const puppeteer = await import("puppeteer-core");
    const chromium = await puppeteer.launch({ executablePath: chrome!, headless: true, userDataDir: await makeTempDir("unframed-frozen-chrome-") });
    try {
      for (let load = 0; load < 2; load++) {
        const page = await chromium.newPage();
        await page.goto(`http://127.0.0.1:${proxy}${route}`, { waitUntil: "load" });
        await page.waitForFunction("document.getElementById('count').textContent === '3 todos'");
        await page.waitForFunction("document.getElementById('todo-name').value === 'Bread'");
        expect(await page.$$eval("#todos li", (items) => items.map((item) => item.textContent))).toEqual(["Apples", "Pears", "Milk"]);
        expect(await page.evaluate("location.search")).toBe(route.slice("/todos".length));
        await page.close();
      }
      const plain = await chromium.newPage();
      await plain.goto(`http://127.0.0.1:${proxy}/todos`, { waitUntil: "load" });
      await plain.waitForFunction("document.getElementById('count').textContent === '2 todos'");
    } finally {
      await chromium.close();
    }

    const html = await (await fetch(`http://127.0.0.1:${proxy}${route}`)).text();
    const bridge = /<script src="([^"]+)"/.exec(html)![1]!.replaceAll("&amp;", "&");
    expect(bridge).toBe(`/__unframed/bridge.js?restore=${route.split("=")[1]}`);
    const unknown = await (await fetch(`http://127.0.0.1:${proxy}/__unframed/bridge.js?restore=s_${"0".repeat(32)}`)).text();
    expect(unknown).not.toContain("__unframedRestore =");
  });
});
