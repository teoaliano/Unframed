import type { ApprovalDecision, InteractionMode, RuntimeMode } from "./chatModel.ts";
import { CANCELLED_MESSAGE, CODEX_PLAN_MODE_INSTRUCTIONS, DECLINED_MESSAGE, PLAN_CAPTURED_MESSAGE, PLAN_NO_WRITES_MESSAGE } from "./prompts.ts";
import { classifyRequest, type RequestType } from "./runtimeEvents.ts";

export const UNFRAMED_TOOL_PREFIX = "mcp__unframed__";

const UNFRAMED_WRITE_TOOLS: ReadonlySet<string> = new Set(["canvas_write", "page_write", "motion_write", "page_edit", "motion_edit", "component_write", "generate", "kit_write"]);

type PolicyAnswer =
  | { readonly kind: "question" }
  | { readonly kind: "capture-plan"; readonly plan: string; readonly message: string }
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly message: string }
  | { readonly kind: "ask"; readonly requestType: RequestType };

interface PolicyInput {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export const decidePermission = ({ runtimeMode, interactionMode, tool, input }: PolicyInput): PolicyAnswer => {
  if (tool === "AskUserQuestion") return { kind: "question" };
  if (tool === "ExitPlanMode") {
    const plan = typeof input.plan === "string" ? input.plan.trim() : "";
    return { kind: "capture-plan", plan, message: PLAN_CAPTURED_MESSAGE };
  }
  if (tool.startsWith(UNFRAMED_TOOL_PREFIX)) {
    const name = tool.slice(UNFRAMED_TOOL_PREFIX.length);
    if (interactionMode === "plan" && UNFRAMED_WRITE_TOOLS.has(name)) return { kind: "deny", message: PLAN_NO_WRITES_MESSAGE };
    if (name === "generate" && runtimeMode !== "full-access") return { kind: "ask", requestType: "dynamic_tool_call" };
    return { kind: "allow" };
  }
  if (runtimeMode === "full-access") return { kind: "allow" };
  return { kind: "ask", requestType: classifyRequest(tool) };
};

export interface PermissionUpdate {
  readonly type: string;
  readonly destination: string;
  readonly [key: string]: unknown;
}

type AnsweredPermission =
  | { readonly behavior: "allow"; readonly updatedPermissions?: ReadonlyArray<PermissionUpdate> }
  | { readonly behavior: "deny"; readonly message: string; readonly interrupt: boolean };

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

export interface ApprovalOption {
  readonly decision: ApprovalDecision;
  readonly label: string;
  readonly warning?: string;
}

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

export interface ApprovalSignals {
  readonly decisionReason?: string;
  readonly suppressAlwaysAllowRule?: boolean;
  readonly options?: ReadonlyArray<ApprovalOption>;
}

const TERMINAL_ESCAPES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

export const approvalPresentation = (signals: ApprovalSignals, target: string): { reason?: string; options?: ReadonlyArray<ApprovalOption> } => {
  const reason = (signals.decisionReason ?? "").replace(TERMINAL_ESCAPES, "").trim();
  const options = signals.options ?? (signals.suppressAlwaysAllowRule === true ? NO_STANDING_GRANT : undefined);
  return {
    ...(reason === "" || reason === target.trim() ? {} : { reason }),
    ...(options === undefined ? {} : { options }),
  };
};

export const offersDecision = (options: unknown, decision: ApprovalDecision): boolean =>
  !Array.isArray(options) || options.some((option) => typeof option === "object" && option !== null && (option as { decision?: unknown }).decision === decision);

export type ClaudePermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "auto";

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

export const claudeTurnPermissionMode = (runtime: RuntimeMode, interaction: InteractionMode): ClaudePermissionMode =>
  interaction === "plan" ? "plan" : (claudePermissionMode(runtime).permissionMode ?? "default");

interface CodexPolicy {
  readonly approvalPolicy: "untrusted" | "on-request" | "never";
  readonly sandbox: "read-only" | "workspace-write" | "danger-full-access";
  readonly approvalsReviewer: "user" | "auto_review";
  readonly sandboxPolicy: { readonly type: "readOnly" | "workspaceWrite" | "dangerFullAccess" };
}

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

export const codexPlanCollaboration = (model: string, effort?: string) => ({
  mode: "plan" as const,
  settings: { model, reasoning_effort: effort ?? "medium", developer_instructions: CODEX_PLAN_MODE_INSTRUCTIONS },
});
