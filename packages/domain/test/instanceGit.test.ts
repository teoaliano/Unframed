import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMIT_PROMPT_TEMPLATE,
  COMMIT_SYSTEM_PROMPT,
  PR_PROMPT_TEMPLATE,
  PR_SYSTEM_PROMPT,
  commitMessageOf,
  commitPrompt,
  githubRepository,
  limitPatch,
  parseNumstat,
  pullRequestOf,
  pullRequestPrompt,
} from "../src/index.ts";

const asset = readFileSync(join(import.meta.dirname, "../../../assets/prompts/git-actions.md"), "utf8");
const blocks = [...asset.matchAll(/^(`{3,})text\n([\s\S]*?)\n\1$/gm)].map((match) => match[2]!);

describe("an Instance's diff", () => {
  it("reads -z numstat into files sorted by path, binary files without counts", () => {
    expect(parseNumstat("3\t1\tsrc/b.ts\x002\t0\tsrc/a b.ts\x00-\t-\tlogo.png\x00")).toEqual([
      { path: "logo.png", additions: 0, deletions: 0, binary: true },
      { path: "src/a b.ts", additions: 2, deletions: 0, binary: false },
      { path: "src/b.ts", additions: 3, deletions: 1, binary: false },
    ]);
    expect(parseNumstat("")).toEqual([]);
  });

  it("cuts a long patch at the last whole file that fits", () => {
    const one = "diff --git a/a b/a\n+aaaa\n";
    const two = "diff --git a/b b/b\n+bbbb\n";
    expect(limitPatch(one + two, 1000)).toEqual({ patch: one + two, truncated: false });
    expect(limitPatch(one + two, one.length + 5)).toEqual({ patch: one, truncated: true });
  });
});

describe("the git actions' model-facing text", () => {
  it("is the asset's text, with every placeholder filled and $ patterns kept as written", () => {
    expect([COMMIT_SYSTEM_PROMPT, COMMIT_PROMPT_TEMPLATE, PR_SYSTEM_PROMPT, PR_PROMPT_TEMPLATE]).toEqual(blocks);
    const commit = commitPrompt({ branch: "feature/x", files: " a.ts | 2 +-", patch: "+const price = '$&';" });
    expect(commit).not.toMatch(/<branch>|<files>|<patch>/);
    expect(commit).toContain("Branch: feature/x");
    expect(commit).toContain("+const price = '$&';");
    const pr = pullRequestPrompt({ base: "main", head: "feature/x", commits: "Add x", files: "a.ts", patch: "+x" });
    expect(pr).not.toMatch(/<base>|<head>|<commits>|<files>|<patch>/);
    expect(pr).toContain("Base branch: main\nHead branch: feature/x");
  });
});

describe("reading what the provider wrote", () => {
  it("reads a commit message from JSON, even fenced, and falls back to a plain one", () => {
    expect(commitMessageOf('```json\n{"subject":"Add the pricing page.","body":"- adds /pricing"}\n```', ["a"])).toEqual({ subject: "Add the pricing page", body: "- adds /pricing" });
    expect(commitMessageOf(undefined, ["src/a.ts"])).toEqual({ subject: "Update src/a.ts", body: "" });
    expect(commitMessageOf("not json", ["a", "b"])).toEqual({ subject: "Update 2 files", body: "" });
  });

  it("reads a pull request's title and body, and falls back to the commit message", () => {
    expect(pullRequestOf('{"title":"Pricing page","body":"## Summary"}', { subject: "s", body: "b" })).toEqual({ title: "Pricing page", body: "## Summary" });
    expect(pullRequestOf("{}", { subject: "s", body: "b" })).toEqual({ title: "s", body: "b" });
  });

  it("names a GitHub repository from its remote URL in every common form", () => {
    for (const url of ["https://github.com/acme/app.git", "https://github.com/acme/app", "git@github.com:acme/app.git", "ssh://git@github.com/acme/app.git", "https://token@github.com/acme/app/"]) {
      expect(githubRepository(url)).toEqual({ owner: "acme", repo: "app" });
    }
    expect(githubRepository("https://gitlab.com/acme/app.git")).toBeUndefined();
    expect(githubRepository("/tmp/remote.git")).toBeUndefined();
  });
});
