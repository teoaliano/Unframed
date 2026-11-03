import type { ElementChip } from "@unframed/contracts";
import type { AgentProvider, Effort } from "./providerStatus.ts";

export type RuntimeMode = "approval-required" | "auto-accept-edits" | "auto" | "full-access";
export type InteractionMode = "default" | "plan";

export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export interface Traits {
  readonly effort?: Effort;
  readonly thinking?: boolean;
  readonly fastMode?: boolean;
}

export type ChatProvider = AgentProvider | "outside";

export interface AgentSelection {
  readonly provider: AgentProvider;
  readonly model: string;
  readonly traits: Traits;
}

export const agentSelectionOf = (selection: ModelSelection): AgentSelection | undefined =>
  selection.provider === "outside" ? undefined : { provider: selection.provider, model: selection.model, traits: selection.traits };

export interface ModelSelection {
  readonly provider: ChatProvider;
  readonly model: string;
  readonly traits: Traits;
}

export type AttachmentKind = "image" | "file";

export interface MessageAttachment {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly kind: AttachmentKind;
  readonly size: number;
}

export interface MessageContext {
  readonly selection: ReadonlyArray<string>;
  readonly elements?: ReadonlyArray<ElementChip>;
}

export type MessageRole = "user" | "assistant" | "reasoning";

export interface ChatMessage {
  readonly id: string;
  readonly role: MessageRole;
  readonly text: string;
  readonly turnId: string | null;
  readonly streaming: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attachments?: ReadonlyArray<MessageAttachment>;
  readonly context?: MessageContext;
}

export type ActivityTone = "info" | "tool" | "approval" | "error";

export interface ChatActivity {
  readonly id: string;
  readonly tone: ActivityTone;
  readonly kind: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly turnId: string | null;
  readonly sequence: number;
  readonly createdAt: string;
}

export interface ProposedPlan {
  readonly id: string;
  readonly turnId: string | null;
  readonly planMarkdown: string;
  readonly implementedAt: string | null;
  readonly implementationThreadId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TurnState = "running" | "interrupted" | "completed" | "error";

export interface TurnFile {
  readonly shapeId: string;
  readonly kind: string;
  readonly change: "created" | "updated" | "deleted";
  readonly file?: string;
  readonly previousFile?: string;
}

export type SkippedBy = "person" | "another chat" | "a later turn";

export interface TurnRevert {
  readonly restored: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<{ readonly id: string; readonly by: SkippedBy }>;
  readonly at: string;
}

export interface OutsideChatRef {
  readonly connectionId: string;
  readonly sessionId: string;
  readonly client: "claude-code" | "codex" | "claude-desktop" | "other";
}

export interface ChatTurn {
  readonly turnId: string;
  readonly turnCount: number;
  readonly state: TurnState;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly pendingMessageId: string | null;
  readonly assistantMessageId: string | null;
  readonly usage?: unknown;
  readonly files?: ReadonlyArray<TurnFile>;
  readonly reverted?: TurnRevert;
  readonly revertRequestedAt?: string;
}

export interface LatestTurn {
  readonly turnId: string;
  readonly turnCount: number;
  readonly state: TurnState;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly assistantMessageId: string | null;
}

export type SessionStatus = "idle" | "starting" | "running" | "ready" | "interrupted" | "stopped" | "error";

export interface ChatSession {
  readonly status: SessionStatus;
  readonly activeTurnId: string | null;
  readonly lastError: string | null;
}

export type TitledBy = "user" | "agent";

export interface Chat {
  readonly id: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly outside?: OutsideChatRef;
  readonly title: string;
  readonly titledBy: TitledBy | null;
  readonly tags: ReadonlyArray<string>;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  readonly lastClock: number | null;
  readonly latestTurn: LatestTurn | null;
  readonly session: ChatSession | null;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly activities: ReadonlyArray<ChatActivity>;
  readonly proposedPlans: ReadonlyArray<ProposedPlan>;
  readonly turns: ReadonlyArray<ChatTurn>;
}

export interface ProjectChats {
  readonly projectId: string;
  readonly chats: Readonly<Record<string, Chat>>;
  readonly sequence: number;
}

export const emptyProjectChats = (projectId: string): ProjectChats => ({ projectId, chats: {}, sequence: 0 });

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface AttachmentRef {
  readonly id: string;
  readonly name: string;
  readonly type?: string;
  readonly kind?: AttachmentKind;
  readonly size?: number;
}

interface CommandBase {
  readonly commandId: string;
  readonly projectId: string;
  readonly threadId: string;
}

export interface ProjectCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly type: "project.chats.clear";
}

export type ClientCommand = ThreadClientCommand | ProjectCommand;

export type ThreadClientCommand = CommandBase &
  (
    | {
        readonly type: "thread.create";
        readonly modelSelection: ModelSelection;
        readonly runtimeMode?: RuntimeMode;
        readonly interactionMode?: InteractionMode;
        readonly tags?: ReadonlyArray<string>;
        readonly createdAt: string;
      }
    | { readonly type: "thread.delete" }
    | { readonly type: "thread.meta.update"; readonly title?: string; readonly modelSelection?: ModelSelection }
    | { readonly type: "thread.runtime-mode.set"; readonly runtimeMode: RuntimeMode }
    | { readonly type: "thread.interaction-mode.set"; readonly interactionMode: InteractionMode }
    | {
        readonly type: "thread.turn.start";
        readonly message: {
          readonly messageId: string;
          readonly text: string;
          readonly attachments: ReadonlyArray<AttachmentRef | MessageAttachment>;
          readonly context?: MessageContext;
        };
        readonly steer?: boolean;
        readonly modelSelection?: ModelSelection;
        readonly sourceProposedPlan?: { readonly threadId: string; readonly planId: string };
        readonly createdAt: string;
      }
    | { readonly type: "thread.turn.interrupt"; readonly turnId?: string }
    | { readonly type: "thread.approval.respond"; readonly requestId: string; readonly decision: ApprovalDecision }
    | {
        readonly type: "thread.user-input.respond";
        readonly requestId: string;
        readonly answers: Readonly<Record<string, unknown>>;
        readonly attachmentsByQuestionId?: Readonly<Record<string, ReadonlyArray<AttachmentRef | MessageAttachment>>>;
      }
    | { readonly type: "thread.user-input.dismiss"; readonly requestId: string }
    | { readonly type: "thread.turn.revert"; readonly turnCount: number }
    | { readonly type: "thread.checkpoint.revert"; readonly turnCount: number; readonly restoreCanvas: boolean }
    | { readonly type: "thread.session.stop" }
    | { readonly type: "thread.tags.remove"; readonly ids: ReadonlyArray<string> }
    | { readonly type: "thread.tags.add"; readonly ids: ReadonlyArray<string> }
  );

export interface ActivityInput {
  readonly id: string;
  readonly tone: ActivityTone;
  readonly kind: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly turnId: string | null;
  readonly createdAt: string;
}

export type InternalCommand = CommandBase &
  (
    | { readonly type: "thread.session.set"; readonly session: ChatSession }
    | {
        readonly type: "thread.outside.create";
        readonly title: string;
        readonly outside: OutsideChatRef;
        readonly createdAt: string;
      }
    | { readonly type: "thread.outside.turn.begin"; readonly turnId: string; readonly createdAt: string }
    | { readonly type: "thread.message.assistant.delta"; readonly messageId: string; readonly turnId: string | null; readonly delta: string }
    | { readonly type: "thread.message.assistant.complete"; readonly messageId: string; readonly turnId: string | null; readonly text?: string }
    | { readonly type: "thread.message.reasoning.delta"; readonly messageId: string; readonly turnId: string | null; readonly delta: string }
    | { readonly type: "thread.message.reasoning.complete"; readonly messageId: string; readonly turnId: string | null; readonly text?: string }
    | { readonly type: "thread.proposed-plan.upsert"; readonly planId: string; readonly turnId: string | null; readonly planMarkdown: string }
    | { readonly type: "thread.activity.append"; readonly activity: ActivityInput }
    | { readonly type: "thread.tags.add"; readonly ids: ReadonlyArray<string> }
    | { readonly type: "thread.turn.files.complete"; readonly turnCount: number; readonly files: ReadonlyArray<TurnFile> }
    | {
        readonly type: "thread.turn.reverted.complete";
        readonly turnCount: number;
        readonly restored: ReadonlyArray<string>;
        readonly skipped: ReadonlyArray<{ readonly id: string; readonly by: SkippedBy }>;
      }
    | { readonly type: "thread.title.generate.complete"; readonly title: string }
    | { readonly type: "thread.turn.settle"; readonly turnCount: number; readonly clock: number | null; readonly usage?: unknown }
  );

export type ChatCommand = ClientCommand | InternalCommand;

export interface PendingEvent {
  readonly type: ChatEventType;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ChatEventType =
  | "thread.created"
  | "thread.deleted"
  | "thread.meta-updated"
  | "thread.runtime-mode-set"
  | "thread.interaction-mode-set"
  | "thread.message-sent"
  | "thread.turn-start-requested"
  | "thread.turn-interrupt-requested"
  | "thread.approval-response-requested"
  | "thread.user-input-response-requested"
  | "thread.checkpoint-revert-requested"
  | "thread.reverted"
  | "thread.session-stop-requested"
  | "thread.session-set"
  | "thread.proposed-plan-upserted"
  | "thread.activity-appended"
  | "thread.tagged"
  | "thread.untagged"
  | "thread.turn-files-completed"
  | "thread.turn-revert-requested"
  | "thread.turn-reverted"
  | "thread.turn-settled"
  | "thread.outside-turn-began";

export interface ChatEvent extends PendingEvent {
  readonly sequence: number;
  readonly eventId: string;
  readonly aggregateKind: "thread";
  readonly occurredAt: string;
  readonly commandId: string | null;
  readonly causationEventId: string | null;
  readonly correlationId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type RejectionCode = "not_found" | "conflict" | "bad_request";

export interface Rejection {
  readonly code: RejectionCode;
  readonly message: string;
}

export type Decision = { readonly ok: true; readonly events: ReadonlyArray<PendingEvent> } | { readonly ok: false; readonly rejection: Rejection };
