import { describe, expect, it } from "vitest";
import {
  appendRestoredPrompt,
  contextMeter,
  createTypingGuard,
  followUpAction,
  formatTokens,
  implementPlanText,
  LARGE_PASTE_BYTES,
  mergeRestored,
  pasteBecomesFile,
  pastedTextFileName,
  promptHistoryEntries,
  recallablePrompt,
  searchSlashCommands,
  stepPromptHistory,
  TYPING_IDLE_MS,
  updateTypingGuard,
  type PromptHistoryEntry,
  type SlashItem,
} from "../../src/index.ts";

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

describe("the context window meter", () => {
  it("reads the share used, with one decimal under 10 %", () => {
    expect(contextMeter({ usedTokens: 50_000, maxTokens: 200_000 })).toMatchObject({ percent: 25, percentText: "25%", label: "Context window 25% used" });
    expect(contextMeter({ usedTokens: 9_500, maxTokens: 200_000 }).percentText).toBe("4.8%");
    expect(contextMeter({ usedTokens: 10_000, maxTokens: 200_000 }).percentText).toBe("5%");
    expect(contextMeter({ usedTokens: 19_900, maxTokens: 200_000 }).percentText).toBe("10%");
    expect(contextMeter({ usedTokens: 250_000, maxTokens: 200_000 }).percent).toBe(100);
  });

  it("counts tokens with no known maximum", () => {
    expect(contextMeter({ usedTokens: 12_345 })).toMatchObject({ percent: null, percentText: null, maxText: null, label: "Context window 12k tokens used" });
  });

  it("formats tokens as N, N.Nk, Nk and N.Nm", () => {
    expect([formatTokens(950), formatTokens(1_000), formatTokens(1_250), formatTokens(9_950), formatTokens(12_400), formatTokens(999_499), formatTokens(1_000_000), formatTokens(2_350_000)]).toEqual([
      "950",
      "1k",
      "1.3k",
      "9.9k",
      "12k",
      "999k",
      "1m",
      "2.4m",
    ]);
    expect(contextMeter({ usedTokens: 150_000, maxTokens: 200_000 })).toMatchObject({ usedText: "150k", maxText: "200k" });
  });

  it("turns red above 90 %", () => {
    expect(contextMeter({ usedTokens: 180_000, maxTokens: 200_000 }).overloaded).toBe(false);
    expect(contextMeter({ usedTokens: 180_001, maxTokens: 200_000 }).overloaded).toBe(true);
  });

  it("names the total processed only when there is one", () => {
    expect(contextMeter({ usedTokens: 1, maxTokens: 10, totalProcessedTokens: 45_000 }).totalProcessedText).toBe("45k");
    expect(contextMeter({ usedTokens: 1, maxTokens: 10 }).totalProcessedText).toBeNull();
  });
});

describe("restoring into a draft", () => {
  it("puts the restored prompt after the current one, a blank line between", () => {
    expect(appendRestoredPrompt("", "back again")).toBe("back again");
    expect(appendRestoredPrompt("  \n", "back again")).toBe("back again");
    expect(appendRestoredPrompt("still typing  \n", "back again")).toBe("still typing\n\nback again");
    expect(appendRestoredPrompt("still typing", "")).toBe("still typing");
  });

  it("keeps the draft's chips and attachments and adds only the ones it lacks", () => {
    const a = { id: "a.png" };
    const b = { id: "b.pdf" };
    expect(mergeRestored(["shape:1", "shape:2"], ["shape:2", "shape:3"], (id) => id)).toEqual(["shape:1", "shape:2", "shape:3"]);
    expect(mergeRestored([a], [b, { id: "a.png" }], (item) => item.id)).toEqual([a, b]);
  });
});

describe("prompt history", () => {
  const user = (id: string, text: string) => ({ id, role: "user" as const, text });
  const prompts = (entries: ReadonlyArray<PromptHistoryEntry>) => entries.map((entry) => entry.prompt);

  it("recalls only the person's messages, and a repeat once", () => {
    const entries = promptHistoryEntries([
      user("m1", "make it red"),
      { id: "m2", role: "assistant" as const, text: "Red now." },
      user("m3", "make it blue"),
      user("m4", "make it blue"),
      user("m5", "make it red"),
    ]);
    expect(prompts(entries)).toEqual(["make it red", "make it blue", "make it red"]);
    expect(entries[1]?.id).toBe("m4");
  });

  it("skips implement-plan prompts and attachment-only messages", () => {
    const entries = promptHistoryEntries([user("m1", "plan a page"), user("m2", implementPlanText("# Page\n\nBuild it.")), user("m3", ""), user("m4", "   ")]);
    expect(prompts(entries)).toEqual(["plan a page"]);
  });

  it("strips mention chips, and the space beside them, from what it recalls", () => {
    expect(recallablePrompt("move [Image: still-0.png; ref=shape:i1] left")).toBe("move left");
    expect(recallablePrompt("[Page: Alpha; ref=shape:p1] needs a footer")).toBe("needs a footer");
    expect(recallablePrompt("compare with [File: brief.pdf; ref=brief.pdf]")).toBe("compare with");
    expect(recallablePrompt("use $frontend-design here")).toBe("use $frontend-design here");
    expect(recallablePrompt("[Image: a; ref=shape:a]")).toBe("");
  });

  const entries: PromptHistoryEntry[] = [
    { id: "m1", prompt: "one" },
    { id: "m2", prompt: "two" },
    { id: "m3", prompt: "three" },
  ];

  it("steps back from an empty draft to the newest, then older, and stops at the oldest", () => {
    const first = stepPromptHistory({ direction: "backward", entries, position: null, currentPrompt: "" });
    expect(first?.prompt).toBe("three");
    const second = stepPromptHistory({ direction: "backward", entries, position: first!.position, currentPrompt: "three" });
    expect(second?.prompt).toBe("two");
    const third = stepPromptHistory({ direction: "backward", entries, position: second!.position, currentPrompt: "two" });
    expect(third?.prompt).toBe("one");
    expect(stepPromptHistory({ direction: "backward", entries, position: third!.position, currentPrompt: "one" })).toBeNull();
  });

  it("steps forward to newer ones and past the newest to an empty draft", () => {
    const position = { entryId: "m2", recalled: "two" };
    expect(stepPromptHistory({ direction: "forward", entries, position, currentPrompt: "two" })).toEqual({ position: { entryId: "m3", recalled: "three" }, prompt: "three" });
    expect(stepPromptHistory({ direction: "forward", entries, position: { entryId: "m3", recalled: "three" }, currentPrompt: "three" })).toEqual({ position: null, prompt: "" });
  });

  it("does nothing over a draft of the person's own, or once a recalled one was edited", () => {
    expect(stepPromptHistory({ direction: "backward", entries, position: null, currentPrompt: "typed" })).toBeNull();
    expect(stepPromptHistory({ direction: "forward", entries, position: null, currentPrompt: "" })).toBeNull();
    expect(stepPromptHistory({ direction: "backward", entries, position: { entryId: "m3", recalled: "three" }, currentPrompt: "three edited" })).toBeNull();
  });
});

describe("the follow-up action", () => {
  it("is the setting, and the other one with the modifier", () => {
    expect(followUpAction("queue", false)).toBe("queue");
    expect(followUpAction("queue", true)).toBe("steer");
    expect(followUpAction("steer", false)).toBe("steer");
    expect(followUpAction("steer", true)).toBe("queue");
  });
});

describe("the typing guard", () => {
  const typing = (now: number) => updateTypingGuard(updateTypingGuard(createTypingGuard(), { type: "focus" }), { type: "type", now });

  it("holds a request that arrives within 1.5 s of a keystroke while the composer has focus", () => {
    expect(TYPING_IDLE_MS).toBe(1500);
    const state = updateTypingGuard(typing(1000), { type: "requests", requestIds: ["r1"], now: 1000 + TYPING_IDLE_MS - 1 });
    expect([...state.held]).toEqual(["r1"]);
  });

  it("shows a request at once after a pause, or with the composer blurred", () => {
    expect(updateTypingGuard(typing(1000), { type: "requests", requestIds: ["r1"], now: 1000 + TYPING_IDLE_MS }).held.size).toBe(0);
    const blurred = updateTypingGuard(typing(1000), { type: "blur" });
    expect(updateTypingGuard(blurred, { type: "requests", requestIds: ["r1"], now: 1001 }).held.size).toBe(0);
  });

  it("never holds a request it has already shown", () => {
    const shown = updateTypingGuard(createTypingGuard(), { type: "requests", requestIds: ["r1"], now: 0 });
    const typed = updateTypingGuard(updateTypingGuard(shown, { type: "focus" }), { type: "type", now: 10 });
    expect(updateTypingGuard(typed, { type: "requests", requestIds: ["r1"], now: 20 }).held.size).toBe(0);
  });

  it("lets held requests go on a pause, a send or a blur, and forgets ones that went away", () => {
    const held = updateTypingGuard(typing(0), { type: "requests", requestIds: ["r1", "r2"], now: 10 });
    expect(held.held.size).toBe(2);
    for (const type of ["idle", "send", "blur"] as const) expect(updateTypingGuard(held, { type }).held.size).toBe(0);
    expect([...updateTypingGuard(held, { type: "requests", requestIds: ["r2"], now: 20 }).held]).toEqual(["r2"]);
  });
});
