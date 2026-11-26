import { describe, expect, it } from "vitest";
import {
  callSiteOf,
  frozenState,
  isMockFileName,
  matchPattern,
  MOCK_LOG_KEEP,
  mockLogEntries,
  mockLogKept,
  mockModulePaths,
  mockRuntimeSource,
  restoreIdOf,
  restorePrefix,
  restoreRoute,
  switchesOf,
  SWITCH_PARAM,
  takeUnframedParams,
  withoutRestore,
} from "../src/index.ts";

const PAGE = "http://localhost:4100";
const ID = `s_${"a".repeat(32)}`;

describe("a mock file's URL patterns", () => {
  it("match same-origin paths, naming their parameters, and ignore the query unless the pattern has one", () => {
    expect(matchPattern("/api/items", `${PAGE}/api/items?page=2`, PAGE)).toEqual({});
    expect(matchPattern("/api/items", `${PAGE}/api/items/`, PAGE)).toEqual({});
    expect(matchPattern("/api/items/:id", `${PAGE}/api/items/42`, PAGE)).toEqual({ id: "42" });
    expect(matchPattern("/api/items/:id", `${PAGE}/api/items/42/tags`, PAGE)).toBeUndefined();
    expect(matchPattern("/files/:path*", `${PAGE}/files/a/b%20c.png`, PAGE)).toEqual({ path: "a/b c.png" });
    expect(matchPattern("/api/*", `${PAGE}/api/anything/at/all`, PAGE)).toEqual({});
    expect(matchPattern("/search?q=*", `${PAGE}/search?q=pears`, PAGE)).toEqual({});
    expect(matchPattern("/search?q=*", `${PAGE}/search`, PAGE)).toBeUndefined();
  });

  it("keep a path pattern to the page's own origin and match other origins by full URL", () => {
    expect(matchPattern("/api/items", "http://localhost:8000/api/items", PAGE)).toBeUndefined();
    expect(matchPattern("http://localhost:8000/api/items/:id", "http://localhost:8000/api/items/7", PAGE)).toEqual({ id: "7" });
    expect(matchPattern("*/api/items", "https://api.example.com/api/items", PAGE)).toEqual({});
    expect(matchPattern("/api/items", "/api/items", PAGE)).toEqual({});
  });
});

describe("a request's call site", () => {
  it("is the first stack frame outside Unframed's own scripts, as a path in the app with its line and column", () => {
    const stack = [
      "Error",
      "    at window.fetch (http://localhost:4100/__unframed/bridge.js?state=abc:12:40)",
      "    at loadItems (http://localhost:4100/src/api/items.ts?t=1700000000:7:10)",
      "    at http://localhost:4100/src/main.tsx:3:1",
    ].join("\n");
    expect(callSiteOf(stack)).toBe("src/api/items.ts:7:10");
    expect(callSiteOf("loadItems@http://localhost:4100/src/api.js:4:2\n")).toBe("src/api.js:4:2");
    expect(callSiteOf("    at http://localhost:4100/@fs/Users/me/app/src/a.ts:1:2")).toBe("Users/me/app/src/a.ts:1:2");
    expect(callSiteOf("Error\n    at <anonymous>")).toBeNull();
  });
});

describe("switches on a Screen's route", () => {
  it("read every name:option pair from the switch parameter", () => {
    expect(switchesOf("?tab=1&__unframed_switch=items:empty,user:admin&__unframed_switch=theme%3Adark", SWITCH_PARAM)).toEqual({ items: "empty", user: "admin", theme: "dark" });
    expect(switchesOf("", SWITCH_PARAM)).toEqual({});
  });
});

describe("the restore parameter", () => {
  it("is taken off a request on its way to the dev server, with the switch parameter, keeping the rest of the query and the hash", () => {
    expect(takeUnframedParams(`/todos?tab=2&__unframed_restore=${ID}&__unframed_switch=items:empty#top`)).toEqual({ path: "/todos?tab=2#top", restore: ID });
    expect(takeUnframedParams("/todos")).toEqual({ path: "/todos", restore: undefined });
    expect(takeUnframedParams("/todos?__unframed_restore=../../etc")).toEqual({ path: "/todos", restore: undefined });
  });

  it("is written onto a frozen location, replacing an older one, and read back", () => {
    const route = restoreRoute("/todos?tab=2#top", ID);
    expect(route).toBe(`/todos?tab=2&__unframed_restore=${ID}#top`);
    expect(restoreIdOf(route)).toBe(ID);
    expect(restoreRoute(route, `s_${"b".repeat(32)}`)).toBe(`/todos?tab=2&__unframed_restore=s_${"b".repeat(32)}#top`);
    expect(withoutRestore(route)).toBe("/todos?tab=2#top");
    expect(restoreIdOf("/todos")).toBeUndefined();
  });

  it("carries a frozen payload into the page as script data that cannot close the script tag", () => {
    const prefix = restorePrefix({ url: "/", local: { note: "</script><b>" }, session: {}, collections: {}, fields: [] });
    expect(prefix).not.toContain("</script>");
    expect(prefix.startsWith("window.__unframedRestore = ")).toBe(true);
  });

  it("keeps only well-formed frozen payloads", () => {
    expect(frozenState({ url: "/a", local: { a: "1", b: 2 }, session: null, collections: { items: [{ id: 1 }], bad: 3 }, fields: [{ path: "#q", value: "pears" }, { path: 1 }] })).toEqual({
      url: "/a",
      local: { a: "1" },
      session: {},
      collections: { items: [{ id: 1 }] },
      fields: [{ path: "#q", value: "pears" }],
    });
    expect(frozenState({ url: "http://elsewhere/" })).toBeUndefined();
    expect(frozenState("nope")).toBeUndefined();
  });
});

describe("module replacement", () => {
  it("looks for a replacement under the module's path with a .js extension, never outside the folder", () => {
    expect(mockModulePaths("/src/rpc/engine.ts")).toEqual(["src/rpc/engine.js", "src/rpc/engine.mjs", "src/rpc/engine.ts"]);
    expect(mockModulePaths("/src/util.js")).toEqual(["src/util.js", "src/util.mjs"]);
    expect(mockModulePaths("/src/../../secret.ts")).toEqual([]);
    expect(mockModulePaths("/__unframed/bridge.js")).toEqual([]);
    expect(mockModulePaths("/")).toEqual([]);
  });
});

describe("mock file names and the request log", () => {
  it("accept only plain .mock.js names", () => {
    expect(isMockFileName("items.mock.js")).toBe(true);
    expect(isMockFileName("../items.mock.js")).toBe(false);
    expect(isMockFileName("items.js")).toBe(false);
  });

  it("keep the last entries and drop malformed ones", () => {
    const entry = { at: 1, method: "GET", url: "/api/items", status: 200, mock: "items.mock.js: GET /api/items", site: "src/api.ts:1:1" };
    expect(mockLogEntries([entry, { method: 3 }, "x"])).toEqual([entry]);
    const many = Array.from({ length: MOCK_LOG_KEEP + 5 }, (_, at) => ({ ...entry, at }));
    const kept = mockLogKept(many.slice(0, 10), many.slice(10));
    expect(kept).toHaveLength(MOCK_LOG_KEEP);
    expect(kept[0]!.at).toBe(5);
  });

  it("serialise the runtime with each file wrapped in its own loader call, using nothing from outside the page", () => {
    const source = mockRuntimeSource([{ name: "items.mock.js", source: "unframed.mock(() => {});" }]);
    expect(source).toContain('window.__unframedMockFiles && window.__unframedMockFiles.load("items.mock.js", function (unframed) {\nunframed.mock(() => {});\n});');
    expect(() => new Function(source)).not.toThrow();
    const errors: unknown[] = [];
    const location = { origin: "http://localhost:4100", href: "http://localhost:4100/a?__unframed_switch=items:empty", search: "?__unframed_switch=items:empty", pathname: "/a", hash: "", host: "localhost:4100", protocol: "http:" };
    const win: Record<string, unknown> = { location, document: { currentScript: null, readyState: "complete" }, setTimeout, URL, console: { error: (...args: unknown[]) => errors.push(args) } };
    new Function("window", "console", source)(win, win.console);
    expect(errors).toEqual([]);
    expect((win.__unframedMockFiles as { picked: () => unknown }).picked()).toEqual({ items: "empty" });
  });
});

describe("the runtime in a page its mock files do not answer", () => {
  const pageWith = (files: ReadonlyArray<{ readonly name: string; readonly source: string }>) => {
    const sent: string[] = [];
    class Xhr extends EventTarget {
      readyState = 0;
      status = 0;
      responseText = "";
      sync = false;
      open(_method: string, url: string, async = true) {
        this.readyState = 1;
        this.sync = !async;
        sent.push(`open ${url}`);
      }
      setRequestHeader() {}
      send() {
        sent.push(`send ${this.readyState}`);
        if (this.sync) {
          this.readyState = 4;
          this.status = 200;
          this.responseText = "real";
        }
      }
      abort() {
        sent.push("abort");
      }
    }
    class Socket {
      readonly url: string;
      constructor(url: string) {
        this.url = url;
      }
    }
    const location = { origin: PAGE, href: `${PAGE}/`, search: "", pathname: "/", hash: "", host: "localhost:4100", protocol: "http:" };
    const win: Record<string, unknown> = { location, document: { currentScript: null, readyState: "complete" }, setTimeout, URL, EventTarget, XMLHttpRequest: Xhr, WebSocket: Socket, console };
    new Function("window", "console", mockRuntimeSource(files))(win, win.console);
    return { win: win as { XMLHttpRequest: typeof Xhr; WebSocket: new (url: string) => unknown }, sent, Socket };
  };

  it("sends a synchronous XHR at once, with its answer ready when send returns", () => {
    const { win } = pageWith([{ name: "items.mock.js", source: 'unframed.mock(({ http }) => { http.get("/api/items", () => []); });' }]);
    const xhr = new win.XMLHttpRequest();
    xhr.open("GET", "/api/config", false);
    xhr.send();
    expect([xhr.readyState, xhr.status, xhr.responseText]).toEqual([4, 200, "real"]);
  });

  it("never sends an XHR the page aborted right after sending it", async () => {
    const { win, sent } = pageWith([]);
    const xhr = new win.XMLHttpRequest();
    xhr.open("GET", "/api/slow");
    xhr.send();
    xhr.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent).toEqual(["open /api/slow", "send 1", "abort"]);
  });

  it("keeps a real socket an instance of the page's WebSocket", () => {
    const { win, Socket } = pageWith([]);
    const socket = new win.WebSocket("ws://localhost:4100/live");
    expect(socket).toBeInstanceOf(Socket);
    expect(socket).toBeInstanceOf(win.WebSocket);
  });
});
