import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADD_PARAMETER_TEMPLATE,
  APPLY_PARAMETERS_TEMPLATE,
  APPLY_SCREEN_PARAMETERS_TEMPLATE,
  ADD_SCREEN_PARAMETER_TEMPLATE,
  ARTIFACT_PERFORMANCE,
  DIALS_CONTRACT,
  DIALS_TIMELINE,
  MOTION_EDIT_ARGUMENTS,
  MOTION_EDIT_TEXT,
  MOTION_READ_SHAPE_ID,
  MOTION_READ_TEXT,
  MOTION_WRITE_ARGUMENTS,
  MOTION_WRITE_TEXT,
  PAGE_EDIT_ARGUMENTS,
  PAGE_EDIT_TEXT,
  PAGE_READ_SHAPE_ID,
  PAGE_READ_TEXT,
  PAGE_WRITE_ARGUMENTS,
  PAGE_WRITE_TEXT,
  PREVIEW_TOOL_TEXT,
  INSTANCE_TOOL_TEXT,
  CANVAS_READ_SCREENS,
  CANVAS_WRITE_SCREENS,
  PREVIEW_OPEN_SCREENS,
  REPOSITORY_SECTION_TEMPLATE,
  repositorySection,
  repositorySystemPrompt,
  SETUP_FIRST_MESSAGE,
  SETUP_REJECTION_TEMPLATE,
  SETUP_SYSTEM_PROMPT,
  SETUP_TOOL_TEXT,
  setupRejection,
  FLOW_CREATE_TEXT,
  MAP_FLOW_TEMPLATE,
  mapFlowInstruction,
  SCREEN_STATE_TEXT,
  ANALYSIS_TOOL_TEXT,
  OUTSIDE_ANALYSIS_TOOLS,
  SHOW_STATES_TEMPLATE,
  showStatesInstruction,
  FIX_STATE_TEMPLATE,
  fixStateInstruction,
} from "../../src/index.ts";

const prompts = join(import.meta.dirname, "../../../../assets/prompts");
const read = (file: string) => readFileSync(join(prompts, file), "utf8");

/** Every fenced `text` block of a prompt asset, in order. */
const blocks = (file: string): string[] => [...read(file).matchAll(/^(`{3,})text\n([\s\S]*?)\n\1$/gm)].map((match) => match[2]!);

/** A file's `## ` sections, each with its text block and its `- \`arg\`: description` bullets. */
const sections = (file: string) =>
  read(file)
    .split(/^## /m)
    .slice(1)
    .map((part) => ({
      name: part.split("\n")[0]!.trim(),
      text: /^(`{3,})text\n([\s\S]*?)\n\1$/m.exec(part)?.[2],
      args: Object.fromEntries([...part.matchAll(/^- `([^`]+)`: (.*)$/gm)].map((match) => [match[1]!, match[2]!])),
    }));

describe("the artifact tools' model-facing text is the assets' text", () => {
  it("holds the write descriptions, the dials paragraphs and the performance paragraph", () => {
    expect(PAGE_WRITE_TEXT).toBe(blocks("page-write-tool.md")[0]);
    expect(PAGE_WRITE_TEXT).toContain("nothing external loads, except the engine's component pins.");
    expect(MOTION_WRITE_TEXT).toBe(blocks("motion-write-tool.md")[0]);
    expect(DIALS_CONTRACT).toBe(blocks("dials-contract.md")[0]);
    expect(DIALS_TIMELINE).toBe(blocks("dials-timeline.md")[0]);
    expect(ARTIFACT_PERFORMANCE).toBe(blocks("artifact-performance.md")[0]);
    expect(ADD_PARAMETER_TEMPLATE).toBe(blocks("add-parameter-instruction.md")[0]);
    expect(APPLY_PARAMETERS_TEMPLATE).toBe(blocks("apply-parameters-instruction.md")[0]);
    expect(APPLY_SCREEN_PARAMETERS_TEMPLATE).toBe(blocks("screen-parameters-instructions.md")[0]);
    expect(ADD_SCREEN_PARAMETER_TEMPLATE).toBe(blocks("screen-parameters-instructions.md")[1]);
  });

  it("holds the write arguments and the read tools", () => {
    expect(PAGE_WRITE_ARGUMENTS).toEqual(sections("page-write-tool.md").find((section) => section.name === "Arguments")!.args);
    expect(MOTION_WRITE_ARGUMENTS).toEqual(sections("motion-write-tool.md").find((section) => section.name === "Arguments")!.args);
    const [page, motion] = sections("artifact-read-tools.md");
    expect([PAGE_READ_TEXT, PAGE_READ_SHAPE_ID]).toEqual([page!.text, page!.args.shapeId]);
    expect([MOTION_READ_TEXT, MOTION_READ_SHAPE_ID]).toEqual([motion!.text, motion!.args.shapeId]);
  });

  it("holds the edit tools and their arguments, each section alone", () => {
    const [page, motion] = sections("artifact-edit-tools.md");
    expect([page!.name, PAGE_EDIT_TEXT, PAGE_EDIT_ARGUMENTS]).toEqual(["page_edit", page!.text, page!.args]);
    expect([motion!.name, MOTION_EDIT_TEXT, MOTION_EDIT_ARGUMENTS]).toEqual(["motion_edit", motion!.text, motion!.args]);
  });

  it("holds all twelve preview tools and their arguments", () => {
    const expected = Object.fromEntries(sections("preview-tool-descriptions.md").map((section) => [section.name, { description: section.text, arguments: section.args }]));
    expect(Object.keys(expected)).toHaveLength(12);
    expect(PREVIEW_TOOL_TEXT).toEqual(expected);
  });
});

describe("the Instance tools' model-facing text is the assets' text", () => {
  it("holds every Instance tool, its arguments, and the Screen sentences of the canvas and preview tools", () => {
    const all = sections("instance-tools.md");
    const tools = all.filter((section) => section.name.startsWith("instance_"));
    expect(INSTANCE_TOOL_TEXT).toEqual(Object.fromEntries(tools.map((section) => [section.name, { description: section.text, arguments: section.args }])));
    expect(Object.keys(INSTANCE_TOOL_TEXT)).toEqual(["instance_create", "instance_remove", "instance_status", "instance_start", "instance_stop"]);
    const extra = Object.fromEntries(all.filter((section) => !section.name.startsWith("instance_")).map((section) => [section.name, section.text]));
    expect([CANVAS_READ_SCREENS, CANVAS_WRITE_SCREENS, PREVIEW_OPEN_SCREENS]).toEqual([extra.canvas_read, extra.canvas_write, extra.preview_open]);
  });
});

describe("the Repository section of the system prompt", () => {
  it("is the asset's text with the Repository's paths and Setup's files filled in", () => {
    expect(REPOSITORY_SECTION_TEMPLATE).toBe(blocks("repository-section.md")[0]);
    const facts = { root: "/Users/me/app", worktrees: "/data/worktrees/app", setupFiles: [".unframed/mock-user.ts", ".env.local"] };
    const section = repositorySection(facts);
    expect(section).not.toMatch(/<root>|<worktrees>|<setup files>/);
    expect(section).toContain("git repository at /Users/me/app");
    expect(section).toContain("Every worktree sits under /data/worktrees/app");
    expect(section).toContain("never yours to change or commit: .unframed/mock-user.ts, .env.local.");
    expect(section).toContain("Never commit");
    expect(section).toContain("window.unframed?.dials(...)");
    expect(repositorySection({ ...facts, setupFiles: [] })).toContain("commit: none yet.");
    expect(repositorySystemPrompt("Base.", facts)).toBe(`Base.\n\n${section}`);
  });
});

describe("Setup's model-facing text is the asset's text", () => {
  it("holds its system section, first message, rejection and tools", () => {
    const all = Object.fromEntries(sections("setup.md").map((section) => [section.name, section]));
    expect(SETUP_SYSTEM_PROMPT).toBe(all.System!.text);
    expect(SETUP_FIRST_MESSAGE).toBe(all["First message"]!.text);
    expect(SETUP_REJECTION_TEMPLATE).toBe(all.Rejection!.text);
    expect(setupRejection("  the header is missing ")).toBe("That is not right yet: the header is missing");
    expect(SETUP_TOOL_TEXT).toEqual(
      Object.fromEntries(["ask_login", "screen_snapshot", "setup_save"].map((name) => [name, { description: all[name]!.text, arguments: all[name]!.args }])),
    );
  });
});

describe("the Flow's model-facing text is the asset's text", () => {
  it("holds flow_create and the instruction that asks the agent to map a Flow", () => {
    const all = Object.fromEntries(sections("flow.md").map((section) => [section.name, section]));
    expect(FLOW_CREATE_TEXT).toEqual({ description: all.flow_create!.text, arguments: all.flow_create!.args });
    expect(MAP_FLOW_TEMPLATE).toBe(all["Map a Flow"]!.text);
    const text = mapFlowInstruction({ shape: "a1b2", state: "the menu open", route: "/app", branch: "feature/x", worktree: "/data/worktrees/app/x" });
    expect(text).not.toMatch(/<shape>|<state>|<route>|<branch>|<worktree>/);
    expect(text).toContain('Map a Flow from the Screen a1b2, which shows the menu open on the branch "feature/x" (its worktree is /data/worktrees/app/x). Explore the app from /app');
  });
});

describe("the Screen states' model-facing text is the asset's text", () => {
  it("holds screen_state and the instruction that asks the agent to fix a state", () => {
    const all = Object.fromEntries(sections("screen-states.md").map((section) => [section.name, section]));
    expect(SCREEN_STATE_TEXT).toEqual({ description: all.screen_state!.text, arguments: all.screen_state!.args });
    expect(FIX_STATE_TEMPLATE).toBe(all["Fix a state"]!.text);
    const text = fixStateInstruction({ shape: "a1b2", branch: "trunk", state: "the menu open", route: "/app", steps: [{ action: "press", key: "Escape" }], mocks: [], number: 1, step: "press Escape", reason: "nothing matched" });
    expect(text).not.toMatch(/<shape>|<branch>|<state>|<number>|<step>|<reason>|<route>|<steps>|<mocks>/);
    expect(text).toContain('The Screen a1b2 on the branch "trunk" no longer reaches its state "the menu open": step 1, press Escape, failed: nothing matched. It starts from /app, with the steps [{"action":"press","key":"Escape"}] and the mocks [].');
  });
});

describe("the Repository analysis model-facing text is the asset's text", () => {
  it("holds the analysis tools and the instruction Show states sends", () => {
    const all = sections("repository-analysis.md");
    const tools = all.filter((section) => section.name !== "Show states");
    expect(ANALYSIS_TOOL_TEXT).toEqual(Object.fromEntries(tools.map((section) => [section.name, { description: section.text, arguments: section.args }])));
    expect(Object.keys(ANALYSIS_TOOL_TEXT)).toEqual(["repo_analyse", "code_map_read", "design_search", "route_states", "mocks_read", "mock_write", "screens_place", "states_place", "state_freeze", "instance_patch"]);
    for (const name of OUTSIDE_ANALYSIS_TOOLS) expect(ANALYSIS_TOOL_TEXT[name]).toBeDefined();
    expect(SHOW_STATES_TEMPLATE).toBe(all.find((section) => section.name === "Show states")!.text);
    const text = showStatesInstruction({ shape: "a1b2", route: "/items", branch: "trunk", worktree: "/data/worktrees/app/x", cases: 4 });
    expect(text).not.toMatch(/<shape>|<route>|<branch>|<worktree>|<cases>/);
    expect(text).toContain('Show the states of the Screen a1b2, at /items on the branch "trunk" (its worktree is /data/worktrees/app/x). The States index lists 4 cases');
  });
});
