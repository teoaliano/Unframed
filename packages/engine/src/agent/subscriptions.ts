import type { ShellStreamItem, ThreadStreamItem } from "@unframed/contracts";
import { chatSummary, type Chat, type ChatEvent, type ProjectChats } from "@unframed/domain";
import type { ChatEngine } from "./chatEngine.ts";

type Emit<A> = (item: A) => void;

const live = (chat: Chat | undefined): chat is Chat => chat !== undefined && chat.deletedAt === null;

/**
 * The shell stream: the project's chats as summaries. A snapshot and `synchronized`, or with
 * `afterSequence` one upsert or removal per chat changed since, then one per later change.
 * The snapshot and the listener are taken in the same synchronous step, so nothing between
 * them is lost. Answers the function that stops it.
 */
export const openShell = (engine: ChatEngine, afterSequence: number | undefined, emit: Emit<ShellStreamItem>): (() => void) => {
  const model = engine.model;
  if (afterSequence === undefined || afterSequence > model.sequence) {
    emit({
      kind: "snapshot",
      sequence: model.sequence,
      chats: Object.values(model.chats)
        .filter(live)
        .map((chat) => ({ ...chatSummary(chat) })),
    });
  } else {
    const changed = new Set(engine.eventsAfter(afterSequence).map((event) => event.aggregateId));
    for (const id of changed) {
      const chat = model.chats[id];
      emit(live(chat) ? { kind: "chat-upserted", sequence: model.sequence, chat: { ...chatSummary(chat) } } : { kind: "chat-removed", sequence: model.sequence, id });
    }
  }
  emit({ kind: "synchronized", sequence: model.sequence });
  return engine.onCommit((events: ReadonlyArray<ChatEvent>, _before: ProjectChats, after: ProjectChats) => {
    const sequence = events.at(-1)?.sequence ?? after.sequence;
    for (const id of new Set(events.map((event) => event.aggregateId))) {
      const chat = after.chats[id];
      emit(live(chat) ? { kind: "chat-upserted", sequence, chat: { ...chatSummary(chat) } } : { kind: "chat-removed", sequence, id });
    }
  });
};

/**
 * The thread stream: one chat. A snapshot, or with `afterSequence` the chat's events past
 * it (the web de-duplicates by sequence), then `synchronized`, then each event as it
 * commits. Answers `undefined` when the chat does not exist.
 */
export const openThread = (
  engine: ChatEngine,
  chatId: string,
  afterSequence: number | undefined,
  emit: Emit<ThreadStreamItem>,
): (() => void) | undefined => {
  const chat = engine.chat(chatId);
  if (!live(chat)) return undefined;
  const sequence = engine.model.sequence;
  if (afterSequence === undefined || afterSequence > sequence) {
    emit({ kind: "snapshot", snapshot: { snapshotSequence: sequence, thread: chat } });
  } else {
    for (const event of engine.eventsAfter(afterSequence, chatId)) emit({ kind: "event", event: { ...event } });
  }
  emit({ kind: "synchronized", sequence });
  return engine.onCommit((events) => {
    for (const event of events) if (event.aggregateId === chatId) emit({ kind: "event", event: { ...event } });
  });
};
