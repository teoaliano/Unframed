import { describe, expect, it } from "vitest";
import { analysedPath, discoverRoutes } from "../../src/index.ts";

const tree = (entries: Record<string, string>) => new Map(Object.entries(entries));
const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) => JSON.stringify({ dependencies: deps, devDependencies: dev });
const paths = (files: Map<string, string>) => discoverRoutes(files).routes.map((route) => route.path);

describe("which files the analysis reads", () => {
  it("reads source, styles and config, and skips builds, dependencies, tests and Unframed's own files", () => {
    for (const path of ["src/App.tsx", "app/page.js", "src/styles/globals.css", "package.json", "tsconfig.json", "tailwind.config.ts", "src/routes/+page.svelte", "pages/index.vue", "src/pages/about.astro"]) expect(analysedPath(path)).toBe(true);
    for (const path of ["node_modules/react/index.js", "dist/main.js", ".next/server.js", ".unframed/mocks/a.mock.js", "src/App.test.tsx", "src/Button.stories.tsx", "src/env.d.ts", "README.md", "public/logo.png", "src/__tests__/a.ts"]) expect(analysedPath(path)).toBe(false);
  });
});

describe("routes from the file system", () => {
  it("reads the Next app router: groups dropped, slots and private folders skipped, dynamic segments, layouts", () => {
    const files = tree({
      "package.json": pkg({ next: "15", react: "19" }),
      "src/app/layout.tsx": "export default function Root() {}",
      "src/app/page.tsx": "export default function Home() {}",
      "src/app/(marketing)/pricing/page.tsx": "",
      "src/app/dashboard/layout.tsx": "",
      "src/app/dashboard/projects/[id]/page.tsx": "",
      "src/app/docs/[...slug]/page.mdx": "",
      "src/app/shop/[[...rest]]/page.tsx": "",
      "src/app/@modal/login/page.tsx": "",
      "src/app/_parts/page.tsx": "",
      "src/app/api/route.ts": "",
    });
    const { routes, stack } = discoverRoutes(files);
    expect(routes.map((route) => route.path)).toEqual(["/", "/dashboard/projects/:id", "/docs/:slug*", "/pricing", "/shop/:rest*"]);
    expect(routes.find((route) => route.path === "/dashboard/projects/:id")).toMatchObject({
      file: "src/app/dashboard/projects/[id]/page.tsx",
      params: ["id"],
      group: "dashboard",
      name: "Projects",
      source: "files",
      layouts: ["src/app/layout.tsx", "src/app/dashboard/layout.tsx"],
    });
    expect(routes[0]).toMatchObject({ group: "home", name: "Home" });
    expect(stack).toMatchObject({ framework: "next", router: "next-app", language: "ts" });
  });

  it("reads the Next pages router without the special files and the API", () => {
    const files = tree({
      "package.json": pkg({ next: "13" }),
      "pages/index.jsx": "",
      "pages/_app.jsx": "",
      "pages/_document.jsx": "",
      "pages/api/hello.js": "",
      "pages/blog/index.jsx": "",
      "pages/blog/[slug].jsx": "",
      "pages/account-settings.jsx": "",
    });
    const { routes, stack } = discoverRoutes(files);
    expect(routes.map((route) => route.path)).toEqual(["/", "/account-settings", "/blog", "/blog/:slug"]);
    expect(routes.find((route) => route.path === "/account-settings")!.name).toBe("Account Settings");
    expect(stack).toMatchObject({ router: "next-pages", language: "js" });
  });

  it("reads flat route files", () => {
    const files = tree({
      "package.json": pkg({ "@remix-run/react": "2" }),
      "app/root.tsx": "",
      "app/routes/_index.tsx": "",
      "app/routes/posts.$id.tsx": "",
      "app/routes/posts_.$id.edit.tsx": "",
      "app/routes/_auth.login.tsx": "",
      "app/routes/($lang).about.tsx": "",
      "app/routes/files.$.tsx": "",
      "app/routes/settings/route.tsx": "",
    });
    expect(paths(files)).toEqual(["/", "/about", "/files/:splat*", "/login", "/posts/:id", "/posts/:id/edit", "/settings"]);
    expect(discoverRoutes(files).routes[0]!.layouts).toEqual(["app/root.tsx"]);
  });

  it("reads SvelteKit, Nuxt and Astro pages", () => {
    expect(paths(tree({ "package.json": pkg({}, { "@sveltejs/kit": "2" }), "src/routes/+page.svelte": "", "src/routes/+layout.svelte": "", "src/routes/(app)/items/[id]/+page.svelte": "" }))).toEqual(["/", "/items/:id"]);
    expect(paths(tree({ "package.json": pkg({ nuxt: "3" }), "pages/index.vue": "", "pages/users/[id].vue": "" }))).toEqual(["/", "/users/:id"]);
    expect(paths(tree({ "package.json": pkg({ astro: "4" }), "src/pages/index.astro": "", "src/pages/blog/[slug].astro": "" }))).toEqual(["/", "/blog/:slug"]);
  });

  it("reads file routes declared in code", () => {
    const files = tree({
      "package.json": pkg({ "@tanstack/react-router": "1" }),
      "src/routes/index.tsx": "export const Route = createFileRoute('/')({ component: Home })",
      "src/routes/posts.$postId.tsx": "export const Route = createFileRoute('/posts/$postId')({})",
      "src/routes/_layout/settings.tsx": "export const Route = createFileRoute('/_layout/settings')({})",
    });
    expect(discoverRoutes(files).routes.map((route) => [route.path, route.line])).toEqual([
      ["/", 1],
      ["/posts/:postId", 1],
      ["/settings", 1],
    ]);
    expect(discoverRoutes(files).stack.router).toBe("tanstack-router");
  });
});

describe("routes from router config", () => {
  it("reads nested route objects, joins children to parents, and finds the component each renders", () => {
    const router = [
      'import { createBrowserRouter } from "react-router-dom";',
      'import Layout from "./Layout";',
      'import { Projects } from "@/pages/Projects";',
      'const Settings = lazy(() => import("./pages/Settings"));',
      "export const router = createBrowserRouter([",
      "  {",
      '    path: "/",',
      "    element: <Layout />,",
      "    children: [",
      "      { index: true, element: <Home /> },",
      '      { path: "projects", element: <Projects />, children: [{ path: ":id", lazy: () => import("./pages/Project") }] },',
      '      { path: "settings", element: <Settings /> },',
      '      { path: "*", element: <NotFound /> },',
      "    ],",
      "  },",
      '  { path: "/login", Component: Login },',
      "]);",
    ].join("\n");
    const files = tree({
      "package.json": pkg({ react: "19", "react-router-dom": "6", vite: "6" }),
      "tsconfig.json": '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      "src/router.tsx": router,
      "src/Layout.tsx": "",
      "src/pages/Projects.tsx": "",
      "src/pages/Project.tsx": "",
      "src/pages/Settings.tsx": "",
    });
    const { routes, stack } = discoverRoutes(files);
    expect(routes.map((route) => [route.path, route.line, route.entry])).toEqual([
      ["/", 7, "src/Layout.tsx"],
      ["/login", 16, undefined],
      ["/projects", 11, "src/pages/Projects.tsx"],
      ["/projects/:id", 11, "src/pages/Project.tsx"],
      ["/settings", 12, "src/pages/Settings.tsx"],
    ]);
    expect(routes.every((route) => route.source === "config" && route.file === "src/router.tsx")).toBe(true);
    expect(stack).toMatchObject({ framework: "vite", router: "react-router" });
  });

  it("reads nested <Route> elements", () => {
    const app = [
      'import Dashboard from "./Dashboard";',
      "export function App() {",
      "  return (",
      "    <Routes>",
      '      <Route path="/" element={<Shell title="a > b" />}>',
      "        <Route index element={<Home />} />",
      '        <Route path="dashboard" element={<Dashboard />} />',
      '        <Route path="teams/:teamId">',
      '          <Route path="members" element={<Members />} />',
      "        </Route>",
      "      </Route>",
      '      <Route path="/about" element={<About />} />',
      "    </Routes>",
      "  );",
      "}",
    ].join("\n");
    const files = tree({ "package.json": pkg({ "react-router-dom": "6" }), "src/App.tsx": app, "src/Dashboard.tsx": "" });
    expect(discoverRoutes(files).routes.map((route) => [route.path, route.line])).toEqual([
      ["/", 5],
      ["/about", 12],
      ["/dashboard", 7],
      ["/teams/:teamId", 8],
      ["/teams/:teamId/members", 9],
    ]);
    expect(discoverRoutes(files).routes.find((route) => route.path === "/dashboard")!.entry).toBe("src/Dashboard.tsx");
  });

  it("falls back to one route at the entry of an app with no router", () => {
    const files = tree({ "package.json": pkg({ react: "19" }, { vite: "6", tailwindcss: "4" }), "src/main.tsx": "", "src/App.tsx": "", "src/Card.module.css": ".a{}" });
    const { routes, stack } = discoverRoutes(files);
    expect(routes).toEqual([{ path: "/", file: "src/main.tsx", line: 1, params: [], group: "home", name: "Home", source: "files", layouts: [] }]);
    expect(stack).toEqual({ framework: "vite", router: "none", language: "ts", styling: ["tailwind", "css-modules"], libraries: [] });
  });

  it("names the libraries the app uses", () => {
    const files = tree({
      "package.json": pkg({ "@radix-ui/react-dialog": "1", "class-variance-authority": "0.7", "@tanstack/react-query": "5", zustand: "4", "@trpc/client": "11" }),
      "components.json": "{}",
    });
    expect(discoverRoutes(files).stack.libraries).toEqual(["radix", "shadcn", "cva", "tanstack-query", "zustand", "trpc"]);
  });
});
