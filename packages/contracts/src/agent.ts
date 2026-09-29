/**
 * The agent runtime's wire shapes (spec 07): provider statuses, the chat commands the web
 * dispatches, the chat read model and the two subscriptions. Protocol names keep t3code's
 * `thread.*` spelling; everything a person reads says "chat".
 */
import * as Schema from "effect/Schema";

export const AgentProvider = Schema.Literals(["claude", "codex"]);
export type AgentProvider = typeof AgentProvider.Type;

export const RuntimeMode = Schema.Literals(["approval-required", "auto-accept-edits", "auto", "full-access"]);
export type RuntimeMode = typeof RuntimeMode.Type;

export const InteractionMode = Schema.Literals(["default", "plan"]);
export type InteractionMode = typeof InteractionMode.Type;

export const Effort = Schema.Literals(["low", "medium", "high", "xhigh", "max"]);

export const Traits = Schema.Struct({
  effort: Schema.optionalKey(Effort),
  thinking: Schema.optionalKey(Schema.Boolean),
  fastMode: Schema.optionalKey(Schema.Boolean),
});

export const ModelSelection = Schema.Struct({
  provider: AgentProvider,
  model: Schema.String,
  traits: Traits,
});
export type ModelSelection = typeof ModelSelection.Type;

// ---------------------------------------------------------------------------------------
// Provider statuses.

export const ProviderStatusKind = Schema.Literals(["not_installed", "wont_run", "auth_unknown", "signed_out", "ready"]);

export const ProviderModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  efforts: Schema.Array(Schema.String),
  legacy: Schema.Boolean,
  defaultEffort: Schema.optionalKey(Schema.String),
  thinking: Schema.optionalKey(Schema.Boolean),
  fastMode: Schema.optionalKey(Schema.Boolean),
});
export type ProviderModel = typeof ProviderModel.Type;

/** A slash command or a skill the composer offers (spec 08). */
export const ProviderCommand = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
});

/** One provider as the web sees it. The executable path is never part of it. */
export const ProviderStatus = Schema.Struct({
  kind: AgentProvider,
  name: Schema.String,
  status: ProviderStatusKind,
  installed: Schema.Boolean,
  version: Schema.NullOr(Schema.String),
  message: Schema.optionalKey(Schema.String),
  auth: Schema.optionalKey(Schema.Struct({ email: Schema.optionalKey(Schema.String), plan: Schema.optionalKey(Schema.String) })),
  models: Schema.optionalKey(Schema.Array(ProviderModel)),
  commands: Schema.optionalKey(Schema.Array(ProviderCommand)),
  skills: Schema.optionalKey(Schema.Array(ProviderCommand)),
  install: Schema.String,
  checkedAt: Schema.String,
});
export type ProviderStatus = typeof ProviderStatus.Type;

export const ProviderStatuses = Schema.Struct({ claude: ProviderStatus, codex: ProviderStatus });
export type ProviderStatuses = typeof ProviderStatuses.Type;

// ---------------------------------------------------------------------------------------
// Attachments.

export const AttachmentKind = Schema.Literals(["image", "file"]);

/** What a stored message keeps per attachment: never bytes. */
export const ChatAttachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  kind: AttachmentKind,
  size: Schema.Number,
});
export type ChatAttachment = typeof ChatAttachment.Type;

/**
 * An attachment as a message names it. Only `id` names the file; the engine re-derives
 * the kind, type and size from the stored bytes, so any claimed here are ignored.
 */
export const AttachmentRef = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(AttachmentKind),
  size: Schema.optionalKey(Schema.Number),
});

export const CreateUploadUrlInput = Schema.Struct({
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
});

export const CreateUploadUrlAnswer = Schema.Struct({ relativeUrl: Schema.String, expiresAt: Schema.String });

// ---------------------------------------------------------------------------------------
// Commands the web dispatches.

const Base = {
  commandId: Schema.String,
  projectId: Schema.String,
  threadId: Schema.String,
};

export const MessageContext = Schema.Struct({ selection: Schema.Array(Schema.String) });

export const ApprovalDecision = Schema.Literals(["accept", "acceptForSession", "decline", "cancel"]);
export type ApprovalDecision = typeof ApprovalDecision.Type;

export const ClientChatCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("thread.create"),
    ...Base,
    modelSelection: ModelSelection,
    /** Full access when absent. */
    runtimeMode: Schema.optionalKey(RuntimeMode),
    interactionMode: Schema.optionalKey(InteractionMode),
    tags: Schema.optionalKey(Schema.Array(Schema.String)),
    createdAt: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("thread.delete"), ...Base }),
  Schema.Struct({
    type: Schema.Literal("thread.meta.update"),
    ...Base,
    title: Schema.optionalKey(Schema.String),
    modelSelection: Schema.optionalKey(ModelSelection),
  }),
  Schema.Struct({ type: Schema.Literal("thread.runtime-mode.set"), ...Base, runtimeMode: RuntimeMode }),
  Schema.Struct({ type: Schema.Literal("thread.interaction-mode.set"), ...Base, interactionMode: InteractionMode }),
  Schema.Struct({
    type: Schema.Literal("thread.turn.start"),
    ...Base,
    message: Schema.Struct({
      messageId: Schema.String,
      text: Schema.String,
      attachments: Schema.Array(AttachmentRef),
      context: Schema.optionalKey(MessageContext),
    }),
    steer: Schema.optionalKey(Schema.Boolean),
    modelSelection: Schema.optionalKey(ModelSelection),
    sourceProposedPlan: Schema.optionalKey(Schema.Struct({ threadId: Schema.String, planId: Schema.String })),
    createdAt: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("thread.turn.interrupt"), ...Base, turnId: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("thread.approval.respond"), ...Base, requestId: Schema.String, decision: ApprovalDecision }),
  Schema.Struct({
    type: Schema.Literal("thread.user-input.respond"),
    ...Base,
    requestId: Schema.String,
    answers: Schema.Record(Schema.String, Schema.Unknown),
  }),
  Schema.Struct({ type: Schema.Literal("thread.user-input.dismiss"), ...Base, requestId: Schema.String }),
  Schema.Struct({ type: Schema.Literal("thread.turn.revert"), ...Base, turnCount: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("thread.checkpoint.revert"), ...Base, turnCount: Schema.Number, restoreCanvas: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("thread.session.stop"), ...Base }),
]);
export type ClientChatCommand = typeof ClientChatCommand.Type;

// ---------------------------------------------------------------------------------------
// The chat read model.

export const ChatMessage = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant", "reasoning"]),
  text: Schema.String,
  turnId: Schema.NullOr(Schema.String),
  streaming: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  attachments: Schema.optionalKey(Schema.Array(ChatAttachment)),
  context: Schema.optionalKey(MessageContext),
});

export const ChatActivity = Schema.Struct({
  id: Schema.String,
  tone: Schema.Literals(["info", "tool", "approval", "error"]),
  kind: Schema.String,
  summary: Schema.String,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(Schema.String),
  sequence: Schema.Number,
  createdAt: Schema.String,
});

export const ProposedPlan = Schema.Struct({
  id: Schema.String,
  turnId: Schema.NullOr(Schema.String),
  planMarkdown: Schema.String,
  implementedAt: Schema.NullOr(Schema.String),
  implementationThreadId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const TurnState = Schema.Literals(["running", "interrupted", "completed", "error"]);

/** A shape a turn touched, as the recap lists it. `file` and `previousFile` are a page or motion's. */
export const TurnFile = Schema.Struct({
  shapeId: Schema.String,
  kind: Schema.String,
  change: Schema.Literals(["created", "updated", "deleted"]),
  file: Schema.optionalKey(Schema.String),
  previousFile: Schema.optionalKey(Schema.String),
});

export const TurnRevert = Schema.Struct({
  restored: Schema.Array(Schema.String),
  skipped: Schema.Array(Schema.Struct({ id: Schema.String, by: Schema.Literals(["person", "another chat", "a later turn"]) })),
  at: Schema.String,
});

export const ChatTurn = Schema.Struct({
  turnId: Schema.String,
  turnCount: Schema.Number,
  state: TurnState,
  requestedAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  pendingMessageId: Schema.NullOr(Schema.String),
  assistantMessageId: Schema.NullOr(Schema.String),
  usage: Schema.optionalKey(Schema.Unknown),
  files: Schema.optionalKey(Schema.Array(TurnFile)),
  reverted: Schema.optionalKey(TurnRevert),
  revertRequestedAt: Schema.optionalKey(Schema.String),
});

export const LatestTurn = Schema.Struct({
  turnId: Schema.String,
  turnCount: Schema.Number,
  state: TurnState,
  requestedAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  assistantMessageId: Schema.NullOr(Schema.String),
});

export const SessionStatus = Schema.Literals(["idle", "starting", "running", "ready", "interrupted", "stopped", "error"]);

export const ChatSession = Schema.Struct({
  status: SessionStatus,
  activeTurnId: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
});

export const Chat = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  deletedAt: Schema.NullOr(Schema.String),
  title: Schema.String,
  titledBy: Schema.NullOr(Schema.Literals(["user", "agent"])),
  tags: Schema.Array(Schema.String),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: InteractionMode,
  lastClock: Schema.NullOr(Schema.Number),
  latestTurn: Schema.NullOr(LatestTurn),
  session: Schema.NullOr(ChatSession),
  messages: Schema.Array(ChatMessage),
  activities: Schema.Array(ChatActivity),
  proposedPlans: Schema.Array(ProposedPlan),
  turns: Schema.Array(ChatTurn),
});
export type Chat = typeof Chat.Type;

export const ChatSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  titledBy: Schema.NullOr(Schema.Literals(["user", "agent"])),
  preview: Schema.String,
  tags: Schema.Array(Schema.String),
  provider: AgentProvider,
  model: Schema.String,
  status: Schema.Literals(["running", "failed", "idle"]),
  hasPendingApproval: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
  turnCount: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ChatSummary = typeof ChatSummary.Type;

/** One committed event, with t3code's base fields. Payloads are typed by the domain projector. */
export const ChatEvent = Schema.Struct({
  sequence: Schema.Number,
  eventId: Schema.String,
  aggregateKind: Schema.Literal("thread"),
  aggregateId: Schema.String,
  occurredAt: Schema.String,
  commandId: Schema.NullOr(Schema.String),
  causationEventId: Schema.NullOr(Schema.String),
  correlationId: Schema.NullOr(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  type: Schema.String,
  payload: Schema.Unknown,
});

export const ShellStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), sequence: Schema.Number, chats: Schema.Array(ChatSummary) }),
  Schema.Struct({ kind: Schema.Literal("synchronized"), sequence: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("chat-upserted"), sequence: Schema.Number, chat: ChatSummary }),
  Schema.Struct({ kind: Schema.Literal("chat-removed"), sequence: Schema.Number, id: Schema.String }),
]);
export type ShellStreamItem = typeof ShellStreamItem.Type;

export const ThreadStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: Schema.Struct({ snapshotSequence: Schema.Number, thread: Chat }) }),
  Schema.Struct({ kind: Schema.Literal("synchronized"), sequence: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("event"), event: ChatEvent }),
]);
export type ThreadStreamItem = typeof ThreadStreamItem.Type;
