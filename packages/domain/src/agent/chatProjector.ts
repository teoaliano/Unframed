/**
 * The chat projector (spec 07, t3code's shape): folds committed events into the read model.
 * Pure: the engine uses it for its in-memory model and the web for a reconnecting rail.
 */
import type {
  Chat,
  ChatActivity,
  ChatEvent,
  ChatMessage,
  ChatSession,
  ChatTurn,
  LatestTurn,
  ModelSelection,
  ProjectChats,
  ProposedPlan,
  SessionStatus,
  TurnState,
} from "./chatModel.ts";

const latestOf = (turn: ChatTurn | undefined): LatestTurn | null =>
  turn === undefined
    ? null
    : {
        turnId: turn.turnId,
        turnCount: turn.turnCount,
        state: turn.state,
        requestedAt: turn.requestedAt,
        startedAt: turn.startedAt,
        completedAt: turn.completedAt,
        assistantMessageId: turn.assistantMessageId,
      };

const withTurns = (chat: Chat, turns: ReadonlyArray<ChatTurn>): Chat => ({ ...chat, turns, latestTurn: latestOf(turns.at(-1)) });

const updateTurn = (chat: Chat, turnId: string, update: (turn: ChatTurn) => ChatTurn): Chat =>
  withTurns(
    chat,
    chat.turns.map((turn) => (turn.turnId === turnId ? update(turn) : turn)),
  );

/** What leaving `running` for `status` makes of a running turn; `undefined` while it still runs. */
export const settledState = (status: SessionStatus): TurnState | undefined => {
  switch (status) {
    case "running":
    case "starting":
      return undefined;
    case "idle":
    case "ready":
      return "completed";
    case "error":
      return "error";
    case "interrupted":
    case "stopped":
      return "interrupted";
  }
};

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const applyToChat = (chat: Chat, event: ChatEvent): Chat => {
  const p = event.payload as Record<string, any>;
  const at = event.occurredAt;
  switch (event.type) {
    case "thread.deleted":
      return { ...chat, deletedAt: str(p.deletedAt) || at, updatedAt: at };
    case "thread.meta-updated": {
      let next: Chat = { ...chat, updatedAt: at };
      if ("title" in p) next = { ...next, title: str(p.title), titledBy: (p.titledBy ?? null) as Chat["titledBy"] };
      if (p.modelSelection) next = { ...next, modelSelection: p.modelSelection as ModelSelection };
      return next;
    }
    case "thread.runtime-mode-set":
      return { ...chat, runtimeMode: p.runtimeMode, updatedAt: at };
    case "thread.interaction-mode-set":
      return { ...chat, interactionMode: p.interactionMode, updatedAt: at };
    case "thread.message-sent": {
      const id = str(p.messageId);
      const existing = chat.messages.find((message) => message.id === id);
      let messages: ReadonlyArray<ChatMessage>;
      if (existing) {
        const text = p.streaming ? existing.text + str(p.text) : str(p.text) !== "" ? str(p.text) : existing.text;
        messages = chat.messages.map((message) => (message.id === id ? { ...message, text, streaming: p.streaming === true, updatedAt: at } : message));
      } else {
        const message: ChatMessage = {
          id,
          role: p.role,
          text: str(p.text),
          turnId: (p.turnId ?? null) as string | null,
          streaming: p.streaming === true,
          createdAt: str(p.createdAt) || at,
          updatedAt: at,
          ...(Array.isArray(p.attachments) && p.attachments.length > 0 ? { attachments: p.attachments } : {}),
          ...(p.context ? { context: p.context } : {}),
        };
        messages = [...chat.messages, message];
      }
      let next: Chat = { ...chat, messages, updatedAt: at };
      const turnId = (p.turnId ?? null) as string | null;
      if (p.role === "assistant" && turnId !== null) {
        next = updateTurn(next, turnId, (turn) => (turn.assistantMessageId === null ? { ...turn, assistantMessageId: id } : turn));
      }
      return next;
    }
    case "thread.turn-start-requested": {
      if (p.steer === true) return { ...chat, updatedAt: at };
      const turn: ChatTurn = {
        turnId: str(p.turnId),
        turnCount: Number(p.turnCount),
        state: "running",
        requestedAt: at,
        startedAt: null,
        completedAt: null,
        pendingMessageId: (p.messageId ?? null) as string | null,
        assistantMessageId: null,
      };
      return withTurns({ ...chat, updatedAt: at }, [...chat.turns, turn]);
    }
    case "thread.session-set": {
      const session = p.session as ChatSession;
      let next: Chat = { ...chat, session, updatedAt: at };
      const latest = next.latestTurn;
      if (latest?.state === "running") {
        const settled = settledState(session.status);
        if (settled !== undefined) {
          next = updateTurn(next, latest.turnId, (turn) => ({ ...turn, state: settled, completedAt: at, startedAt: turn.startedAt ?? at }));
        } else if (session.status === "running") {
          next = updateTurn(next, latest.turnId, (turn) => ({ ...turn, startedAt: turn.startedAt ?? at }));
        }
      }
      return next;
    }
    case "thread.turn-settled": {
      const clock = typeof p.clock === "number" ? p.clock : null;
      let next: Chat = { ...chat, updatedAt: at, ...(clock === null ? {} : { lastClock: clock }) };
      if (p.usage !== undefined) {
        next = withTurns(
          next,
          next.turns.map((turn) => (turn.turnCount === p.turnCount ? { ...turn, usage: p.usage } : turn)),
        );
      }
      return next;
    }
    case "thread.proposed-plan-upserted": {
      const plan = p.plan as ProposedPlan;
      const exists = chat.proposedPlans.some((known) => known.id === plan.id);
      return {
        ...chat,
        updatedAt: at,
        proposedPlans: exists ? chat.proposedPlans.map((known) => (known.id === plan.id ? plan : known)) : [...chat.proposedPlans, plan],
      };
    }
    case "thread.activity-appended": {
      const activity: ChatActivity = { ...(p.activity as Omit<ChatActivity, "sequence">), sequence: event.sequence };
      return { ...chat, updatedAt: at, activities: [...chat.activities, activity] };
    }
    case "thread.tagged": {
      const tags = [...chat.tags];
      for (const id of (p.ids as string[]) ?? []) if (!tags.includes(id)) tags.push(id);
      return { ...chat, tags, updatedAt: at };
    }
    case "thread.turn-files-completed":
      return withTurns(
        { ...chat, updatedAt: at },
        chat.turns.map((turn) => (turn.turnCount === p.turnCount ? { ...turn, files: p.files } : turn)),
      );
    case "thread.turn-reverted":
      return withTurns(
        { ...chat, updatedAt: at },
        chat.turns.map((turn) =>
          turn.turnCount === p.turn ? { ...turn, reverted: { restored: p.restored ?? [], skipped: p.skipped ?? [], at: str(p.at) || at } } : turn,
        ),
      );
    case "thread.turn-revert-requested":
      return withTurns(
        { ...chat, updatedAt: at },
        chat.turns.map((turn) => (turn.turnCount === p.turnCount ? { ...turn, revertRequestedAt: at } : turn)),
      );
    case "thread.reverted": {
      const keep = Number(p.turnCount);
      const dropped = new Set(chat.turns.filter((turn) => turn.turnCount > keep).map((turn) => turn.turnId));
      const kept = (turnId: string | null) => turnId === null || !dropped.has(turnId);
      return withTurns(
        {
          ...chat,
          updatedAt: at,
          messages: chat.messages.filter((message) => kept(message.turnId)),
          activities: chat.activities.filter((activity) => kept(activity.turnId)),
          proposedPlans: chat.proposedPlans.filter((plan) => kept(plan.turnId)),
        },
        chat.turns.filter((turn) => turn.turnCount <= keep),
      );
    }
    case "thread.turn-interrupt-requested":
    case "thread.approval-response-requested":
    case "thread.user-input-response-requested":
    case "thread.checkpoint-revert-requested":
    case "thread.session-stop-requested":
      return chat;
    case "thread.created":
      return chat;
  }
};

/** Folds one event into a project's chats. */
export const projectChats = (model: ProjectChats, event: ChatEvent): ProjectChats => {
  const id = event.aggregateId;
  if (event.type === "thread.created") {
    const p = event.payload as Record<string, any>;
    const created = str(p.createdAt) || event.occurredAt;
    const chat: Chat = {
      id,
      projectId: model.projectId,
      createdAt: created,
      updatedAt: created,
      deletedAt: null,
      title: "",
      titledBy: null,
      tags: (p.tags as string[]) ?? [],
      modelSelection: p.modelSelection,
      runtimeMode: p.runtimeMode,
      interactionMode: p.interactionMode,
      lastClock: null,
      latestTurn: null,
      session: null,
      messages: [],
      activities: [],
      proposedPlans: [],
      turns: [],
    };
    return { ...model, sequence: event.sequence, chats: { ...model.chats, [id]: chat } };
  }
  const chat = model.chats[id];
  if (!chat) return { ...model, sequence: event.sequence };
  return { ...model, sequence: event.sequence, chats: { ...model.chats, [id]: applyToChat(chat, event) } };
};

/** One chat's events folded, for a client that holds a single chat. */
export const projectChat = (chat: Chat, event: ChatEvent): Chat => (event.aggregateId === chat.id ? applyToChat(chat, event) : chat);

const requestId = (activity: ChatActivity): string | undefined => {
  const id = (activity.payload as { requestId?: unknown } | null)?.requestId;
  return typeof id === "string" ? id : undefined;
};

/**
 * The requests still open, derived from activities as t3code does: a `*.requested`
 * activity opens one and the matching `*.resolved` closes it.
 */
export const openRequests = (chat: Chat, kind: "approval" | "user-input"): ChatActivity[] => {
  const open = new Map<string, ChatActivity>();
  for (const activity of chat.activities) {
    const id = requestId(activity);
    if (id === undefined) continue;
    if (activity.kind === `${kind}.requested`) open.set(id, activity);
    else if (activity.kind === `${kind}.resolved`) open.delete(id);
  }
  return [...open.values()];
};

/** The request's latest activity of that kind: requested (open) or resolved. */
export const requestActivity = (chat: Chat, kind: "approval" | "user-input", id: string): ChatActivity | undefined => {
  let found: ChatActivity | undefined;
  for (const activity of chat.activities) {
    if (requestId(activity) !== id) continue;
    if (activity.kind === `${kind}.requested` || activity.kind === `${kind}.resolved`) found = activity;
  }
  return found;
};

export interface ChatSummaryView {
  readonly id: string;
  readonly title: string;
  readonly titledBy: Chat["titledBy"];
  readonly preview: string;
  readonly tags: ReadonlyArray<string>;
  readonly provider: ModelSelection["provider"];
  readonly model: string;
  readonly status: "running" | "failed" | "idle";
  readonly hasPendingApproval: boolean;
  readonly hasPendingUserInput: boolean;
  readonly hasActionableProposedPlan: boolean;
  readonly turnCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A chat as the rail's tabs need it. */
export const chatSummary = (chat: Chat): ChatSummaryView => {
  const latest = chat.latestTurn;
  const latestPlan = chat.proposedPlans.at(-1);
  return {
    id: chat.id,
    title: chat.title,
    titledBy: chat.titledBy,
    preview: (chat.messages.find((message) => message.role === "user")?.text ?? "").slice(0, 80),
    tags: chat.tags,
    provider: chat.modelSelection.provider,
    model: chat.modelSelection.model,
    status: latest?.state === "running" ? "running" : latest?.state === "error" ? "failed" : "idle",
    hasPendingApproval: openRequests(chat, "approval").length > 0,
    hasPendingUserInput: openRequests(chat, "user-input").length > 0,
    hasActionableProposedPlan: latestPlan !== undefined && latestPlan.implementedAt === null,
    turnCount: chat.turns.length,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
};
