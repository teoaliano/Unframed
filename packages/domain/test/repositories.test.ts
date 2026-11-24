import { describe, expect, it } from "vitest";
import { gitRoots, hasUncommittedChanges, projectKindOf, repositoryProjectName, repositoryStatus, setupCard } from "../src/index.ts";

describe("repository rules", () => {
  it("reads a project's kind, whiteboard unless it says repository", () => {
    expect(projectKindOf("repository")).toBe("repository");
    for (const value of ["whiteboard", undefined, null, "", "Repository", 1]) expect(projectKindOf(value)).toBe("whiteboard");
  });

  it("names a repository after its root folder", () => {
    expect(repositoryProjectName("/Users/me/code/My App")).toBe("my-app");
    expect(repositoryProjectName("/Users/me/code/shop/")).toBe("shop");
    expect(repositoryProjectName("C:\\code\\Site")).toBe("site");
  });

  it("reads the root and common dir from rev-parse, refusing anything short", () => {
    expect(gitRoots("/repo\n/repo/.git\n")).toEqual({ root: "/repo", gitCommonDir: "/repo/.git" });
    expect(gitRoots("/repo\n")).toBeUndefined();
    expect(gitRoots("")).toBeUndefined();
  });

  it("calls a checkout dirty when porcelain status lists anything", () => {
    expect(hasUncommittedChanges("")).toBe(false);
    expect(hasUncommittedChanges(" M package.json\n")).toBe(true);
  });

  it("answers missing when the root is gone, else what was stored", () => {
    expect(repositoryStatus("ready", true)).toBe("ready");
    expect(repositoryStatus("setting-up", false)).toBe("missing");
  });
});

describe("the Setup card", () => {
  const activity = (kind: string, turnId: string, summary = "") => ({ kind, turnId, summary });
  const base = { chatId: "setup", setupChat: "setup" };

  it("asks for the login while the turn waits on it, and offers Looks right once the turn that proposed done has settled", () => {
    const asked = [activity("setup.login.requested", "t1", "Log in to Acme.")];
    expect(setupCard({ ...base, activities: asked, latestTurn: { turnId: "t1", state: "running" } })).toEqual({ kind: "login", message: "Log in to Acme." });
    expect(setupCard({ ...base, activities: [...asked, activity("setup.login.resolved", "t1")], latestTurn: { turnId: "t1", state: "running" } })).toEqual({ kind: "none" });
    const proposed = [activity("setup.proposed", "t2")];
    expect(setupCard({ ...base, activities: proposed, latestTurn: { turnId: "t2", state: "running" } })).toEqual({ kind: "none" });
    expect(setupCard({ ...base, activities: proposed, latestTurn: { turnId: "t2", state: "completed" } })).toEqual({ kind: "proposed" });
    expect(setupCard({ ...base, activities: proposed, latestTurn: { turnId: "t3", state: "completed" } })).toEqual({ kind: "none" });
  });

  it("shows nothing in a chat that is not the open Setup", () => {
    const proposed = [activity("setup.proposed", "t2")];
    expect(setupCard({ chatId: "other", setupChat: "setup", activities: proposed, latestTurn: { turnId: "t2", state: "completed" } })).toEqual({ kind: "none" });
    expect(setupCard({ chatId: "setup", setupChat: null, activities: proposed, latestTurn: { turnId: "t2", state: "completed" } })).toEqual({ kind: "none" });
  });
});
