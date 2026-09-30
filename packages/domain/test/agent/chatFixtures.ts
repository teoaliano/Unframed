import {
  decide,
  emptyProjectChats,
  projectChats,
  type ChatCommand,
  type ChatEvent,
  type ModelSelection,
  type PendingEvent,
  type ProjectChats,
} from "../../src/index.ts";

export const NOW = "2026-09-29T10:00:00.000Z";
export const CLAUDE: ModelSelection = { provider: "claude", model: "", traits: {} };

let sequence = 0;

/** A pending event as the engine commits it. */
export const commit = (pending: PendingEvent, occurredAt = NOW): ChatEvent => {
  sequence++;
  return {
    ...pending,
    sequence,
    eventId: `event-${sequence}`,
    aggregateKind: "thread",
    occurredAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: pending.metadata ?? {},
  };
};

type Distributive<T> = T extends unknown ? Omit<T, "commandId" | "projectId" | "threadId"> & { threadId?: string } : never;

/** Decides and applies, failing loudly on a rejection. */
export const run = (model: ProjectChats, command: Distributive<ChatCommand>): ProjectChats => {
  const decision = decide({ commandId: `c-${Math.random()}`, projectId: "board", threadId: "chat-1", ...command } as ChatCommand, model, NOW);
  if (!decision.ok) throw new Error(`rejected: ${decision.rejection.message}`);
  return decision.events.reduce((next, pending) => projectChats(next, commit(pending)), model);
};

/** Decides only. */
export const decideOn = (model: ProjectChats, command: Distributive<ChatCommand>) =>
  decide({ commandId: "c", projectId: "board", threadId: "chat-1", ...command } as ChatCommand, model, NOW);

export const created = (selection: ModelSelection = CLAUDE): ProjectChats =>
  run(emptyProjectChats("board"), {
    type: "thread.create",
    modelSelection: selection,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: NOW,
  });

export const started = (model = created(), text = "make the titles red", messageId = "m1"): ProjectChats =>
  run(model, { type: "thread.turn.start", message: { messageId, text, attachments: [] }, createdAt: NOW });

export const chatOf = (model: ProjectChats, id = "chat-1") => model.chats[id]!;
