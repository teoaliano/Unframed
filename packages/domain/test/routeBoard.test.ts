import { describe, expect, it } from "vitest";
import { mockFileSummary, placeableRoutes, routeBoardLayout, SCREEN_GAP, statesFrameName, type CodeRoute } from "../src/index.ts";

const route = (path: string, extra: Partial<CodeRoute> = {}): CodeRoute => {
  const params = [...path.matchAll(/:([A-Za-z_]+)/g)].map((found) => found[1]!);
  const first = path.split("/").filter((part) => part !== "" && !part.startsWith(":"))[0];
  return { path, file: "src/routes.tsx", line: 1, params, group: first ?? "home", name: first ?? "Home", source: "config", layouts: [], ...extra };
};

describe("routes placed on the canvas", () => {
  it("place every static route and each dynamic route that has an example, and say why the others were skipped", () => {
    const routes = [route("/"), route("/posts"), route("/posts/:id", { example: "/posts/1" }), route("/users/:id"), route("/settings")];
    const { place, skipped } = placeableRoutes(routes, { shown: new Set(["/settings"]) });
    expect(place.map((entry) => entry.path)).toEqual(["/", "/posts", "/posts/1"]);
    expect(place[2]).toEqual({ path: "/posts/1", group: "posts", name: "posts" });
    expect(skipped).toEqual([
      { path: "/users/:id", reason: "a dynamic route with no example" },
      { path: "/settings", reason: "already on the canvas" },
    ]);
  });

  it("take asked paths, naming them from the route they fit, and stop at the most one call places", () => {
    const routes = [route("/posts/:id"), route("/files/:path*")];
    const { place, skipped } = placeableRoutes(routes, { asked: ["/posts/7", "/files/a/b", "/new-thing", "nope", "/posts/7"], shown: new Set(), most: 3 });
    expect(place).toEqual([
      { path: "/posts/7", group: "posts", name: "posts" },
      { path: "/files/a/b", group: "files", name: "files" },
      { path: "/new-thing", group: "new-thing", name: "New Thing" },
    ]);
    expect(skipped).toEqual([{ path: "nope", reason: "not a path in the app" }]);
    expect(placeableRoutes([route("/a"), route("/b")], { shown: new Set(), most: 1 }).skipped).toEqual([{ path: "/b", reason: "more than 1 Screens in one call" }]);
  });

  it("lay groups out as labelled frames stacked one under another", () => {
    const board = routeBoardLayout({ x: 100, y: 200, w: 390, h: 844, routes: [
      { path: "/", group: "home", name: "Home" },
      { path: "/posts", group: "posts", name: "Posts" },
      { path: "/posts/1", group: "posts", name: "Posts" },
    ] });
    expect(board.frames.map((frame) => [frame.name, frame.screens.length])).toEqual([["Home", 1], ["Posts", 2]]);
    const [home, posts] = board.frames;
    expect(home!.x).toBe(100);
    expect(home!.y).toBe(200);
    expect(posts!.y).toBe(home!.y + home!.h + 2 * SCREEN_GAP);
    expect(posts!.screens[1]!.x).toBeGreaterThan(posts!.screens[0]!.x);
  });

  it("name a route's states frame after the route without its restore id", () => {
    expect(statesFrameName(`/items?__unframed_restore=s_${"a".repeat(32)}`)).toBe("/items states");
  });
});

describe("a mock file's summary", () => {
  it("lists its handlers, sockets, Collections and Switches from its source", () => {
    const source = [
      "unframed.mock(({ http, ws, data, switches, reply }) => {",
      "  const items = data('items', [{ id: 1 }]);",
      "  const list = switches(\"items\", [\"full\", 'empty', `error`]);",
      "  http.get('/api/items', () => (list === 'empty' ? [] : items.all()));",
      "  http.post(\"/api/items\", ({ body }) => items.insert(body));",
      "  http.any(`*/graphql`, () => reply.pass());",
      "  ws('/live', ({ send }) => send('hi'));",
      "});",
    ].join("\n");
    expect(mockFileSummary("items.mock.js", source)).toEqual({
      file: "items.mock.js",
      handlers: [
        { method: "GET", pattern: "/api/items" },
        { method: "POST", pattern: "/api/items" },
        { method: "ANY", pattern: "*/graphql" },
      ],
      sockets: ["/live"],
      collections: ["items"],
      switches: [{ name: "items", options: ["full", "empty", "error"] }],
    });
  });
});
