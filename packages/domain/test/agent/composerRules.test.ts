import { describe, expect, it } from "vitest";
import {
  appendRestoredPrompt,
  attachmentChip,
  chipRefs,
  ensureChips,
  readStoredDrafts,
  removeChips,
  RESUME_MESSAGE,
  resumableTurn,
  usageLimitHit,
  stashSnippet,
  withoutChips,
  storedDraftsValue,
  composerKeyIntent,
  composerRequiresModifier,
  contextMeter,
  compactsBeforeSend,
  offersCompactBeforeSend,
  createTypingGuard,
  followUpAction,
  formatTokens,
  implementPlanText,
  LARGE_PASTE_BYTES,
  mergeRestored,
  orderNotices,
  moveQueued,
  pasteBecomesFile,
  pastedTextFileName,
  queuedDropTarget,
  queuedEditBlockedReason,
  promptHistoryEntries,
  recallablePrompt,
  queuedEditChanged,
  resolveQueuedEditExit,
  searchSlashCommands,
  sendShortcutOf,
  stepPromptHistory,
  TYPING_IDLE_MS,
  updateTypingGuard,
  type PromptHistoryEntry,
  type SlashItem,
} from "../../src/index.ts";
import { chatOf, started } from "./chatFixtures.ts";

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

describe("compacting before a send", () => {
  const stale = { provider: "claude", usedTokens: 214_000, updatedAt: "2026-10-27T10:00:00.000Z", now: "2026-10-27T11:10:00.000Z" };

  it("is offered on a Claude chat of 200k tokens or more whose last usage is older than the prompt cache, 70 minutes without a TTL", () => {
    expect(offersCompactBeforeSend(stale)).toBe(true);
    expect(offersCompactBeforeSend({ ...stale, now: "2026-10-27T11:09:59.000Z" })).toBe(false);
    expect(offersCompactBeforeSend({ ...stale, promptCacheTtlMs: 5 * 60_000, now: "2026-10-27T10:05:00.000Z" })).toBe(true);
  });

  it("is not offered below 200k tokens, for Codex, or without a time", () => {
    expect(offersCompactBeforeSend({ ...stale, usedTokens: 199_999 })).toBe(false);
    expect(offersCompactBeforeSend({ ...stale, provider: "codex" })).toBe(false);
    expect(offersCompactBeforeSend({ ...stale, updatedAt: undefined })).toBe(false);
  });

  it("compacts first unless the person chose Full or the message is /compact itself", () => {
    expect(compactsBeforeSend({ tokens: 214_000, keepFullHistory: false, text: "next question" })).toBe(true);
    expect(compactsBeforeSend({ tokens: 214_000, keepFullHistory: true, text: "next question" })).toBe(false);
    expect(compactsBeforeSend({ tokens: null, keepFullHistory: false, text: "next question" })).toBe(false);
    expect(compactsBeforeSend({ tokens: 214_000, keepFullHistory: false, text: "/compact" })).toBe(false);
    expect(compactsBeforeSend({ tokens: 214_000, keepFullHistory: false, text: "/Compact focus on the plan" })).toBe(false);
    expect(compactsBeforeSend({ tokens: 214_000, keepFullHistory: false, text: "/compacted" })).toBe(true);
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

describe("the send shortcut", () => {
  it("reads a stored value, Enter unless it is a known one", () => {
    expect(sendShortcutOf("mod-enter")).toBe("mod-enter");
    expect(sendShortcutOf("mod-enter-multiline")).toBe("mod-enter-multiline");
    expect(sendShortcutOf(undefined)).toBe("enter");
    expect(sendShortcutOf("cmd")).toBe("enter");
  });

  it("asks for Cmd always, or only for a prompt of several lines", () => {
    expect(composerRequiresModifier("enter", "two\nlines")).toBe(false);
    expect(composerRequiresModifier("mod-enter-multiline", "one line")).toBe(false);
    expect(composerRequiresModifier("mod-enter-multiline", "two\nlines")).toBe(true);
    expect(composerRequiresModifier("mod-enter", "one line")).toBe(true);
  });
});

describe("what a key in the composer does", () => {
  const enter = { key: "Enter", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  const base = { mac: false, sendShortcut: "enter" as const, prompt: "one line", running: false, newChat: false };

  it.each([
    ["enter", "one line", false, "foreground"],
    ["enter", "two\nlines", false, "foreground"],
    ["mod-enter-multiline", "one line", false, "foreground"],
    ["mod-enter-multiline", "two\nlines", false, null],
    ["mod-enter-multiline", "two\nlines", true, "foreground"],
    ["mod-enter", "one line", false, null],
    ["mod-enter", "one line", true, "foreground"],
  ] as const)("honours %s for %j (Ctrl held: %s)", (sendShortcut, prompt, ctrlKey, expected) => {
    expect(composerKeyIntent({ ...base, sendShortcut, prompt, key: { ...enter, ctrlKey } })).toBe(expected);
  });

  it("leaves Shift+Enter and Option+Enter to break the line", () => {
    expect(composerKeyIntent({ ...base, key: { ...enter, shiftKey: true } })).toBeNull();
    expect(composerKeyIntent({ ...base, key: { ...enter, altKey: true } })).toBeNull();
  });

  it("never sends while composing, on an IME key or on a held key", () => {
    expect(composerKeyIntent({ ...base, key: { ...enter, isComposing: true } })).toBeNull();
    expect(composerKeyIntent({ ...base, key: { ...enter, keyCode: 229 } })).toBeNull();
    expect(composerKeyIntent({ ...base, key: { ...enter, repeat: true } })).toBeNull();
  });

  it("uses Cmd on a Mac and Ctrl elsewhere for the chords", () => {
    const running = { ...base, running: true };
    expect(composerKeyIntent({ ...running, mac: true, key: { ...enter, metaKey: true } })).toBe("alternate");
    expect(composerKeyIntent({ ...running, mac: false, key: { ...enter, ctrlKey: true } })).toBe("alternate");
    // Ctrl+Enter on a Mac is not the chord: it sends as Enter does.
    expect(composerKeyIntent({ ...running, mac: true, key: { ...enter, ctrlKey: true } })).toBe("foreground");
  });

  describe("while a turn runs", () => {
    const running = { ...base, running: true };

    it("does the other follow-up action on Cmd+Enter when Enter sends", () => {
      expect(composerKeyIntent({ ...running, key: enter })).toBe("foreground");
      expect(composerKeyIntent({ ...running, key: { ...enter, ctrlKey: true } })).toBe("alternate");
      expect(composerKeyIntent({ ...running, key: { ...enter, ctrlKey: true, shiftKey: true } })).toBe("steer-queued");
    });

    it("moves the other action to Cmd+Shift+Enter when sending needs Cmd", () => {
      const strict = { ...running, sendShortcut: "mod-enter" as const };
      expect(composerKeyIntent({ ...strict, key: enter })).toBeNull();
      expect(composerKeyIntent({ ...strict, key: { ...enter, ctrlKey: true } })).toBe("foreground");
      expect(composerKeyIntent({ ...strict, key: { ...enter, ctrlKey: true, shiftKey: true } })).toBe("alternate");
    });

    it("moves it only for a prompt of several lines with the multiline option", () => {
      const multiline = { ...running, sendShortcut: "mod-enter-multiline" as const };
      expect(composerKeyIntent({ ...multiline, prompt: "one", key: { ...enter, ctrlKey: true } })).toBe("alternate");
      expect(composerKeyIntent({ ...multiline, prompt: "one", key: { ...enter, ctrlKey: true, shiftKey: true } })).toBe("steer-queued");
      expect(composerKeyIntent({ ...multiline, prompt: "a\nb", key: { ...enter, ctrlKey: true } })).toBe("foreground");
      expect(composerKeyIntent({ ...multiline, prompt: "a\nb", key: { ...enter, ctrlKey: true, shiftKey: true } })).toBe("alternate");
    });
  });

  it("keeps Cmd+Shift+Enter for the oldest queued message while no turn runs", () => {
    expect(composerKeyIntent({ ...base, key: { ...enter, ctrlKey: true, shiftKey: true } })).toBe("steer-queued");
    expect(composerKeyIntent({ ...base, sendShortcut: "mod-enter", key: { ...enter, ctrlKey: true, shiftKey: true } })).toBe("steer-queued");
  });

  it("sends and starts a new chat on Cmd+Option+Enter, in a chat or a new one, whatever the send shortcut", () => {
    for (const sendShortcut of ["enter", "mod-enter-multiline", "mod-enter"] as const) {
      for (const newChat of [false, true]) {
        expect(composerKeyIntent({ ...base, sendShortcut, newChat, prompt: "a\nb", key: { ...enter, ctrlKey: true, altKey: true } })).toBe("background");
      }
    }
    expect(composerKeyIntent({ ...base, running: true, key: { ...enter, ctrlKey: true, altKey: true } })).toBe("background");
  });

  it("keeps Cmd+Enter a plain send in a new chat (no send in the background)", () => {
    expect(composerKeyIntent({ ...base, newChat: true, key: { ...enter, ctrlKey: true } })).toBe("foreground");
    expect(composerKeyIntent({ ...base, newChat: true, sendShortcut: "mod-enter", key: { ...enter, ctrlKey: true } })).toBe("foreground");
  });

  it("takes no other key", () => {
    expect(composerKeyIntent({ ...base, key: { ...enter, key: "a" } })).toBeNull();
    expect(composerKeyIntent({ ...base, key: { ...enter, key: "Tab", shiftKey: true } })).toBeNull();
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

describe("the queue's order", () => {
  const queue = ["a", "b", "c", "d"].map((id) => ({ id }));
  const ids = (items: ReadonlyArray<{ id: string }>) => items.map((item) => item.id).join("");

  it("moves a message before another, or to the end", () => {
    expect(ids(moveQueued(queue, "c", "a"))).toBe("cabd");
    expect(ids(moveQueued(queue, "a", "d"))).toBe("bcad");
    expect(ids(moveQueued(queue, "b", null))).toBe("acdb");
  });

  it("leaves the queue as it is for an unknown message or a move onto itself", () => {
    expect(ids(moveQueued(queue, "x", "a"))).toBe("abcd");
    expect(ids(moveQueued(queue, "b", "b"))).toBe("abcd");
    expect(ids(moveQueued(queue, "b", "x"))).toBe("abcd");
  });

  it("turns a drop at a gap into the message it lands before, and a drop beside itself into no move", () => {
    const order = ["a", "b", "c"];
    expect(queuedDropTarget(order, "c", 0)).toBe("a");
    expect(queuedDropTarget(order, "a", 3)).toBeNull();
    expect(queuedDropTarget(order, "a", 2)).toBe("c");
    expect(queuedDropTarget(order, "b", 1)).toBeUndefined();
    expect(queuedDropTarget(order, "b", 2)).toBeUndefined();
    expect(queuedDropTarget(order, "x", 0)).toBeUndefined();
  });
});

describe("editing a queued message", () => {
  const queued = { text: "look at this", chips: ["shape:a", "shape:b"], attachments: ["att-1"] };

  it("counts an edit as changed when its text, its chips or its attachments differ", () => {
    expect(queuedEditChanged(queued, { ...queued })).toBe(false);
    expect(queuedEditChanged(queued, { ...queued, text: "look at that" })).toBe(true);
    expect(queuedEditChanged(queued, { ...queued, chips: ["shape:a"] })).toBe(true);
    expect(queuedEditChanged(queued, { ...queued, chips: ["shape:a", "shape:c"] })).toBe(true);
    expect(queuedEditChanged(queued, { ...queued, attachments: [] })).toBe(true);
    expect(queuedEditChanged(queued, { ...queued, attachments: ["att-1", "att-2"] })).toBe(true);
  });

  it("ignores the order of chips and attachments, and the same id twice", () => {
    expect(queuedEditChanged(queued, { ...queued, chips: ["shape:b", "shape:a"] })).toBe(false);
    expect(queuedEditChanged({ ...queued, attachments: ["att-1", "att-2"] }, { ...queued, attachments: ["att-2", "att-1", "att-1"] })).toBe(false);
  });

  it("closes an unchanged edit without touching the draft", () => {
    expect(resolveQueuedEditExit({ editChanged: false, threadDraftEmpty: true })).toBe("clean");
    expect(resolveQueuedEditExit({ editChanged: false, threadDraftEmpty: false })).toBe("clean");
  });

  it("keeps a changed edit only when the chat's draft is empty", () => {
    expect(resolveQueuedEditExit({ editChanged: true, threadDraftEmpty: true })).toBe("kept");
    expect(resolveQueuedEditExit({ editChanged: true, threadDraftEmpty: false })).toBe("discarded");
  });

  it("blocks edits only while a question holds the composer", () => {
    expect(queuedEditBlockedReason({ openQuestionCount: 0 })).toBeNull();
    expect(queuedEditBlockedReason({ openQuestionCount: 1 })).toBe("Answer the question to edit queued messages");
  });
});

describe("attachment chips in the draft", () => {
  const image = { id: "0123abcd.png", name: "shot.png", type: "image/png", kind: "image" as const, size: 3 };
  const file = { id: "4567ef01.txt", name: "notes; v2].txt", type: "text/plain", kind: "file" as const, size: 9 };

  it("reads as the other chips do, its name kept clear of the token's own marks", () => {
    expect(attachmentChip(image)).toBe("[Image: shot.png; ref=0123abcd.png]");
    expect(attachmentChip(file)).toBe("[File: notes v2.txt; ref=4567ef01.txt]");
  });

  it("finds the refs a draft names, once each", () => {
    expect(chipRefs(`look ${attachmentChip(image)} and ${attachmentChip(file)} ${attachmentChip(image)}`)).toEqual(["0123abcd.png", "4567ef01.txt"]);
    expect(chipRefs("no chips [not one]")).toEqual([]);
  });

  it("leaves what the person wrote once the chips are taken out", () => {
    expect(withoutChips(`${attachmentChip(image)} `).trim()).toBe("");
    expect(withoutChips(`see ${attachmentChip(image)}`)).toBe("see ");
  });

  it("appends a chip a draft lacks after a space, and leaves one it has (t3code's ensureInlineContextReferences)", () => {
    expect(ensureChips("Draft A", [attachmentChip(image)])).toBe(`Draft A ${attachmentChip(image)}`);
    expect(ensureChips("", [attachmentChip(image)])).toBe(attachmentChip(image));
    const once = ensureChips("Draft A", [attachmentChip(image)]);
    expect(ensureChips(once, [attachmentChip(image)])).toBe(once);
  });

  it("removes every chip of a ref with the space after it (t3code's removeInlineContextReference)", () => {
    expect(removeChips(`a ${attachmentChip(image)} b ${attachmentChip(image)}`, image.id)).toBe("a b");
    expect(removeChips(`only ${attachmentChip(file)}`, file.id)).toBe("only");
    expect(removeChips("untouched", image.id)).toBe("untouched");
  });
});

describe("drafts kept across reloads", () => {
  const attachment = { id: "0123abcd.png", name: "shot.png", type: "image/png", kind: "image" as const, size: 3 };

  it("stores the drafts that hold something, for chats that still exist", () => {
    const drafts: Array<[string, { text: string; mentions: string[]; attachments: (typeof attachment)[] }]> = [
      ["chat-a", { text: "hello", mentions: ["shape:x"], attachments: [] }],
      ["chat-b", { text: "", mentions: [], attachments: [attachment] }],
      ["chat-gone", { text: "lost", mentions: [], attachments: [] }],
      ["chat-empty", { text: "", mentions: [], attachments: [] }],
    ];
    expect(storedDraftsValue(drafts, (key) => key !== "chat-gone")).toEqual({
      "chat-a": { text: "hello", mentions: ["shape:x"], attachments: [] },
      "chat-b": { text: "", mentions: [], attachments: [attachment] },
    });
    expect(storedDraftsValue([], () => true)).toBeNull();
  });

  it("reads them back, skipping anything malformed", () => {
    const stored = {
      "chat-a": { text: "hello", mentions: ["shape:x", 4], attachments: [attachment, { id: 1 }] },
      "chat-b": { text: 7 },
      "chat-c": "nope",
    };
    expect(readStoredDrafts(stored)).toEqual([["chat-a", { text: "hello", mentions: ["shape:x"], attachments: [attachment] }]]);
    expect(readStoredDrafts(null)).toEqual([]);
    expect(readStoredDrafts([1, 2])).toEqual([]);
  });
});

describe("a stash entry's snippet", () => {
  it("is the text on one line, its chips by their names, cut at 90 characters", () => {
    expect(stashSnippet("  two\n lines  ", [])).toBe("two lines");
    expect(stashSnippet("see [Image: shot.png; ref=0123abcd.png] here", [])).toBe("see shot.png here");
    expect(stashSnippet("x".repeat(95), [])).toBe(`${"x".repeat(90)}…`);
  });

  it("counts the attachments when there is no text (t3code's)", () => {
    expect(stashSnippet("", [{ kind: "image" }, { kind: "image" }])).toBe("(2 images)");
    expect(stashSnippet("", [{ kind: "file" }])).toBe("(1 file)");
    expect(stashSnippet(" ", [{ kind: "image" }, { kind: "file" }])).toBe("(2 attachments)");
    expect(stashSnippet("", [])).toBe("(empty)");
  });
});

describe("the notices above the composer", () => {
  it("puts the connection's and the agent's first, whatever order they arrive in, and keeps each group's order", () => {
    const notices = [{ id: "limit" }, { id: "offline", group: "environment" as const }, { id: "refused", group: "attention" as const }, { id: "session", group: "environment" as const }];
    expect(orderNotices(notices).map((notice) => notice.id)).toEqual(["offline", "session", "limit", "refused"]);
    expect(orderNotices([])).toEqual([]);
  });
});

describe("resuming a turn (t3code's Resume thread)", () => {
  const ended = (state: "running" | "interrupted" | "completed" | "error") => {
    const chat = chatOf(started());
    return { ...chat, latestTurn: { ...chat.latestTurn!, state } };
  };

  it("is offered once the latest turn was interrupted, and sends t3code's words", () => {
    expect(resumableTurn(ended("interrupted"))).toBe(true);
    expect(RESUME_MESSAGE).toBe("Continue where you left off.");
  });

  it("is not offered for a turn that runs, finished or failed, nor for a chat with no turn or an outside chat", () => {
    expect(resumableTurn(ended("running"))).toBe(false);
    expect(resumableTurn(ended("completed"))).toBe(false);
    expect(resumableTurn(ended("error"))).toBe(false);
    expect(resumableTurn({ ...ended("interrupted"), latestTurn: null })).toBe(false);
    expect(resumableTurn({ ...ended("interrupted"), outside: { connectionId: "c", sessionId: "s", client: "claude-code" } })).toBe(false);
  });
});

describe("a usage limit hit (t3code's usage-limit run)", () => {
  const limited = (state: "running" | "error" | "completed", status: string, turnId?: string, resetsAt?: string) => {
    const chat = chatOf(started());
    const turn = chat.latestTurn!;
    return {
      ...chat,
      latestTurn: { ...turn, state },
      activities: [
        {
          id: "l1",
          tone: status === "rejected" ? ("error" as const) : ("info" as const),
          kind: "rate-limit",
          summary: "Usage limit",
          payload: { status, ...(resetsAt === undefined ? {} : { resetsAt }) },
          turnId: turnId ?? turn.turnId,
          sequence: 1,
          createdAt: "2026-10-01T12:00:00.000Z",
        },
      ],
    };
  };

  it("is the latest turn failing on a rejected limit, with the reset time when the provider gave one, and it can be resumed", () => {
    expect(usageLimitHit(limited("error", "rejected", undefined, "2026-10-01T15:00:00.000Z"))).toEqual({ resetsAt: "2026-10-01T15:00:00.000Z" });
    expect(usageLimitHit(limited("error", "rejected"))).toEqual({});
    expect(resumableTurn(limited("error", "rejected"))).toBe(true);
  });

  it("is not a warning, a limit on an earlier turn, a turn that went through or one still running", () => {
    expect(usageLimitHit(limited("error", "allowed_warning"))).toBeUndefined();
    expect(usageLimitHit(limited("error", "rejected", "turn:old"))).toBeUndefined();
    expect(usageLimitHit(limited("completed", "rejected"))).toBeUndefined();
    expect(usageLimitHit(limited("running", "rejected"))).toBeUndefined();
    expect(resumableTurn(limited("error", "allowed_warning"))).toBe(false);
  });
});
