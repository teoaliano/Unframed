/**
 * The chat store's model (spec 07), rebuilt on t3code's orchestration: the read model of a
 * chat, the commands that change it and the events they become. The decider and the
 * projector in this folder are the only code that interprets them.
 */
import type { AgentProvider, Effort } from "./providerStatus.ts";

export type RuntimeMode = "approval-required" | "auto-accept-edits" | "auto" | "full-access";
export type InteractionMode = "default" | "plan";

export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export interface Traits {
  readonly effort?: Effort;
  readonly thinking?: boolean;
  readonly fastMode?: boolean;
}

export interface ModelSelection {
  readonly provider: AgentProvider;
  readonly model: string;
  readonly traits: Traits;
}

export type AttachmentKind = "image" | "file";

/** What a stored message keeps per attachment: never bytes. */
export interface MessageAttachment {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly kind: AttachmentKind;
  readonly size: number;
}

export interface MessageContext {
  readonly selection: ReadonlyArray<string>;
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

/** One shape a turn touched, as the recap lists it. */
export interface TurnFile {
  readonly shapeId: string;
  readonly kind: string;
  readonly change: "created" | "updated" | "deleted";
  /** A page or motion's file after the turn. */
  readonly file?: string;
  /** A page or motion's file before the turn, when it changed. */
  readonly previousFile?: string;
}

export type SkippedBy = "person" | "another chat" | "a later turn";

export interface TurnRevert {
  readonly restored: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<{ readonly id: string; readonly by: SkippedBy }>;
  readonly at: string;
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
  /** "" until someone names it; at most 60 characters. */
  readonly title: string;
  readonly titledBy: TitledBy | null;
  /** The artifacts it touched, in first-touch order. */
  readonly tags: ReadonlyArray<string>;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  /** The room clock when its last turn settled. */
  readonly lastClock: number | null;
  readonly latestTurn: LatestTurn | null;
  readonly session: ChatSession | null;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly activities: ReadonlyArray<ChatActivity>;
  readonly proposedPlans: ReadonlyArray<ProposedPlan>;
  readonly turns: ReadonlyArray<ChatTurn>;
}

/** One project's chats: the read model every command is decided against. */
export interface ProjectChats {
  readonly projectId: string;
  readonly chats: Readonly<Record<string, Chat>>;
  /** The sequence of the last event folded in. */
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

/** Commands the web dispatches. */
export type ClientCommand = CommandBase &
  (
    | {
        readonly type: "thread.create";
        readonly modelSelection: ModelSelection;
        readonly runtimeMode: RuntimeMode;
        readonly interactionMode: InteractionMode;
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
          /** Resolved by the engine from the stored files before the decider sees them. */
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
    | { readonly type: "thread.user-input.respond"; readonly requestId: string; readonly answers: Readonly<Record<string, unknown>> }
    | { readonly type: "thread.user-input.dismiss"; readonly requestId: string }
    | { readonly type: "thread.turn.revert"; readonly turnCount: number }
    | { readonly type: "thread.checkpoint.revert"; readonly turnCount: number; readonly restoreCanvas: boolean }
    | { readonly type: "thread.session.stop" }
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

/** Commands only the engine's reactors dispatch. */
export type InternalCommand = CommandBase &
  (
    | { readonly type: "thread.session.set"; readonly session: ChatSession }
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
    | { readonly type: "thread.revert.complete"; readonly turnCount: number }
    | { readonly type: "thread.title.generate.complete"; readonly title: string }
    | { readonly type: "thread.turn.settle"; readonly turnCount: number; readonly clock: number | null; readonly usage?: unknown }
  );

export type ChatCommand = ClientCommand | InternalCommand;

/** An event as the decider emits it, before the engine stamps its base fields. */
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
  | "thread.turn-files-completed"
  | "thread.turn-revert-requested"
  | "thread.turn-reverted"
  | "thread.turn-settled";

/** A committed event, with t3code's base fields. */
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
