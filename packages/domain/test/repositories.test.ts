import { describe, expect, it } from "vitest";
import { gitRoots, hasUncommittedChanges, projectKindOf, repositoryProjectName, repositoryStatus } from "../src/index.ts";

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
