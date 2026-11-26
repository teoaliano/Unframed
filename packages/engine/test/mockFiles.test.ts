import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { toolResults } from "./agentCanvas.ts";
import { chromeOnMachine as chrome } from "./chrome.ts";
import { git } from "./gitRepos.ts";
import { makeTempDir, rawRequest } from "./harness.ts";
import { liveAgent, stateTurn, type RepositoryAgent } from "./repositoryAgent.ts";

if (chrome === undefined) console.log("  mock file tests in a browser skipped: no Chrome, Chromium, Edge or Brave on this machine");

const TODOS = `unframed.mock(({ http, data, switches, reply }) => {
  const todos = data("todos", [{ id: 1, title: "Apples" }, { id: 2, title: "Pears" }]);
  const list = switches("todos", ["full", "empty", "broken"]);
  http.get("/api/todos", () => (list === "empty" ? [] : list === "broken" ? reply({ status: 500, body: { error: "down" } }) : todos.all()));
  http.post("/api/todos", ({ body }) => todos.insert(body));
});
`;

const write = async (agent: RepositoryAgent, path: string, content: string) => {
  const full = join(agent.instance.worktree, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
};

const text = async (proxy: number, path: string) => (await fetch(`http://127.0.0.1:${proxy}${path}`)).text();

const until = async <A>(read: () => Promise<A>, done: (value: A) => boolean, what: string, timeoutMs = 15_000): Promise<A> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const WAIT = { timeout: 45_000, polling: 200 };

const browser = async () => {
  const puppeteer = await import("puppeteer-core");
  return puppeteer.launch({ executablePath: chrome!, headless: true, userDataDir: await makeTempDir("unframed-mock-chrome-"), args: ["--no-first-run", "--no-default-browser-check"] });
};

describe("mock files", () => {
  it("are served with the bridge before it, the files alone for a hot swap, and stay out of git", { timeout: 60_000 }, async () => {
    const { agent, proxy } = await liveAgent();
    await write(agent, ".unframed/mocks/todos.mock.js", TODOS);
    await write(agent, ".unframed/mocks/notes.txt", "not a mock");
    const bridge = await text(proxy, "/__unframed/bridge.js");
    expect(bridge).toContain('window.__unframedMockFiles.load("todos.mock.js", function (unframed) {');
    expect(bridge).not.toContain("not a mock");
    expect(bridge.indexOf("__unframedMockFiles.load(")).toBeLessThan(bridge.indexOf("__unframedScreenBridge = true"));
    const source = await text(proxy, "/__unframed/mocks.js");
    expect(source.trim().startsWith('window.__unframedMockFiles && window.__unframedMockFiles.load("todos.mock.js"')).toBe(true);

    const written = await agent.rpc.call("instances.patch", { project: agent.project, id: agent.instance.id });
    expect(written.patch).toBe("");
  });

  it("take request log entries from the page's own origin and refuse another site's", { timeout: 60_000 }, async () => {
    const { agent, proxy } = await liveAgent();
    const post = (origin: string, url: string) =>
      rawRequest(proxy, "/__unframed/mocks/log", { method: "POST", body: JSON.stringify([{ method: "GET", url }]), headers: { host: `127.0.0.1:${proxy}`, origin, "content-type": "text/plain" } });
    expect((await post("https://evil.example", "/from-another-site")).status).toBe(403);
    expect((await post(`http://127.0.0.1:${proxy}`, "/from-the-page")).status).toBe(204);
    const chat = await stateTurn(agent, [{ name: "mocks_read", input: {} }]);
    const requests = toolResults(chat, "mocks_read")[0]!.result.requests as ReadonlyArray<{ readonly url: string }>;
    expect(requests.map((request) => request.url)).toEqual(["/from-the-page"]);
  });
});

describe.skipIf(chrome === undefined)("mock files in a page", () => {
  it("answer the app's requests, keep what it writes, switch by route, log each request with its call site, and hot-reload", { timeout: 240_000 }, async () => {
    const { agent, proxy } = await liveAgent();
    await write(agent, ".unframed/mocks/todos.mock.js", TODOS);
    const chromium = await browser();
    try {
      const page = await chromium.newPage();
      await page.goto(`http://127.0.0.1:${proxy}/todos`, { waitUntil: "load" });
      await page.waitForFunction("document.getElementById('count').textContent === '2 todos'", undefined, WAIT);
      await page.type("#todo-name", "Milk");
      await page.click("#add");
      await page.waitForFunction("document.getElementById('count').textContent === '3 todos'", undefined, WAIT);
      expect(await page.$$eval("#todos li", (items) => items.map((item) => item.textContent))).toEqual(["Apples", "Pears", "Milk"]);

      await new Promise((resolve) => setTimeout(resolve, 1500));
      const chat = await stateTurn(agent, [{ name: "mocks_read", input: {} }]);
      const log = toolResults(chat, "mocks_read")[0]!.result;
      expect(log.files).toEqual([
        { file: "todos.mock.js", handlers: [{ method: "GET", pattern: "/api/todos" }, { method: "POST", pattern: "/api/todos" }], sockets: [], collections: ["todos"], switches: [{ name: "todos", options: ["full", "empty", "broken"] }] },
      ]);
      expect(log.requests[0]).toMatchObject({ method: "GET", url: "/api/todos", status: 200, mock: "todos.mock.js: GET /api/todos", site: expect.stringMatching(/^todos:1:\d+$/) });
      expect(log.requests).toContainEqual(expect.objectContaining({ method: "POST", url: "/api/todos", mock: "todos.mock.js: POST /api/todos" }));

      const empty = await chromium.newPage();
      await empty.goto(`http://127.0.0.1:${proxy}/todos?__unframed_switch=todos:empty`, { waitUntil: "load" });
      await empty.waitForFunction("document.getElementById('count').textContent === '0 todos'", undefined, WAIT);
      const broken = await chromium.newPage();
      await broken.goto(`http://127.0.0.1:${proxy}/todos?__unframed_switch=todos:broken`, { waitUntil: "load" });
      await broken.waitForFunction("document.getElementById('count').textContent === 'No backend'", undefined, WAIT);

      await write(agent, ".unframed/mocks/todos.mock.js", TODOS.replace('{ id: 2, title: "Pears" }', '{ id: 2, title: "Plums" }, { id: 3, title: "Figs" }'));
      await page.waitForFunction("document.getElementById('count').textContent === '3 todos' && document.getElementById('todos').textContent.includes('Figs')", WAIT);
      expect(await page.$$eval("#todos li", (items) => items.map((item) => item.textContent))).toEqual(["Apples", "Plums", "Figs"]);
    } finally {
      await chromium.close();
    }
  });

  it("replace a module the dev server serves by path, and still reach the real one", { timeout: 90_000 }, async () => {
    const { agent, proxy } = await liveAgent();
    const chromium = await browser();
    try {
      const page = await chromium.newPage();
      await page.goto(`http://127.0.0.1:${proxy}/todos`, { waitUntil: "load" });
      await page.waitForFunction("document.getElementById('greeting').textContent === 'Real greeting'", undefined, WAIT);
      await write(agent, ".unframed/mocks/modules/src/greeting.js", 'import { greeting as real } from "/src/greeting.ts?unframed_real";\nexport const greeting = `${real}, replaced`;\n');
      await until(() => text(proxy, "/src/greeting.ts?t=1"), (body) => body.includes("replaced"), "the replacement");
      expect(await text(proxy, "/src/greeting.ts?unframed_real")).toContain("Real greeting");
      const fresh = await chromium.newPage();
      await fresh.goto(`http://127.0.0.1:${proxy}/todos`, { waitUntil: "load" });
      await fresh.waitForFunction("document.getElementById('greeting').textContent === 'Real greeting, replaced'", undefined, WAIT);
    } finally {
      await chromium.close();
    }
  });

  it("are written by mock_write as Setup's files, excluded and copied into other worktrees, and refuse paths outside the folder", { timeout: 90_000 }, async () => {
    const { agent } = await liveAgent();
    const other = await agent.rpc.call("instances.create", { project: agent.project, branch: "other" });
    const chat = await stateTurn(agent, [
      { name: "mock_write", input: { file: "todos.mock.js", content: TODOS } },
      { name: "mock_write", input: { file: "../escape.mock.js", content: "x" } },
      { name: "mock_write", input: { file: "todos.js", content: "x" } },
    ]);
    const [written, outside, named] = toolResults(chat, "mock_write");
    expect(written).toMatchObject({ status: "completed", result: { file: ".unframed/mocks/todos.mock.js", copiedInto: [other.id] } });
    expect(outside!.status).toBe("failed");
    expect(named!.status).toBe("failed");
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(join(other.worktree, ".unframed/mocks/todos.mock.js"), "utf8")).toBe(TODOS);
    expect(git(agent.instance.worktree, "status", "--porcelain")).toBe("");
  });
});
