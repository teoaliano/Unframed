import { describe, expect, it } from "vitest";
import { analyseRepository, importClosure, mergeStatesIndex, routeFor, stateCasesOf, statesIndexOf, type CodeRoute } from "../../src/index.ts";

const tree = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("a route's import closure", () => {
  it("follows relative, aliased, re-exported and lazy imports, and leaves packages and styles out", () => {
    const files = tree({
      "tsconfig.json": '{\n  // the app\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], "#lib": ["./src/lib/index.ts"] }, },\n}',
      "src/pages/Home.tsx": [
        'import React from "react";',
        'import { List } from "@/components/List";',
        'import type { Item } from "../types.js";',
        'import "./home.css";',
        'import {',
        "  helper,",
        '} from "#lib";',
        'const Settings = lazy(() => import("./Settings"));',
      ].join("\n"),
      "src/components/List.tsx": 'export * from "./ListItem";\nimport { useItems } from "src/hooks/useItems";',
      "src/components/ListItem/index.tsx": "",
      "src/hooks/useItems.ts": "",
      "src/types.ts": "",
      "src/lib/index.ts": "",
      "src/pages/Settings.tsx": 'import { Home } from "./Home";',
      "src/pages/home.css": "",
    });
    expect(importClosure(files, "src/pages/Home.tsx")).toEqual([
      "src/pages/Home.tsx",
      "src/components/List.tsx",
      "src/types.ts",
      "src/lib/index.ts",
      "src/pages/Settings.tsx",
      "src/components/ListItem/index.tsx",
      "src/hooks/useItems.ts",
    ]);
    expect(importClosure(files, "src/pages/Home.tsx", 3)).toHaveLength(3);
    expect(importClosure(files, "missing.ts")).toEqual([]);
  });

  it("falls back to @/ and ~/ meaning src/ when the project declares no paths", () => {
    const files = tree({ "src/a.tsx": 'import { b } from "@/b";\nimport c from "~/c";', "src/b.ts": "", "src/c/index.jsx": "" });
    expect(importClosure(files, "src/a.tsx")).toEqual(["src/a.tsx", "src/b.ts", "src/c/index.jsx"]);
  });
});

describe("the visible cases in a file", () => {
  it("names each case with its line and what it reads", () => {
    const source = [
      'import { isLoading } from "./x";',
      "// if (isLoading) return null;",
      "export function Projects() {",
      "  const query = useProjects();",
      "  if (query.isLoading) return <Skeleton className='h-4' />;",
      "  if (query.error) return <ErrorState error={query.error} />;",
      "  if (projects.length === 0) return <EmptyProjects />;",
      "  const canEdit = user?.role === 'admin';",
      '  if (!session) return <Navigate to="/login" />;',
      "  switch (project.status) {",
      '    case "archived":',
      "      return null;",
      "  }",
      "  return (",
      "    <>",
      "      {items.length > 0 ? <List /> : null}",
      "      <Dialog open={isOpen} onOpenChange={setOpen} />",
      "      {showWelcome && <Welcome />}",
      '      {order.status === "failed" && <Retry />}',
      "      <Suspense fallback={<Spinner />}><Lazy /></Suspense>",
      "    </>",
      "  );",
      "}",
      "try { run(); } catch (error) { console.error(error); }",
      "/*",
      "  if (error) return null;",
      "*/",
    ].join("\n");
    expect(stateCasesOf("src/Projects.tsx", source).map((found) => [found.line, found.kind, found.reads])).toEqual([
      [5, "loading", "Skeleton"],
      [6, "error", "ErrorState"],
      [7, "empty", "projects.length"],
      [8, "role", "user.role"],
      [9, "auth", "session"],
      [11, "status", "project.status"],
      [16, "empty", "items.length"],
      [17, "dialog", "isOpen"],
      [18, "firstrun", "showWelcome"],
      [19, "status", "order.status"],
      [20, "loading", "Spinner"],
    ]);
    expect(stateCasesOf("a.ts", "if (query.isLoading) {}")[0]).toEqual({ kind: "loading", reads: "query.isLoading", file: "a.ts", line: 1, text: "if (query.isLoading) {}" });
    expect(stateCasesOf("a.ts", `if (x.error) { ${"y".repeat(300)} }`)[0]!.text).toHaveLength(160);
  });
});

describe("the states index", () => {
  const route = (path: string, file: string, extra: Partial<CodeRoute> = {}): CodeRoute => ({ path, file, line: 1, params: [], group: "g", name: "N", source: "files", layouts: [], ...extra });
  const files = tree({
    "app/layout.tsx": "export default function L() { if (!user) return null; }",
    "app/page.tsx": 'import { List } from "./List";\nexport default function P() { if (loading) return null; }',
    "app/List.tsx": "export const List = () => items.length === 0 ? <Empty /> : null;",
    "app/settings/page.tsx": "export default function S() { return <Modal open={open} /> }",
    "src/router.tsx": "",
    "src/Projects.tsx": "if (isError) {}",
  });

  it("lists each route's cases from its file, its layouts and everything they import", () => {
    const index = statesIndexOf(files, [route("/", "app/page.tsx", { layouts: ["app/layout.tsx"] }), route("/projects", "src/router.tsx", { entry: "src/Projects.tsx", source: "config" })]);
    expect(index.routes.map((entry) => ({ route: entry.route, files: entry.files, cases: entry.cases.map((found) => `${found.file}:${found.line} ${found.kind}`), prepared: entry.prepared }))).toEqual([
      { route: "/", files: 3, cases: ["app/page.tsx:2 loading", "app/List.tsx:1 empty", "app/layout.tsx:1 auth"], prepared: [] },
      { route: "/projects", files: 1, cases: ["src/Projects.tsx:1 error"], prepared: [] },
    ]);
  });

  it("matches a page's path to its route, preferring a fixed path over a parameter", () => {
    const index = { routes: [{ route: "/" }, { route: "/projects/:id" }, { route: "/projects/new" }, { route: "/docs/:slug*" }] };
    expect(routeFor(index, "/projects/42?tab=1#top")).toBe("/projects/:id");
    expect(routeFor(index, "/projects/new")).toBe("/projects/new");
    expect(routeFor(index, "/docs/a/b")).toBe("/docs/:slug*");
    expect(routeFor(index, "/")).toBe("/");
    expect(routeFor(index, "/elsewhere")).toBeUndefined();
  });

  it("keeps the states an agent prepared when the index is built again", () => {
    const prepared = [{ state: "no projects", route: "/", steps: [], mocks: [{ url: "/api/projects", body: "[]" }] }];
    const before = { version: 1 as const, routes: [{ route: "/", files: 1, cases: [], prepared }, { route: "/gone", files: 0, cases: [], prepared }] };
    const after = mergeStatesIndex(before, statesIndexOf(files, [route("/", "app/page.tsx"), route("/settings", "app/settings/page.tsx")]));
    expect(after.routes.map((entry) => [entry.route, entry.prepared])).toEqual([
      ["/", prepared],
      ["/settings", []],
    ]);
  });

  it("puts it all together, keeping what an agent added last time", () => {
    const repo = tree({ "package.json": '{"dependencies":{"next":"15"}}', "app/page.tsx": "if (isLoading) {}", "app/globals.css": ":root { --bg: #fff; }" });
    const first = analyseRepository(repo);
    expect(first.codeMap.routes.map((entry) => entry.path)).toEqual(["/"]);
    expect(first.designSystem.tokens.map((token) => token.name)).toEqual(["--bg"]);
    expect(first.states.routes[0]!.cases.map((found) => found.kind)).toEqual(["loading"]);
    const prepared = [{ state: "loading", route: "/", steps: [], mocks: [] }];
    const again = analyseRepository(repo, { codeMap: { ...first.codeMap, notes: "kept" }, states: { version: 1, routes: [{ ...first.states.routes[0]!, prepared }] } });
    expect(again.codeMap.notes).toBe("kept");
    expect(again.states.routes[0]!.prepared).toEqual(prepared);
  });
});
