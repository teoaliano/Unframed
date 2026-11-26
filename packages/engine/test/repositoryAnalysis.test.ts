import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { toolResults } from "./agentCanvas.ts";
import { chromeOnMachine as chrome } from "./chrome.ts";
import { git } from "./gitRepos.ts";
import { outsideLink } from "./outsideCalls.ts";
import { makeTempDir } from "./harness.ts";
import { startRepositoryAgent, stateTurn, type RepositoryAgent } from "./repositoryAgent.ts";

export const ROUTER_APP: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify({
    name: "router-app",
    private: true,
    scripts: { dev: "node server.js", postinstall: "node install.js" },
  }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
  "src/main.tsx": [
    'import { createBrowserRouter, RouterProvider } from "react-router-dom";',
    'import { Home } from "./pages/Home";',
    'import { Posts } from "./pages/Posts";',
    'import { Post } from "./pages/Post";',
    "const router = createBrowserRouter([",
    '  { path: "/", element: <Home /> },',
    '  { path: "/app", element: <Home /> },',
    '  { path: "/posts", element: <Posts /> },',
    '  { path: "/posts/:id", element: <Post /> },',
    "]);",
    "export const App = () => <RouterProvider router={router} />;",
    "",
  ].join("\n"),
  "src/pages/Home.tsx": ['import { Button } from "@/components/ui/button";', "export function Home() {", '  return <Button variant="ghost">Menu</Button>;', "}", ""].join("\n"),
  "src/pages/Posts.tsx": [
    'import { Button } from "@/components/ui/button";',
    'import { usePosts } from "../api/posts";',
    "export function Posts() {",
    "  const { data, isLoading, error } = usePosts();",
    "  if (isLoading) return <p>Loading</p>;",
    "  if (error) return <p>Could not load posts</p>;",
    "  if (data.length === 0) return <p>No posts yet</p>;",
    "  return <Button>New post</Button>;",
    "}",
    "",
  ].join("\n"),
  "src/pages/Post.tsx": ["export function Post() {", "  return <article>Post</article>;", "}", ""].join("\n"),
  "src/api/posts.ts": ["export const usePosts = () => ({ data: [], isLoading: false, error: null });", ""].join("\n"),
  "src/components/ui/button.tsx": [
    'import { cva, type VariantProps } from "class-variance-authority";',
    'const buttonVariants = cva("rounded", { variants: { variant: { default: "bg-primary", ghost: "bg-transparent" }, size: { sm: "h-8", lg: "h-12" } } });',
    "export interface ButtonProps extends VariantProps<typeof buttonVariants> {",
    "  children?: React.ReactNode;",
    "  disabled?: boolean;",
    "}",
    "export function Button({ variant, size, children }: ButtonProps) {",
    "  return <button className={buttonVariants({ variant, size })}>{children}</button>;",
    "}",
    "",
  ].join("\n"),
  "src/index.css": ['@import "tailwindcss";', "@theme {", "  --color-primary: oklch(0.6 0.2 250);", "  --radius-card: 12px;", "}", ""].join("\n"),
};

const write = async (agent: RepositoryAgent, path: string, content: string) => {
  const full = join(agent.instance.worktree, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
};

const screensOf = (records: any[]) => records.filter((record) => record.typeName === "shape" && record.type === "screen");

describe("repository analysis", () => {
  it("writes the Code map, the Design-system index and the States index into the worktree, excluded from git, and answers them", { timeout: 90_000 }, async () => {
    const agent = await startRepositoryAgent({}, {}, ROUTER_APP);
    const chat = await stateTurn(agent, [
      { name: "repo_analyse", input: {} },
      { name: "code_map_read", input: { section: "routes" } },
      { name: "design_search", input: { query: "button" } },
      { name: "route_states", input: { route: "/posts" } },
      { name: "route_states", input: { route: "/posts/42" } },
    ]);
    const [analysed] = toolResults(chat, "repo_analyse");
    expect(analysed).toMatchObject({ status: "completed", result: { instance: agent.instance.id, stack: { language: "ts" } } });
    expect(analysed!.result.routes.map((route: any) => route.path)).toEqual(["/", "/app", "/posts", "/posts/:id"]);
    expect(analysed!.result.components).toBeGreaterThan(0);
    for (const file of ["code-map.json", "design-system.json", "states.json"]) JSON.parse(await readFile(join(agent.instance.worktree, ".unframed/analysis", file), "utf8"));
    expect(await readFile(join(agent.root, ".git/info/exclude"), "utf8")).toContain("/.unframed/analysis/code-map.json");
    expect(git(agent.instance.worktree, "status", "--porcelain")).toBe("");

    const [routes] = toolResults(chat, "code_map_read");
    expect(Object.keys(routes!.result)).toEqual(["routes"]);
    expect(routes!.result.routes.find((route: any) => route.path === "/posts/:id")).toMatchObject({ file: "src/main.tsx", params: ["id"], group: "posts" });

    const [search] = toolResults(chat, "design_search");
    expect(search!.result.components[0]).toMatchObject({ name: "Button", file: "src/components/ui/button.tsx", variants: { variant: ["default", "ghost"], size: ["sm", "lg"] }, uses: 2 });

    const [posts, post] = toolResults(chat, "route_states");
    expect(posts!.result.route).toBe("/posts");
    expect(new Set(posts!.result.cases.map((found: any) => found.kind))).toEqual(new Set(["loading", "error", "empty"]));
    expect(posts!.result.cases.find((found: any) => found.kind === "empty")).toMatchObject({ file: "src/pages/Posts.tsx", line: 7, reads: expect.stringContaining("data.length") });
    expect(post!.result).toMatchObject({ route: "/posts/:id", prepared: [] });
  });

  it("keeps what the agent added to the Code map when it runs again, and places Screens for routes in labelled groups", { timeout: 90_000 }, async () => {
    const agent = await startRepositoryAgent({}, {}, ROUTER_APP);
    await stateTurn(agent, [{ name: "repo_analyse", input: {} }]);
    const path = join(agent.instance.worktree, ".unframed/analysis/code-map.json");
    const map = JSON.parse(await readFile(path, "utf8"));
    map.features = [{ name: "Posts", files: ["src/pages/Posts.tsx"], routes: ["/posts"] }];
    map.notes = "A blog.";
    map.routes = map.routes.map((route: any) => (route.path === "/posts/:id" ? { ...route, example: "/posts/1" } : route));
    await writeFile(path, JSON.stringify(map));

    const chat = await stateTurn(agent, [
      { name: "repo_analyse", input: {} },
      { name: "code_map_read", input: {} },
      { name: "screens_place", input: { shapeId: agent.screen.id.replace(/^shape:/, "") } },
      { name: "screens_place", input: {} },
    ]);
    const [read] = toolResults(chat, "code_map_read");
    expect(read!.result).toMatchObject({ features: [{ name: "Posts" }], notes: "A blog." });
    expect(read!.result.routes.find((route: any) => route.path === "/posts/:id").example).toBe("/posts/1");

    const [placed, again] = toolResults(chat, "screens_place");
    expect(placed!.result.placed).toEqual(["/app", "/posts", "/posts/1"]);
    expect(placed!.result.skipped).toEqual([{ path: "/", reason: "already on the canvas" }]);
    expect(again!.result.placed).toEqual([]);

    const records = await agent.records();
    const frames = records.filter((record) => record.type === "frame");
    expect(frames.map((frame) => frame.props.name).sort()).toEqual(["App", "Posts"]);
    const posts = frames.find((frame) => frame.props.name === "Posts");
    const inPosts = screensOf(records).filter((screen) => screen.parentId === posts.id);
    expect(inPosts.map((screen) => [screen.props.route, screen.props.title])).toEqual([
      ["/posts", "Posts"],
      ["/posts/1", "Posts"],
    ]);
    for (const screen of inPosts) expect(screen.props).toMatchObject({ instance: agent.instance.id, w: agent.screen.props.w, h: agent.screen.props.h });
  });

  it("places a Screen per route when the person confirms Setup", { timeout: 90_000 }, async () => {
    const agent = await startRepositoryAgent({}, {}, ROUTER_APP);
    const repository = (await agent.rpc.call("repositories.read", { project: agent.project })).repository;
    expect(repository.setupChat).toEqual(expect.any(String));
    await agent.rpc.call("repositories.setupVerdict", { project: agent.project, accepted: true });
    const routes = screensOf(await agent.records()).map((screen) => screen.props.route).sort();
    expect(routes).toEqual(["/", "/app", "/posts"]);
  });
});

describe("outside agents", () => {
  it("get the analysis tools on a Repository, without the ones that prove states, and are refused them on a Whiteboard", { timeout: 90_000 }, async () => {
    const agent = await startRepositoryAgent({}, {}, ROUTER_APP);
    await agent.rpc.call("projects.create", { name: "board" });
    const link = await outsideLink(agent as never);
    const session = await link.open();
    const names = (await link.list(session)).map((tool) => tool.name);
    for (const name of ["repo_analyse", "code_map_read", "design_search", "route_states", "mocks_read", "mock_write", "screens_place", "instance_patch"]) expect(names).toContain(name);
    for (const name of ["states_place", "state_freeze", "screen_state", "instance_create", "setup_save"]) expect(names).not.toContain(name);
    const read = await link.call(session, "code_map_read", { project: agent.project, section: "routes" });
    expect(read.isError).toBe(false);
    expect(read.value.routes.map((route: any) => route.path)).toEqual(["/", "/app", "/posts", "/posts/:id"]);
    const refused = await link.call(session, "code_map_read", { project: "board" });
    expect(refused).toMatchObject({ isError: true, value: { error: expect.stringMatching(/Repository/) } });
  });
});

describe.skipIf(chrome === undefined)("states of a route", () => {
  it("are proven, saved as the route's prepared states and laid out beside the Screen, and Show states places them again", { timeout: 150_000 }, async () => {
    const agent = await startRepositoryAgent({}, {}, ROUTER_APP);
    await agent.rpc.call("instances.start", { project: agent.project, id: agent.instance.id });
    await agent.rpc.call("testCanvas.apply", { project: agent.project, change: { put: [{ ...agent.screen, props: { ...agent.screen.props, route: "/app" } }], remove: [] }, origin: { kind: "server", id: "test" } });
    const screen = agent.screen.id.replace(/^shape:/, "");
    const shown = await agent.rpc.call("screens.showStates", { project: agent.project, shape: agent.screen.id });
    expect(shown).toEqual({ placed: 0, cases: expect.any(Number), route: "/app" });

    const chat = await stateTurn(agent, [
      {
        name: "states_place",
        input: {
          shapeId: screen,
          states: [
            { state: "an empty list", mocks: [{ url: "/api/items", body: [] }], steps: [{ action: "wait", target: { text: "No items yet" } }], case: "src/pages/Home.tsx empty" },
            { state: "a failed list", mocks: [{ url: "/api/items", fail: true }], steps: [{ action: "wait", target: { text: "Could not load items" } }] },
          ],
        },
      },
      { name: "states_place", input: { shapeId: screen, states: [{ state: "never", steps: [{ action: "wait", target: { text: "Not on the page" } }] }] } },
    ]);
    const [placed, refused] = toolResults(chat, "states_place");
    expect(placed).toMatchObject({ status: "completed", result: { route: "/app", screens: [expect.any(String), expect.any(String)] } });
    expect(refused).toMatchObject({ status: "failed", result: { state: 1 } });
    const states = JSON.parse(await readFile(join(agent.instance.worktree, ".unframed/analysis/states.json"), "utf8"));
    expect(states.routes.find((entry: any) => entry.route === "/app").prepared.map((recipe: any) => recipe.state)).toEqual(["an empty list", "a failed list"]);

    let records = await agent.records();
    const frame = records.find((record) => record.type === "frame" && record.props.name === "/app states");
    const placedScreens = screensOf(records).filter((record) => record.parentId === frame.id);
    expect(placedScreens.map((record) => record.props.state)).toEqual(["an empty list", "a failed list"]);
    expect(frame.y).toBeGreaterThan(agent.screen.y + agent.screen.props.h);

    await agent.rpc.call("testCanvas.apply", { project: agent.project, change: { put: [], remove: [frame.id, ...placedScreens.map((record) => record.id)] }, origin: { kind: "server", id: "test" } });
    expect(await agent.rpc.call("screens.showStates", { project: agent.project, shape: agent.screen.id })).toEqual({ placed: 2, cases: expect.any(Number), route: "/app" });
    records = await agent.records();
    expect(screensOf(records).filter((record) => record.props.state !== undefined).map((record) => record.props.state)).toEqual(["an empty list", "a failed list"]);
  });
});

describe("the take-home patch", () => {
  it("holds committed, staged, unstaged and new files against the base, leaves Unframed's and ignored files out, and applies on the base", { timeout: 90_000 }, async () => {
    const agent = await startRepositoryAgent();
    const worktree = agent.instance.worktree;
    await writeFile(join(worktree, "committed.txt"), "committed\n");
    git(worktree, "add", "committed.txt");
    git(worktree, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "work");
    await writeFile(join(worktree, "src/pages/index.html"), "<h1>Hello again</h1>\n");
    await writeFile(join(worktree, "staged.txt"), "staged\n");
    git(worktree, "add", "staged.txt");
    await writeFile(join(worktree, "new.bin"), Buffer.from([0, 1, 2, 3, 255]));
    await write(agent, ".unframed/mocks/a.mock.js", "unframed.mock(() => {});\n");
    await write(agent, ".unframed/notes.txt", "mine\n");
    await writeFile(join(worktree, ".env.local"), "SECRET=1\n");

    const patch = await agent.rpc.call("instances.patch", { project: agent.project, id: agent.instance.id });
    expect(patch.files.map((file: any) => file.path).sort()).toEqual(["committed.txt", "new.bin", "src/pages/index.html", "staged.txt"]);
    expect(patch.patch).not.toContain(".unframed");
    expect(patch.patch).not.toContain("SECRET");
    expect(git(worktree, "diff", "--cached", "--name-only").trim()).toBe("staged.txt");

    const clone = join(await makeTempDir("unframed-patch-"), "clone");
    git(agent.root, "worktree", "add", "--detach", clone, patch.base);
    execFileSync("git", ["apply", "--binary", "-"], { cwd: clone, input: patch.patch });
    for (const file of ["committed.txt", "staged.txt", "src/pages/index.html", "new.bin"]) expect(await readFile(join(clone, file))).toEqual(await readFile(join(worktree, file)));
  });
});
