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

/** The Unframed tools that change something, refused in plan mode: the canvas and artifact writes and edits, components, the kit, and paid generation. */
export const UNFRAMED_WRITE_TOOLS: ReadonlySet<string> = new Set(["canvas_write", "page_write", "motion_write", "page_edit", "motion_edit", "component_write", "generate", "kit_write"]);

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
    // A paid generation asks in Supervised mode, with its estimate as the request's detail (spec 14, "In-app agents").
    if (name === "generate" && runtimeMode !== "full-access") return { kind: "ask", requestType: "dynamic_tool_call" };
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

/** One answer an approval offers (t3code's): the decision it sends, its label, and a warning shown beside it. */
export interface ApprovalOption {
  readonly decision: ApprovalDecision;
  readonly label: string;
  readonly warning?: string;
}

/** What an approval offers when its provider names nothing, t3code's order: the panel shows Decline and Approve, the menu the rest. */
export const DEFAULT_APPROVAL_OPTIONS: ReadonlyArray<ApprovalOption> = [
  { decision: "cancel", label: "Cancel" },
  { decision: "decline", label: "Decline" },
  { decision: "acceptForSession", label: "Always allow this session" },
  { decision: "accept", label: "Approve" },
];

const NO_STANDING_GRANT: ReadonlyArray<ApprovalOption> = [
  { decision: "decline", label: "Decline" },
  { decision: "accept", label: "Approve" },
];

/** What a provider says about one ask: Claude's `canUseTool` reason and its no-standing-grant flag, or options it names. */
export interface ApprovalSignals {
  readonly decisionReason?: string;
  readonly suppressAlwaysAllowRule?: boolean;
  readonly options?: ReadonlyArray<ApprovalOption>;
}

const TERMINAL_ESCAPES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

/**
 * The reason and options an approval request carries (t3code's `claudeApprovalPresentation`).
 * The reason is dropped when it only repeats the target. An ask that must not offer a
 * standing grant offers only Decline and Approve: accepting for the session would write a
 * rule broader than the ask.
 */
export const approvalPresentation = (signals: ApprovalSignals, target: string): { reason?: string; options?: ReadonlyArray<ApprovalOption> } => {
  const reason = (signals.decisionReason ?? "").replace(TERMINAL_ESCAPES, "").trim();
  const options = signals.options ?? (signals.suppressAlwaysAllowRule === true ? NO_STANDING_GRANT : undefined);
  return {
    ...(reason === "" || reason === target.trim() ? {} : { reason }),
    ...(options === undefined ? {} : { options }),
  };
};

/** Whether a request offers a decision: one that names no options offers the fixed four. */
export const offersDecision = (options: unknown, decision: ApprovalDecision): boolean =>
  !Array.isArray(options) || options.some((option) => typeof option === "object" && option !== null && (option as { decision?: unknown }).decision === decision);

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
