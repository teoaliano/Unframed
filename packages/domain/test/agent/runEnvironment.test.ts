import { describe, expect, it } from "vitest";
import { mergePath, resolveWindowsCommand, runEnvironment, shellPathFromOutput } from "../../src/index.ts";

describe("PATH hydration", () => {
  it("keeps the process's entries first and appends the shell's without duplicates", () => {
    expect(mergePath("/usr/bin:/bin", "/opt/homebrew/bin:/usr/bin:/Users/me/.npm/bin")).toBe("/usr/bin:/bin:/opt/homebrew/bin:/Users/me/.npm/bin");
  });

  it("drops empty entries and copes with a missing side", () => {
    expect(mergePath(undefined, "/a::/b")).toBe("/a:/b");
    expect(mergePath("/a:", undefined)).toBe("/a");
  });

  it("reads the last non-empty line of the login shell's output", () => {
    expect(shellPathFromOutput("Welcome to zsh\n/opt/homebrew/bin:/usr/bin\n\n")).toBe("/opt/homebrew/bin:/usr/bin");
    expect(shellPathFromOutput("\n \n")).toBeUndefined();
  });
});

describe("the run environment", () => {
  const base = { path: "/usr/bin", claudeConfigDir: "", osHome: "/Users/os" };

  it("never overrides a present HOME", () => {
    expect(runEnvironment({ ...base, env: { HOME: "/Users/me" } }).HOME).toBe("/Users/me");
  });

  it("fills a missing HOME from the OS", () => {
    expect(runEnvironment({ ...base, env: {} }).HOME).toBe("/Users/os");
    expect(runEnvironment({ ...base, env: { HOME: "" } }).HOME).toBe("/Users/os");
  });

  it("sets CLAUDE_CONFIG_DIR only when the setting is not empty", () => {
    expect(runEnvironment({ ...base, env: { CLAUDE_CONFIG_DIR: "/stale" } })).not.toHaveProperty("CLAUDE_CONFIG_DIR");
    expect(runEnvironment({ ...base, claudeConfigDir: "/Users/me/.claude-work", env: {} }).CLAUDE_CONFIG_DIR).toBe("/Users/me/.claude-work");
  });

  it("uses the hydrated PATH and keeps everything else", () => {
    expect(runEnvironment({ ...base, env: { PATH: "/old", LANG: "en_GB.UTF-8" } })).toMatchObject({ PATH: "/usr/bin", LANG: "en_GB.UTF-8" });
  });
});

describe("Windows shims", () => {
  const files = (...paths: string[]) => {
    const set = new Set(paths.map((path) => path.toLowerCase()));
    return (path: string) => set.has(path.toLowerCase());
  };
  const lookup = (exists: (path: string) => boolean) => ({ pathDirs: ["C:\\Tools", "C:\\npm"], pathext: ".COM;.EXE;.BAT;.CMD", exists });

  it("finds a name on PATH with PATHEXT", () => {
    expect(resolveWindowsCommand("claude", lookup(files("C:\\npm\\claude.exe")))).toBe("C:\\npm\\claude.exe");
  });

  it("follows a .cmd launcher to the package's claude.exe first", () => {
    const exists = files("C:\\npm\\claude.cmd", "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe", "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js");
    expect(resolveWindowsCommand("claude", lookup(exists))).toBe("C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe");
  });

  it("falls back to cli.js beside a .bat or .ps1 launcher", () => {
    const exists = files("C:\\npm\\claude.bat", "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js");
    expect(resolveWindowsCommand("claude", lookup(exists))).toBe("C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js");
    const ps1 = { pathDirs: ["C:\\npm"], pathext: ".PS1", exists: files("C:\\npm\\claude.ps1", "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js") };
    expect(resolveWindowsCommand("claude", ps1)).toBe("C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js");
  });

  it("spawns the bare name when nothing is found, so the failure reads as ENOENT", () => {
    expect(resolveWindowsCommand("claude", lookup(files()))).toBe("claude");
    expect(resolveWindowsCommand("claude", lookup(files("C:\\npm\\claude.cmd")))).toBe("claude");
  });

  it("leaves a path alone", () => {
    expect(resolveWindowsCommand("D:\\bin\\claude.exe", lookup(files()))).toBe("D:\\bin\\claude.exe");
  });
});
