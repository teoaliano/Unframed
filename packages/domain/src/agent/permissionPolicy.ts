/**
 * The permission policy (spec 07, t3code's four runtime modes, unchanged): what a tool call
 * gets, in a fixed order, and how each runtime mode maps onto Claude's permission mode and
 * Codex's sandbox and approval settings.
 */
import type { ApprovalDecision, InteractionMode, RuntimeMode } from "./chatModel.ts";
import { CANCELLED_MESSAGE, CODEX_PLAN_MODE_INSTRUCTIONS, DECLINED_MESSAGE, PLAN_CAPTURED_MESSAGE, PLAN_NO_WRITES_MESSAGE } from "./prompts.ts";
import { classifyRequest, type RequestType } from "./runtimeEvents.ts";

/** The provider-side prefix of every tool the Unframed MCP server registers. */
export const UNFRAMED_TOOL_PREFIX = "mcp__unframed__";

/** The Unframed tools that change something, refused in plan mode. The last two are spec 09's. */
export const UNFRAMED_WRITE_TOOLS: ReadonlySet<string> = new Set(["canvas_write", "page_write", "motion_write"]);

export type PolicyAnswer =
  /** `AskUserQuestion`: open a question and wait; allow with the answers. */
  | { readonly kind: "question" }
  /** `ExitPlanMode`: capture the plan and deny with the captured message. */
  | { readonly kind: "capture-plan"; readonly plan: string; readonly message: string }
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly message: string }
  | { readonly kind: "ask"; readonly requestType: RequestType };

export interface PolicyInput {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * What Claude's `canUseTool` must do, in order: a question in every mode; plan capture;
 * Unframed's own tools allowed without asking (their writes denied in plan mode); full
 * access allows; anything else asks.
 */
export const decidePermission = ({ runtimeMode, interactionMode, tool, input }: PolicyInput): PolicyAnswer => {
  if (tool === "AskUserQuestion") return { kind: "question" };
  if (tool === "ExitPlanMode") {
    const plan = typeof input.plan === "string" ? input.plan.trim() : "";
    return { kind: "capture-plan", plan, message: PLAN_CAPTURED_MESSAGE };
  }
  if (tool.startsWith(UNFRAMED_TOOL_PREFIX)) {
    const name = tool.slice(UNFRAMED_TOOL_PREFIX.length);
    if (interactionMode === "plan" && UNFRAMED_WRITE_TOOLS.has(name)) return { kind: "deny", message: PLAN_NO_WRITES_MESSAGE };
    return { kind: "allow" };
  }
  if (runtimeMode === "full-access") return { kind: "allow" };
  return { kind: "ask", requestType: classifyRequest(tool) };
};

/** A permission rule update, as the Claude SDK takes it. */
export interface PermissionUpdate {
  readonly type: string;
  readonly destination: string;
  readonly [key: string]: unknown;
}

export type AnsweredPermission =
  | { readonly behavior: "allow"; readonly updatedPermissions?: ReadonlyArray<PermissionUpdate> }
  | { readonly behavior: "deny"; readonly message: string; readonly interrupt: boolean };

/**
 * What an answered request allows. Accept for session rescopes the SDK's own suggestions to
 * the session, or, with none, adds one allow rule for the tool; decline tells the agent to
 * find another way; cancel denies and interrupts the turn.
 */
export const answerPermission = (
  decision: ApprovalDecision,
  toolName: string,
  suggestions: ReadonlyArray<PermissionUpdate> | undefined,
): AnsweredPermission => {
  switch (decision) {
    case "accept":
      return { behavior: "allow" };
    case "acceptForSession": {
      const scoped = (suggestions ?? []).map((suggestion) => ({ ...suggestion, destination: "session" }));
      return {
        behavior: "allow",
        updatedPermissions: scoped.length > 0 ? scoped : [{ type: "addRules", rules: [{ toolName }], behavior: "allow", destination: "session" }],
      };
    }
    case "decline":
      return { behavior: "deny", message: DECLINED_MESSAGE, interrupt: false };
    case "cancel":
      return { behavior: "deny", message: CANCELLED_MESSAGE, interrupt: true };
  }
};

export type ClaudePermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "auto";

/** Claude's permission mode for a runtime mode: none sent for Supervised (the SDK default asks). */
export const claudePermissionMode = (mode: RuntimeMode): { permissionMode?: ClaudePermissionMode; allowDangerouslySkipPermissions: boolean } => {
  switch (mode) {
    case "approval-required":
      return { allowDangerouslySkipPermissions: false };
    case "auto-accept-edits":
      return { permissionMode: "acceptEdits", allowDangerouslySkipPermissions: false };
    case "auto":
      return { permissionMode: "auto", allowDangerouslySkipPermissions: false };
    case "full-access":
      return { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true };
  }
};

/** The mode a Claude turn runs in: `plan` in plan interaction mode, else the runtime mode's. */
export const claudeTurnPermissionMode = (runtime: RuntimeMode, interaction: InteractionMode): ClaudePermissionMode =>
  interaction === "plan" ? "plan" : (claudePermissionMode(runtime).permissionMode ?? "default");

export interface CodexPolicy {
  readonly approvalPolicy: "untrusted" | "on-request" | "never";
  readonly sandbox: "read-only" | "workspace-write" | "danger-full-access";
  readonly approvalsReviewer: "user" | "auto_review";
  readonly sandboxPolicy: { readonly type: "readOnly" | "workspaceWrite" | "dangerFullAccess" };
}

/** Codex's approval policy, sandbox, reviewer and per-turn sandbox policy for a runtime mode. */
export const codexPolicy = (mode: RuntimeMode): CodexPolicy => {
  switch (mode) {
    case "approval-required":
      return { approvalPolicy: "untrusted", sandbox: "read-only", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly" } };
    case "auto-accept-edits":
      return { approvalPolicy: "on-request", sandbox: "workspace-write", approvalsReviewer: "user", sandboxPolicy: { type: "workspaceWrite" } };
    case "auto":
      return { approvalPolicy: "on-request", sandbox: "workspace-write", approvalsReviewer: "auto_review", sandboxPolicy: { type: "workspaceWrite" } };
    case "full-access":
      return { approvalPolicy: "never", sandbox: "danger-full-access", approvalsReviewer: "user", sandboxPolicy: { type: "dangerFullAccess" } };
  }
};

/** Codex's collaboration mode for a plan turn, with the plan-mode instructions. */
export const codexPlanCollaboration = (model: string, effort?: string) => ({
  mode: "plan" as const,
  settings: { model, reasoning_effort: effort ?? "medium", developer_instructions: CODEX_PLAN_MODE_INSTRUCTIONS },
});
