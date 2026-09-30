import { describe, expect, it } from "vitest";
import {
  buildPreamble,
  changeNote,
  checkCanvasTools,
  classifyOrigin,
  codexFailureSentence,
  failureSentence,
  selectionLabel,
  type ChangeRow,
} from "../../src/index.ts";

describe("the canvas tools check", () => {
  it("names every missing mcp__unframed__ tool in the failure sentence", () => {
    expect(checkCanvasTools(["canvas_read", "canvas_write"], ["Read", "Bash", "mcp__unframed__canvas_read"]).failure).toBe(
      "The agent session started without the canvas tools (mcp__unframed__canvas_write). This is a bug in Unframed, not your setup.",
    );
    expect(checkCanvasTools(["canvas_read", "canvas_write"], []).failure).toBe(
      "The agent session started without the canvas tools (mcp__unframed__canvas_read, mcp__unframed__canvas_write). This is a bug in Unframed, not your setup.",
    );
  });

  it("passes with every tool there, and reports the person's own MCP tools as foreign", () => {
    const check = checkCanvasTools(["canvas_read", "canvas_write"], ["mcp__unframed__canvas_read", "mcp__unframed__canvas_write", "mcp__github__search"]);
    expect(check).toEqual({ foreign: ["mcp__github__search"] });
  });
});

describe("failure sentences", () => {
  it("has one sentence per known subtype", () => {
    expect(failureSentence({ subtype: "error_max_turns" })).toBe(
      "The agent reached its limit of steps for one turn and stopped. Ask again, more narrowly — one change at a time.",
    );
    expect(failureSentence({ subtype: "error_during_execution" })).toMatch(/^The agent stopped part-way through this turn\./);
    expect(failureSentence({ subtype: "error_max_budget_usd" })).toBe("The agent reached the spending limit set for one turn and stopped.");
    expect(failureSentence({ subtype: "error_max_structured_output_retries" })).toMatch(/^The agent could not produce a usable answer/);
  });

  it("names any other subtype, and falls back with none", () => {
    expect(failureSentence({ subtype: "error_new_thing" })).toBe("The agent failed: error_new_thing.");
    expect(failureSentence({})).toBe("The agent reported an error.");
    expect(failureSentence({ message: 'no agent script matches "hello"' })).toBe('no agent script matches "hello"');
  });

  it("maps Codex's step limit onto error_max_turns and names any other Codex error", () => {
    expect(codexFailureSentence("Turn exceeded max turns")).toBe(failureSentence({ subtype: "error_max_turns" }));
    expect(codexFailureSentence("stream disconnected")).toBe("The agent failed: stream disconnected.");
    expect(codexFailureSentence(undefined)).toBe("The agent reported an error.");
  });
});

describe("change log origins", () => {
  it("counts tabs and runs as the person, and reads chats and reverts by id", () => {
    expect(classifyOrigin({ kind: "session", id: "tab-1" })).toEqual({ kind: "person" });
    expect(classifyOrigin({ kind: "server", id: "run:abc" })).toEqual({ kind: "person" });
    expect(classifyOrigin({ kind: "server", id: "chat:c1" })).toEqual({ kind: "chat", chatId: "c1" });
    expect(classifyOrigin({ kind: "server", id: "revert:c1:3" })).toEqual({ kind: "revert", chatId: "c1", turn: 3 });
    expect(classifyOrigin({ kind: "system", id: "media" })).toEqual({ kind: "system" });
  });
});

describe("the change note", () => {
  const row = (kind: string, id: string, put: string[], removed: string[] = []): ChangeRow => ({ origin: { kind, id }, put, removed });

  it("says nothing when nothing changed, or only this chat and the engine did", () => {
    expect(changeNote([], "c1")).toBeUndefined();
    expect(changeNote([row("server", "chat:c1", ["shape:a"]), row("system", "media", ["shape:b"])], "c1")).toBeUndefined();
  });

  it("counts distinct shapes per origin, singular and plural", () => {
    expect(changeNote([row("session", "tab", ["shape:a"]), row("session", "tab", ["shape:a"])], "c1")).toBe(
      "Since your last turn the canvas changed: 1 change by the person. Read it again before acting.",
    );
    expect(changeNote([row("session", "tab", ["shape:a", "shape:b"]), row("server", "chat:c2", ["shape:c"], ["shape:d"]), row("server", "run:r", ["shape:e"])], "c1")).toBe(
      "Since your last turn the canvas changed: 3 changes by the person, 2 changes by another chat. Read it again before acting.",
    );
  });

  it("counts a revert as the person's and adds the revert clause", () => {
    expect(changeNote([row("server", "revert:c1:2", ["shape:a"]), row("session", "tab", ["shape:b"])], "c1")).toBe(
      "Since your last turn the canvas changed: 2 changes by the person, including a revert of one of your turns. Read it again before acting.",
    );
    expect(changeNote([row("server", "revert:c1:2", ["shape:a"]), row("server", "revert:c1:3", ["shape:a"])], "c1")).toBe(
      "Since your last turn the canvas changed: 2 changes by the person, including reverts of 2 of your turns. Read it again before acting.",
    );
    expect(changeNote([row("server", "revert:c2:1", ["shape:a"])], "c1")).toBe(
      "Since your last turn the canvas changed: 1 change by the person. Read it again before acting.",
    );
  });
});

describe("the preamble", () => {
  it("lists the selection with labels, the change note and the attachments, one paragraph each", () => {
    const preamble = buildPreamble({
      selected: [
        { kind: "motion", id: "m1", label: "Intro" },
        { kind: "image", id: "i3", label: "hero.png" },
        { kind: "mark", id: "d1" },
      ],
      changeNote: "Since your last turn the canvas changed: 1 change by the person. Read it again before acting.",
      attachments: [
        { kind: "image", name: "hero.png", path: "/data/attachments/abc.png" },
        { kind: "file", name: "brief.pdf", path: "/data/attachments/def.pdf" },
      ],
    });
    expect(preamble).toBe(
      [
        'Selected: motion m1 ("Intro"), image i3 ("hero.png"), mark d1.',
        "Since your last turn the canvas changed: 1 change by the person. Read it again before acting.",
        'Attached image "hero.png": /data/attachments/abc.png\nAttached file "brief.pdf": /data/attachments/def.pdf',
      ].join("\n\n"),
    );
    expect(buildPreamble({ selected: [], attachments: [] })).toBe("");
  });

  it("labels a shape by its title, else its file name, else its first 40 characters", () => {
    expect(selectionLabel({ title: "Intro", fileName: "x.html", text: "t" })).toBe("Intro");
    expect(selectionLabel({ title: "", fileName: "hero.png" })).toBe("hero.png");
    expect(selectionLabel({ text: "a".repeat(50) })).toBe("a".repeat(40));
    expect(selectionLabel({})).toBeUndefined();
  });
});
