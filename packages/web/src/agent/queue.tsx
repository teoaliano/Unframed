import { openRequests, type Chat } from "@unframed/domain";
import { useEffect } from "react";
import { sendMessage } from "./send.ts";
import { useQueue, useQueuedThreads, useWatchedThread, type ChatClient, type QueuedMessage } from "./store.ts";

/** The chat's latest completed tool call: a queued message waits for the next one. */
export const latestCompletedTool = (chat: Chat | undefined): string | null => {
  let latest: { id: string; sequence: number } | undefined;
  for (const activity of chat?.activities ?? []) {
    if (activity.kind !== "tool.completed") continue;
    if (!latest || activity.sequence > latest.sequence) latest = { id: activity.id, sequence: activity.sequence };
  }
  return latest?.id ?? null;
};

/**
 * A queued message is due mid-turn once a tool call finished after it was queued, and as
 * soon as the turn is over otherwise (t3code's rule). An approval or a question waiting
 * blocks the queue: a message landing on top of one would answer nothing.
 */
export const isDue = (chat: Chat, message: QueuedMessage): boolean => {
  if (openRequests(chat, "approval").length > 0 || openRequests(chat, "user-input").length > 0) return false;
  if (chat.latestTurn?.state !== "running") return true;
  return latestCompletedTool(chat) !== message.after;
};

/** Sends one queued message as a steer: it joins the running turn, or starts the next one when none runs. */
export const sendQueued = async (client: ChatClient, threadId: string, id: string): Promise<void> => {
  const item = client.queue(threadId).find((known) => known.id === id);
  if (!item || item.state === "sending") return;
  const boundary = latestCompletedTool(client.thread(threadId));
  // One per boundary: the rest wait for the next tool call or the end of the turn.
  client.updateQueue(threadId, (queue) => queue.map((known) => (known.id === id ? { ...known, state: "sending" } : { ...known, after: boundary })));
  try {
    await sendMessage(client, threadId, item.message, { steer: true });
    client.takeQueued(threadId, id);
  } catch (error) {
    client.updateQueue(threadId, (queue) => queue.map((known) => (known.id === id ? { ...known, state: "waiting" } : known)));
    client.reportError(error);
  }
};

/** Puts queued messages back into their chat's composer. */
export const returnQueued = (client: ChatClient, threadId: string, id?: string): void => {
  const taken = client.takeQueued(threadId, id);
  if (taken.length === 0) return;
  client.handOff(threadId, {
    text: taken.map((item) => item.message.text).join("\n\n"),
    selection: [...new Set(taken.flatMap((item) => item.message.selection))],
    attachments: taken.flatMap((item) => item.message.attachments),
  });
};

const ThreadQueueSender = ({ client, threadId }: { readonly client: ChatClient; readonly threadId: string }) => {
  const chat = useWatchedThread(client, threadId);
  const queue = useQueue(client, threadId);
  const head = queue[0];
  useEffect(() => {
    if (!chat || !head || head.state !== "waiting" || queue.some((item) => item.state === "sending")) return;
    // A send from here that the chat does not hold yet: wait for the engine to take it.
    if (client.inFlight(threadId)) return;
    if (isDue(chat, head)) void sendQueued(client, threadId, head.id);
  }, [client, threadId, chat, head, queue]);
  return null;
};

/**
 * Sends queued messages when they are due, for every chat with a queue, whether or not
 * the rail shows it. Mounted once with the canvas.
 */
export const QueueSender = ({ client }: { readonly client: ChatClient }) =>
  useQueuedThreads(client).map((threadId) => <ThreadQueueSender key={threadId} client={client} threadId={threadId} />);
