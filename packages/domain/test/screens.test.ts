import type { Instance } from "@unframed/contracts";
import { describe, expect, it } from "vitest";
import { NO_RUN_COMMAND, addScreenParameterInstruction, applyScreenParametersInstruction, forkBranchName, logTail, normaliseRoute, screenOverlay, screenSnapshotName, screenUrl, SCREEN_VIEWPORTS, setupTag } from "../src/index.ts";

const instance = (state: Instance["state"], extra: Partial<Instance> = {}): Instance => ({
  id: "abc123",
  repository: "my-app",
  branch: "trunk",
  baseRef: "trunk",
  worktree: "/w",
  state,
  proxyPort: state === "live" ? 4100 : null,
  upstreamPort: null,
  error: null,
  log: "",
  changes: 0,
  ...extra,
});

describe("Screens", () => {
  it("point at the proxy on 127.0.0.1 with the route", () => {
    expect(screenUrl(4100, "/")).toBe("http://127.0.0.1:4100/");
    expect(screenUrl(4100, "/settings?tab=2#top")).toBe("http://127.0.0.1:4100/settings?tab=2#top");
  });

  it.each<[string, string | undefined]>([
    ["/", "/"],
    ["about", "/about"],
    ["  /a/b?x=1#y  ", "/a/b?x=1#y"],
    ["http://localhost:3000/dash?x=1", "/dash?x=1"],
    ["http://127.0.0.1:4100/", "/"],
    ["https://example.com/a", undefined],
    ["//evil.com", undefined],
    ["/with space", undefined],
    ["", undefined],
  ])("take the route %j as %j", (input, expected) => {
    expect(normaliseRoute(input)).toBe(expected);
  });

  it("offer viewports from phone to desktop, desktop first", () => {
    expect(SCREEN_VIEWPORTS[0]).toEqual({ name: "Desktop", w: 1280, h: 800 });
    expect(SCREEN_VIEWPORTS.map((viewport) => viewport.name)).toEqual(["Desktop", "Laptop", "Tablet", "Phone"]);
  });

  it("show Setup's progress, a failure with its log tail, a removed Instance or a missing Repository over the picture", () => {
    expect(screenOverlay({ instance: instance("creating"), loaded: true, repository: "setting-up" })).toEqual({ kind: "progress", label: "Creating the worktree…" });
    expect(screenOverlay({ instance: instance("installing"), loaded: true, repository: "ready" })).toEqual({ kind: "progress", label: "Installing dependencies…" });
    expect(screenOverlay({ instance: instance("starting"), loaded: true, repository: "ready" })).toEqual({ kind: "progress", label: "Starting the dev server…" });
    expect(screenOverlay({ instance: instance("failed", { error: "The setup command failed with code 1.", log: "a\nb\nc" }), loaded: true, repository: "ready" })).toEqual({
      kind: "failed",
      message: "The setup command failed with code 1.",
      log: "a\nb\nc",
    });
    expect(screenOverlay({ instance: instance("removed"), loaded: true, repository: "ready" })).toEqual({ kind: "removed", label: "Worktree removed" });
    expect(screenOverlay({ instance: undefined, loaded: true, repository: "ready" })).toEqual({ kind: "removed", label: "Worktree removed" });
    expect(screenOverlay({ instance: undefined, loaded: false, repository: undefined })).toEqual({ kind: "none" });
    expect(screenOverlay({ instance: instance("live"), loaded: true, repository: "missing" })).toEqual({ kind: "missing", label: "Repository not found" });
    expect(screenOverlay({ instance: instance("live"), loaded: true, repository: "ready" })).toEqual({ kind: "none" });
    expect(screenOverlay({ instance: instance("stopped"), loaded: true, repository: "ready" })).toEqual({ kind: "none" });
  });

  it("show Setup at work instead of a failure while it finds the run command", () => {
    const noRun = instance("failed", { error: NO_RUN_COMMAND });
    expect(screenOverlay({ instance: noRun, loaded: true, repository: "setting-up", setupChat: "running" })).toEqual({
      kind: "progress",
      label: "Setup is finding how to run this repository…",
      detail: "Follow along in the Setup chat.",
    });
    expect(screenOverlay({ instance: instance("stopped"), loaded: true, repository: "setting-up", setupChat: "running" })).toMatchObject({ kind: "progress" });
    expect(screenOverlay({ instance: noRun, loaded: true, repository: "setting-up", setupChat: "asking" })).toEqual({
      kind: "waiting",
      label: "Setup needs your answer",
      detail: "Reply in the Setup chat to keep it going.",
    });
    expect(screenOverlay({ instance: noRun, loaded: true, repository: "setting-up", setupChat: "idle" })).toEqual({
      kind: "waiting",
      label: "Setup has not found how to run this repository yet",
      detail: "Open the Setup chat to keep it going.",
    });
    expect(screenOverlay({ instance: noRun, loaded: true, repository: "setting-up" })).toMatchObject({ kind: "waiting" });
    expect(screenOverlay({ instance: instance("stopped"), loaded: true, repository: "ready", setupChat: "running" })).toEqual({ kind: "none" });
    expect(screenOverlay({ instance: instance("failed", { error: "The dev server exited with code 1." }), loaded: true, repository: "ready", setupChat: "running" })).toMatchObject({ kind: "failed" });
  });

  it("keep the last lines of a log", () => {
    expect(logTail("1\n2\n3\n4\n5\n6\n7\n8\n", 3)).toBe("6\n7\n8");
    expect(logTail("", 3)).toBe("");
  });

  it("tag mocks and list warnings from the Repository's Setup", () => {
    expect(setupTag(null)).toBeUndefined();
    const setup = { setupCommand: "", runCommand: "", packageManager: "npm" as const, portMode: { mode: "free" as const }, files: [], mocks: ["mock user", "fixtures"], warnings: [] };
    expect(setupTag(setup)).toBe("mock user · fixtures");
    expect(setupTag({ ...setup, mocks: [] })).toBeUndefined();
  });

  it("suggest a fork's branch that is not taken", () => {
    expect(forkBranchName("feature/login", [])).toBe("feature/login-2");
    expect(forkBranchName("feature/login", ["feature/login-2", "feature/login-3"])).toBe("feature/login-4");
    expect(forkBranchName("feature/login-2", ["feature/login-2"])).toBe("feature/login-3");
  });

  it("name a Screen's snapshot after its shape, and nothing else", () => {
    expect(screenSnapshotName("shape:abc_D-1")).toBe("abc_D-1.png");
    expect(screenSnapshotName("shape:../x")).toBeUndefined();
  });
});

describe("Screen parameter instructions", () => {
  const screen = { route: "/settings", branch: "try/darker", worktree: "/data/worktrees/my-app/try-darker-ab12" };

  it("ask to apply values in the Instance's worktree, guarded and uncommitted", () => {
    const text = applyScreenParametersInstruction({ ...screen, name: "Look", values: { accent: "#ff0000", scene: { speed: 2 } } });
    expect(text).toContain('Update the unframed.dials configuration for "Look" in the app shown at /settings on the branch "try/darker"');
    expect(text).toContain('"scene.speed": 2');
    expect(text).toContain("Work in the Instance's worktree at /data/worktrees/my-app/try-darker-ab12, and nowhere else.");
    expect(text).toContain("leave the change uncommitted");
  });

  it("ask to add a parameter, or several", () => {
    expect(addScreenParameterInstruction({ ...screen, wanted: " the accent colour " })).toMatch(/^Add the accent colour as a parameter in the app shown at \/settings/);
    expect(addScreenParameterInstruction({ ...screen, wanted: "accent and radius" })).toMatch(/^Add accent and radius as parameters/);
  });
});
