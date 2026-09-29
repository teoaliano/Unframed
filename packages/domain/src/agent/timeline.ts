import type { Chat, ChatActivity, ChatMessage, ChatTurn, ProposedPlan } from "./chatModel.ts";
import { workLog, type WorkEntry } from "./workLog.ts";

export type TimelineBlock =
  | { readonly kind: "message"; readonly message: ChatMessage }
  | { readonly kind: "work"; readonly id: string; readonly entries: ReadonlyArray<WorkEntry> }
  | { readonly kind: "retry"; readonly activity: ChatActivity }
  | { readonly kind: "plan"; readonly plan: ProposedPlan };

export interface TimelineTurn {
  readonly key: string;
  readonly turn: ChatTurn | undefined;
  readonly settled: boolean;
  readonly blocks: ReadonlyArray<TimelineBlock>;
}

const WORK_KINDS = new Set(["tool.started", "tool.updated", "tool.completed", "task.started", "task.progress", "task.completed"]);

const isWork = (activity: ChatActivity) => WORK_KINDS.has(activity.kind) || (activity.tone === "error" && activity.kind !== "rate-limit");

/** What ties a tool call's or a sub-agent's activities together, as the work log merges them. */
const lifecycleOf = (activity: ChatActivity): string | undefined => {
  const payload = (typeof activity.payload === "object" && activity.payload !== null ? activity.payload : {}) as { itemId?: unknown; taskId?: unknown };
  if (activity.kind.startsWith("tool.") && payload.itemId !== undefined) return `tool:${String(payload.itemId)}`;
  if (activity.kind.startsWith("task.") && payload.taskId !== undefined) return `task:${String(payload.taskId)}`;
  return undefined;
};

/**
 * The transcript's turns (t3code's timeline): each turn's messages and work in the order
 * they happened, consecutive tool calls between two messages as one stretch of work.
 * Messages sent from here and not yet in a turn come last.
 *
 * Order comes from timestamps, which only go to the millisecond and are stamped as the
 * engine takes each item in, so a call's end can sort after the reply that follows it.
 * A call's later activities therefore join the stretch where it started, never a new one.
 */
export const buildTimeline = (chat: Chat): TimelineTurn[] => {
  const turns: TimelineTurn[] = [];
  const byTurn = new Map<string | null, { messages: ChatMessage[]; activities: ChatActivity[]; plans: ProposedPlan[] }>();
  const bucket = (turnId: string | null) => {
    let found = byTurn.get(turnId);
    if (!found) {
      found = { messages: [], activities: [], plans: [] };
      byTurn.set(turnId, found);
    }
    return found;
  };
  for (const message of chat.messages) bucket(message.turnId).messages.push(message);
  for (const plan of chat.proposedPlans) bucket(plan.turnId).plans.push(plan);
  for (const activity of chat.activities) if (isWork(activity) || activity.kind === "retry") bucket(activity.turnId).activities.push(activity);

  const view = (key: string, turn: ChatTurn | undefined, turnId: string | null): TimelineTurn => {
    const { messages, activities, plans } = byTurn.get(turnId) ?? { messages: [], activities: [], plans: [] };
    const settled = turn !== undefined && turn.state !== "running";
    type Item = { at: string; order: number; message?: ChatMessage; activity?: ChatActivity; plan?: ProposedPlan };
    const items: Item[] = [
      ...messages.map((message, order): Item => ({ at: message.createdAt, order, message })),
      ...activities.map((activity): Item => ({ at: activity.createdAt, order: messages.length + activity.sequence, activity })),
      ...plans.map((plan, order): Item => ({ at: plan.createdAt, order: Number.MAX_SAFE_INTEGER - plans.length + order, plan })),
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.order - b.order));
    // Stretches of work are built whole first, then logged: a call's end may land in an earlier one.
    const layout: Array<TimelineBlock | { readonly kind: "stretch"; readonly activities: ChatActivity[] }> = [];
    const started = new Map<string, ChatActivity[]>();
    let work: ChatActivity[] = [];
    const flush = () => {
      if (work.length === 0) return;
      layout.push({ kind: "stretch", activities: work });
      work = [];
    };
    for (const item of items) {
      if (item.activity && item.activity.kind === "retry") {
        flush();
        layout.push({ kind: "retry", activity: item.activity });
      } else if (item.activity) {
        const lifecycle = lifecycleOf(item.activity);
        const home = lifecycle === undefined ? undefined : started.get(lifecycle);
        if (home) {
          home.push(item.activity);
        } else {
          work.push(item.activity);
          if (lifecycle !== undefined) started.set(lifecycle, work);
        }
      } else if (item.message) {
        flush();
        layout.push({ kind: "message", message: item.message });
      } else if (item.plan) {
        flush();
        layout.push({ kind: "plan", plan: item.plan });
      }
    }
    flush();
    const blocks = layout.map((part): TimelineBlock =>
      part.kind === "stretch" ? { kind: "work", id: `work:${part.activities[0]!.id}`, entries: workLog(part.activities, { settled }) } : part,
    );
    return { key, turn, settled, blocks };
  };

  for (const turn of chat.turns) turns.push(view(turn.turnId, turn, turn.turnId));
  if (byTurn.has(null)) turns.push(view("unsent", undefined, null));
  return turns;
};
