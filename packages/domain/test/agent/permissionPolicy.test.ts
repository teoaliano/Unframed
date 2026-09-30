import { describe, expect, it } from "vitest";
import {
  answerPermission,
  claudePermissionMode,
  claudeTurnPermissionMode,
  codexPlanCollaboration,
  codexPolicy,
  CODEX_PLAN_MODE_INSTRUCTIONS,
  decidePermission,
  type RuntimeMode,
} from "../../src/index.ts";

const MODES: RuntimeMode[] = ["approval-required", "auto-accept-edits", "auto", "full-access"];

describe("the permission policy, in order", () => {
  it("1. opens a question for AskUserQuestion in every mode", () => {
    for (const runtimeMode of MODES) {
      expect(decidePermission({ runtimeMode, interactionMode: "default", tool: "AskUserQuestion", input: {} })).toEqual({ kind: "question" });
    }
  });

  it("2. captures ExitPlanMode's plan, trimmed, and denies with the captured message", () => {
    expect(decidePermission({ runtimeMode: "full-access", interactionMode: "plan", tool: "ExitPlanMode", input: { plan: "  # Plan\n\n- a  " } })).toEqual({
      kind: "capture-plan",
      plan: "# Plan\n\n- a",
      message: "The client captured your proposed plan. Stop here and wait for the user's feedback or implementation request in a later turn.",
    });
  });

  it("3. allows Unframed's own tools in every mode without asking, and refuses their writes in plan mode", () => {
    for (const runtimeMode of MODES) {
      expect(decidePermission({ runtimeMode, interactionMode: "default", tool: "mcp__unframed__canvas_write", input: {} })).toEqual({ kind: "allow" });
      expect(decidePermission({ runtimeMode, interactionMode: "plan", tool: "mcp__unframed__canvas_read", input: {} })).toEqual({ kind: "allow" });
    }
    for (const tool of ["mcp__unframed__canvas_write", "mcp__unframed__page_write", "mcp__unframed__motion_write"]) {
      expect(decidePermission({ runtimeMode: "full-access", interactionMode: "plan", tool, input: {} })).toEqual({
        kind: "deny",
        message: "Plan mode changes nothing, so this write did not happen; put the change in your plan instead.",
      });
    }
  });

  it("4. allows anything else in full access", () => {
    expect(decidePermission({ runtimeMode: "full-access", interactionMode: "default", tool: "Bash", input: { command: "rm -rf build" } })).toEqual({ kind: "allow" });
  });

  it("5. asks otherwise, with the request type classified from the tool", () => {
    const ask = (tool: string) => decidePermission({ runtimeMode: "approval-required", interactionMode: "default", tool, input: {} });
    expect(ask("Bash")).toEqual({ kind: "ask", requestType: "command_execution_approval" });
    expect(ask("Read")).toEqual({ kind: "ask", requestType: "file_read_approval" });
    expect(ask("Grep")).toEqual({ kind: "ask", requestType: "file_read_approval" });
    expect(ask("Edit")).toEqual({ kind: "ask", requestType: "file_change_approval" });
    expect(ask("Write")).toEqual({ kind: "ask", requestType: "file_change_approval" });
    expect(ask("mcp__github__create_issue")).toEqual({ kind: "ask", requestType: "dynamic_tool_call" });
    expect(decidePermission({ runtimeMode: "auto", interactionMode: "default", tool: "Bash", input: {} }).kind).toBe("ask");
  });
});

describe("answering a request", () => {
  it("allows on accept", () => {
    expect(answerPermission("accept", "Bash", undefined)).toEqual({ behavior: "allow" });
  });

  it("rescopes the SDK's suggestions to the session on accept for session", () => {
    expect(answerPermission("acceptForSession", "Bash", [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "rm:*" }], behavior: "allow", destination: "localSettings" }])).toEqual({
      behavior: "allow",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "rm:*" }], behavior: "allow", destination: "session" }],
    });
  });

  it("adds one session allow rule for the tool when there are no suggestions", () => {
    expect(answerPermission("acceptForSession", "mcp__github__search", [])).toEqual({
      behavior: "allow",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "mcp__github__search" }], behavior: "allow", destination: "session" }],
    });
  });

  it("denies a decline with the declined text, and a cancel with the cancel message and an interrupt", () => {
    expect(answerPermission("decline", "Bash", undefined)).toEqual({
      behavior: "deny",
      message: "The person declined this. Do not try it again; say what you would have done, or find another way.",
      interrupt: false,
    });
    expect(answerPermission("cancel", "Bash", undefined)).toEqual({ behavior: "deny", message: "User cancelled tool execution.", interrupt: true });
  });
});

describe("mode mappings", () => {
  it("maps each runtime mode onto Claude's permission mode and the skip-permissions flag", () => {
    expect(claudePermissionMode("approval-required")).toEqual({ allowDangerouslySkipPermissions: false });
    expect(claudePermissionMode("auto-accept-edits")).toEqual({ permissionMode: "acceptEdits", allowDangerouslySkipPermissions: false });
    expect(claudePermissionMode("auto")).toEqual({ permissionMode: "auto", allowDangerouslySkipPermissions: false });
    expect(claudePermissionMode("full-access")).toEqual({ permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true });
  });

  it("switches a Claude turn to plan in plan mode, else to the runtime mode's", () => {
    expect(claudeTurnPermissionMode("full-access", "plan")).toBe("plan");
    expect(claudeTurnPermissionMode("approval-required", "default")).toBe("default");
    expect(claudeTurnPermissionMode("auto-accept-edits", "default")).toBe("acceptEdits");
  });

  it("maps each runtime mode onto Codex's approval policy, sandbox, reviewer and turn sandbox policy", () => {
    expect(codexPolicy("approval-required")).toEqual({ approvalPolicy: "untrusted", sandbox: "read-only", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly" } });
    expect(codexPolicy("auto-accept-edits")).toEqual({ approvalPolicy: "on-request", sandbox: "workspace-write", approvalsReviewer: "user", sandboxPolicy: { type: "workspaceWrite" } });
    expect(codexPolicy("auto")).toEqual({ approvalPolicy: "on-request", sandbox: "workspace-write", approvalsReviewer: "auto_review", sandboxPolicy: { type: "workspaceWrite" } });
    expect(codexPolicy("full-access")).toEqual({ approvalPolicy: "never", sandbox: "danger-full-access", approvalsReviewer: "user", sandboxPolicy: { type: "dangerFullAccess" } });
  });

  it("gives Codex plan's collaboration mode with the plan-mode instructions, effort medium by default", () => {
    expect(codexPlanCollaboration("gpt-6")).toEqual({ mode: "plan", settings: { model: "gpt-6", reasoning_effort: "medium", developer_instructions: CODEX_PLAN_MODE_INSTRUCTIONS } });
    expect(codexPlanCollaboration("gpt-6", "high").settings.reasoning_effort).toBe("high");
  });
});
