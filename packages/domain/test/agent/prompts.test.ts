import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_SYSTEM_PROMPT,
  CANVAS_READ_DESCRIPTION,
  CANVAS_WRITE_DESCRIPTION,
  CHANGE_NOTE_ONE_REVERT,
  CHANGE_NOTE_OTHER,
  CHANGE_NOTE_PERSON,
  CHANGE_NOTE_REVERTS,
  CHANGE_NOTE_TEMPLATE,
  CHAT_TITLE_PROMPT,
  CHAT_TITLE_SYSTEM_PROMPT,
  CLAUDE_CATALOGUE,
  CODEX_PLAN_MODE_INSTRUCTIONS,
  DECLINED_MESSAGE,
  FAILURE_NO_SUBTYPE,
  FAILURE_OTHER_SUBTYPE,
  FAILURE_SENTENCES,
  IMPLEMENT_PLAN_PROMPT,
  PLAN_CAPTURED_MESSAGE,
  PLAN_NO_WRITES_MESSAGE,
  QUIT_MID_TURN,
} from "../../src/index.ts";

const assets = join(import.meta.dirname, "../../../../assets");

/** Every fenced `text` block of a prompt asset, in order. */
const blocks = (file: string): string[] => {
  const text = readFileSync(join(assets, "prompts", file), "utf8");
  return [...text.matchAll(/^(`{3,})text\n([\s\S]*?)\n\1$/gm)].map((match) => match[2]!);
};

describe("the agent's model-facing text is the assets' text", () => {
  it("holds the system prompt and the canvas tool descriptions", () => {
    expect(AGENT_SYSTEM_PROMPT).toBe(blocks("agent-system.md")[0]);
    expect([CANVAS_READ_DESCRIPTION, CANVAS_WRITE_DESCRIPTION]).toEqual(blocks("tool-descriptions.md"));
  });

  it("holds the failure sentences, their fallbacks and the quit-mid-turn sentence", () => {
    const [execution, maxTurns, budget, retries, other, none, quit] = blocks("failures.md");
    expect(FAILURE_SENTENCES).toEqual({
      error_during_execution: execution,
      error_max_turns: maxTurns,
      error_max_budget_usd: budget,
      error_max_structured_output_retries: retries,
    });
    expect([FAILURE_OTHER_SUBTYPE, FAILURE_NO_SUBTYPE, QUIT_MID_TURN]).toEqual([other, none, quit]);
  });

  it("holds the change note's template and clauses", () => {
    expect([CHANGE_NOTE_TEMPLATE, CHANGE_NOTE_PERSON, CHANGE_NOTE_OTHER, CHANGE_NOTE_ONE_REVERT, CHANGE_NOTE_REVERTS]).toEqual(
      blocks("change-note.md").slice(0, 5),
    );
  });

  it("holds the permission and plan messages, and the title request", () => {
    expect(DECLINED_MESSAGE).toBe(blocks("declined.md")[0]);
    expect(PLAN_CAPTURED_MESSAGE).toBe(blocks("plan-captured.md")[0]);
    expect(PLAN_NO_WRITES_MESSAGE).toBe(blocks("plan-no-writes.md")[0]);
    expect(CODEX_PLAN_MODE_INSTRUCTIONS).toBe(blocks("plan-mode.md")[0]);
    expect([CHAT_TITLE_SYSTEM_PROMPT, CHAT_TITLE_PROMPT]).toEqual(blocks("chat-title.md"));
  });

  it("holds the text Implement sends before the plan", () => {
    expect(IMPLEMENT_PLAN_PROMPT).toBe(blocks("implement-plan.md")[0]);
  });

  it("holds the Claude catalogue", () => {
    const catalogue = JSON.parse(readFileSync(join(assets, "models", "claude-catalogue.json"), "utf8"));
    expect(CLAUDE_CATALOGUE).toEqual(catalogue.models);
  });
});
