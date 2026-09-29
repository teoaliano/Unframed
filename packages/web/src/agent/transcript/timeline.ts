import { workLog, type Chat, type ChatActivity, type ChatMessage, type ChatTurn, type WorkEntry } from "@unframed/domain";

export type Block =
  | { readonly kind: "message"; readonly message: ChatMessage }
  | { readonly kind: "work"; readonly id: string; readonly entries: ReadonlyArray<WorkEntry> }
  | { readonly kind: "retry"; readonly activity: ChatActivity };

export interface TurnView {
  readonly key: string;
  readonly turn: ChatTurn | undefined;
  readonly settled: boolean;
  readonly blocks: ReadonlyArray<Block>;
}

const WORK_KINDS = new Set(["tool.started", "tool.updated", "tool.completed", "task.started", "task.progress", "task.completed"]);

const isWork = (activity: ChatActivity) => WORK_KINDS.has(activity.kind) || (activity.tone === "error" && activity.kind !== "rate-limit");

/**
 * The transcript's turns (t3code's timeline): each turn's messages and work in the order
 * they happened, consecutive tool calls between two messages as one stretch of work.
 * Messages sent from here and not yet in a turn come last.
 */
export const buildTimeline = (chat: Chat): TurnView[] => {
  const turns: TurnView[] = [];
  const byTurn = new Map<string | null, { messages: ChatMessage[]; activities: ChatActivity[] }>();
  const bucket = (turnId: string | null) => {
    let found = byTurn.get(turnId);
    if (!found) {
      found = { messages: [], activities: [] };
      byTurn.set(turnId, found);
    }
    return found;
  };
  for (const message of chat.messages) bucket(message.turnId).messages.push(message);
  for (const activity of chat.activities) if (isWork(activity) || activity.kind === "retry") bucket(activity.turnId).activities.push(activity);

  const view = (key: string, turn: ChatTurn | undefined, turnId: string | null): TurnView => {
    const { messages, activities } = byTurn.get(turnId) ?? { messages: [], activities: [] };
    const settled = turn !== undefined && turn.state !== "running";
    type Item = { at: string; order: number; message?: ChatMessage; activity?: ChatActivity };
    const items: Item[] = [
      ...messages.map((message, order): Item => ({ at: message.createdAt, order, message })),
      ...activities.map((activity): Item => ({ at: activity.createdAt, order: messages.length + activity.sequence, activity })),
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.order - b.order));
    const blocks: Block[] = [];
    let work: ChatActivity[] = [];
    const flush = () => {
      if (work.length === 0) return;
      blocks.push({ kind: "work", id: `work:${work[0]!.id}`, entries: workLog(work, { settled }) });
      work = [];
    };
    for (const item of items) {
      if (item.activity && item.activity.kind === "retry") {
        flush();
        blocks.push({ kind: "retry", activity: item.activity });
      } else if (item.activity) {
        work.push(item.activity);
      } else if (item.message) {
        flush();
        blocks.push({ kind: "message", message: item.message });
      }
    }
    flush();
    return { key, turn, settled, blocks };
  };

  for (const turn of chat.turns) turns.push(view(turn.turnId, turn, turn.turnId));
  if (byTurn.has(null)) turns.push(view("unsent", undefined, null));
  return turns;
};
