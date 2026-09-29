import { describe, expect, it } from "vitest";
import { LARGE_PASTE_BYTES, pasteBecomesFile, pastedTextFileName, searchSlashCommands, type SlashItem } from "../../src/index.ts";

describe("the large paste rule", () => {
  it("turns a paste of 32 KiB or more into a file, counted as characters", () => {
    expect(LARGE_PASTE_BYTES).toBe(32 * 1024);
    expect(pasteBecomesFile("a".repeat(32 * 1024 - 1))).toBe(false);
    expect(pasteBecomesFile("a".repeat(32 * 1024))).toBe(true);
  });

  it("or counted as UTF-8 bytes, so fewer characters of a wide script are enough", () => {
    const wide = "é".repeat(16 * 1024);
    expect(wide.length).toBe(16 * 1024);
    expect(pasteBecomesFile(wide)).toBe(true);
    expect(pasteBecomesFile("é".repeat(16 * 1024 - 1))).toBe(false);
  });

  it("and any paste that would take the draft past 120,000 characters", () => {
    expect(pasteBecomesFile("short", 119_995)).toBe(false);
    expect(pasteBecomesFile("short!", 119_995)).toBe(true);
  });

  it("names the files pasted-text.txt, then pasted-text-2.txt, pasted-text-3.txt", () => {
    expect(pastedTextFileName([])).toBe("pasted-text.txt");
    expect(pastedTextFileName(["notes.txt"])).toBe("pasted-text.txt");
    expect(pastedTextFileName(["pasted-text.txt"])).toBe("pasted-text-2.txt");
    expect(pastedTextFileName(["pasted-text.txt", "pasted-text-2.txt"])).toBe("pasted-text-3.txt");
    expect(pastedTextFileName(["pasted-text-2.txt"])).toBe("pasted-text.txt");
  });
});

describe("slash command ranking", () => {
  const item = (kind: SlashItem["kind"], name: string, description = ""): SlashItem => ({ kind, name, description });
  const names = (query: string, items: SlashItem[]) => searchSlashCommands(query, items).map((each) => each.name);

  it("strips the leading slash and ranks exact, prefix, word-boundary, substring, then fuzzy on the name", () => {
    const items = [item("provider", "fuzzy-p-l-a-n"), item("provider", "my-plan"), item("provider", "explanation"), item("provider", "planner"), item("provider", "plan")];
    expect(names("/plan", items)).toEqual(["plan", "planner", "my-plan", "explanation", "fuzzy-p-l-a-n"]);
    expect(names("plan", items)).toEqual(["plan", "planner", "my-plan", "explanation", "fuzzy-p-l-a-n"]);
  });

  it("puts description matches after every name match", () => {
    const items = [item("provider", "review", "Plan a review"), item("provider", "pxlxaxn")];
    expect(names("plan", items)).toEqual(["pxlxaxn", "review"]);
  });

  it("breaks ties built-ins first, then provider commands, then skills", () => {
    const items = [item("skill", "model"), item("provider", "model"), item("builtin", "model")];
    expect(searchSlashCommands("model", items).map((each) => each.kind)).toEqual(["builtin", "provider", "skill"]);
  });

  it("counts word boundaries at -, _ and /", () => {
    const items = [item("provider", "deep/review"), item("provider", "run_review"), item("provider", "quick-review"), item("provider", "previewer")];
    expect(names("review", items).slice(0, 3).sort()).toEqual(["deep/review", "quick-review", "run_review"]);
    expect(names("review", items).at(-1)).toBe("previewer");
  });

  it("lists everything as given for an empty query, and nothing that does not match", () => {
    const items = [item("builtin", "model"), item("builtin", "plan")];
    expect(names("/", items)).toEqual(["model", "plan"]);
    expect(names("zzz", items)).toEqual([]);
  });
});
