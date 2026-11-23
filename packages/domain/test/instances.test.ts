import { describe, expect, it } from "vitest";
import {
  appendLogTail,
  branchSlug,
  copiedEnvFiles,
  defaultInstanceBranch,
  inferredSetup,
  listenedPorts,
  mergeExclude,
  shapeRunCommand,
  worktreePath,
} from "../src/index.ts";

describe("run command shaping", () => {
  const scripts = { dev: "next dev", vite: "vite", rr: "react-router dev", kit: "vite dev --host", cra: "react-scripts start", astro: "astro dev" };

  it.each([
    ["npm run dev", "npm run dev -- --port 4100"],
    ["bun run dev", "bun run dev -- --port 4100"],
    ["pnpm dev", "pnpm dev --port 4100"],
    ["pnpm run dev", "pnpm run dev --port 4100"],
    ["yarn dev", "yarn dev --port 4100"],
  ])("shapes %j as %j, with PORT in the environment", (command, shaped) => {
    expect(shapeRunCommand({ command, port: 4100, scripts })).toEqual({ command: shaped, env: { PORT: "4100" } });
  });

  it("adds --strictPort for the Vite family", () => {
    expect(shapeRunCommand({ command: "npm run vite", port: 4100, scripts }).command).toBe("npm run vite -- --port 4100 --strictPort");
    expect(shapeRunCommand({ command: "pnpm rr", port: 4100, scripts }).command).toBe("pnpm rr --port 4100 --strictPort");
    expect(shapeRunCommand({ command: "yarn run kit", port: 4100, scripts }).command).toBe("yarn run kit --port 4100 --strictPort");
    expect(shapeRunCommand({ command: "npx vite", port: 4100, scripts }).command).toBe("npx vite --port 4100 --strictPort");
    expect(shapeRunCommand({ command: "npm run astro", port: 4100, scripts }).command).toBe("npm run astro -- --port 4100");
  });

  it("passes no flag to Create React App, which only reads PORT", () => {
    expect(shapeRunCommand({ command: "npm run cra", port: 4100, scripts })).toEqual({ command: "npm run cra", env: { PORT: "4100" } });
  });

  it("never adds a second -- for npm and bun", () => {
    expect(shapeRunCommand({ command: "npm run dev -- --turbo", port: 4100, scripts }).command).toBe("npm run dev -- --turbo --port 4100");
  });

  it("appends the flag to a command that runs no script", () => {
    expect(shapeRunCommand({ command: "node server.js", port: 4100, scripts }).command).toBe("node server.js --port 4100");
    expect(shapeRunCommand({ command: "  npm run dev  ", port: 4100, scripts }).command).toBe("npm run dev -- --port 4100");
  });
});

describe("worktree paths", () => {
  it("puts a worktree under the data folder, by repository, branch slug and short id", () => {
    expect(worktreePath("/data", "my-app", "feature/Big Idea!", "a1b2c3d4")).toBe("/data/worktrees/my-app/feature-big-idea-a1b2c3d4");
    expect(worktreePath("/data", "my-app", defaultInstanceBranch("a1b2c3d4"), "a1b2c3d4")).toBe("/data/worktrees/my-app/unframed-a1b2c3d4-a1b2c3d4");
  });

  it("slugs a branch to a short folder name", () => {
    expect(branchSlug("unframed/x")).toBe("unframed-x");
    expect(branchSlug("---")).toBe("branch");
    expect(branchSlug("a".repeat(80))).toHaveLength(40);
  });

  it("generates unframed/<id> as the default branch", () => {
    expect(defaultInstanceBranch("a1b2c3d4")).toBe("unframed/a1b2c3d4");
  });
});

describe("the exclude file", () => {
  it("appends missing entries, each once, keeping what was there", () => {
    const existing = "# git ls-files --others --exclude-from=.git/info/exclude\n*.log\n";
    const merged = mergeExclude(existing, ["/.env.local", "/.unframed/", "*.log", "/.env.local"]);
    expect(merged).toBe(`${existing}/.env.local\n/.unframed/\n`);
    expect(mergeExclude(merged, ["/.unframed/", "/.env.local"])).toBe(merged);
  });

  it("adds a newline to a file that lacks one, and starts an empty file cleanly", () => {
    expect(mergeExclude("*.log", ["/.env"])).toBe("*.log\n/.env\n");
    expect(mergeExclude("", ["/.env"])).toBe("/.env\n");
    expect(mergeExclude("", [])).toBe("");
  });
});

describe("env files to copy", () => {
  it("keeps .env files anywhere but in node_modules", () => {
    expect(copiedEnvFiles([".env", ".env.local", "apps/web/.env.development.local", "node_modules/x/.env", "src/env.ts", ".envrc", "secrets/.npmrc"])).toEqual([
      ".env",
      ".env.local",
      "apps/web/.env.development.local",
      ".envrc",
    ]);
  });
});

describe("the setup before Setup", () => {
  it("installs and runs dev with the package manager the lockfile names", () => {
    const pkg = JSON.stringify({ scripts: { dev: "vite", start: "node ." } });
    expect(inferredSetup({ packageJson: pkg, files: ["package.json", "pnpm-lock.yaml"] })).toEqual({
      setupCommand: "pnpm install",
      runCommand: "pnpm run dev",
      packageManager: "pnpm",
      portMode: { mode: "free" },
      files: [],
      mocks: [],
      warnings: [],
    });
    expect(inferredSetup({ packageJson: pkg, files: ["yarn.lock"] })?.runCommand).toBe("yarn run dev");
    expect(inferredSetup({ packageJson: pkg, files: ["bun.lock"] })?.packageManager).toBe("bun");
    expect(inferredSetup({ packageJson: pkg, files: [] })?.setupCommand).toBe("npm install");
  });

  it("prefers the packageManager field, falls back to start, and answers nothing without a package.json", () => {
    expect(inferredSetup({ packageJson: JSON.stringify({ packageManager: "yarn@4.1.0", scripts: { start: "x" } }), files: ["package-lock.json"] })).toMatchObject({
      packageManager: "yarn",
      runCommand: "yarn run start",
    });
    expect(inferredSetup({ packageJson: JSON.stringify({}), files: [] })?.runCommand).toBe("");
    expect(inferredSetup({ packageJson: "{ nope", files: [] })?.runCommand).toBe("");
    expect(inferredSetup({ packageJson: undefined, files: [] })).toBeNull();
  });
});

describe("dev server output", () => {
  it("reads the ports a server says it listens on, through colour codes", () => {
    const vite = "\u001b[32m  ➜  \u001b[39m\u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5174\u001b[22m/\u001b[39m\n";
    expect(listenedPorts(vite)).toEqual([5174]);
    expect(listenedPorts("   - Local:        http://localhost:3000\n   - Network:      http://192.168.1.4:3000\n")).toEqual([3000]);
    expect(listenedPorts("http://127.0.0.1:4100/ and http://[::1]:4101")).toEqual([4100, 4101]);
    expect(listenedPorts("Port 3000 is in use, trying another one...")).toEqual([]);
  });

  it("keeps only the tail of the log", () => {
    expect(appendLogTail("abc", "def", 4)).toBe("cdef");
    expect(appendLogTail("", "hello", 10)).toBe("hello");
  });
});
