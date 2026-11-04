import { openRequests, type Chat } from "@unframed/domain";
import { useEffect } from "react";
import { sendMessage } from "./send.ts";
import { useQueue, useQueuedThreads, useWatchedThread, type ChatClient, type QueuedMessage } from "./store.ts";

export const latestCompletedTool = (chat: Chat | undefined): string | null => {
  let latest: { id: string; sequence: number } | undefined;
  for (const activity of chat?.activities ?? []) {
    if (activity.kind !== "tool.completed") continue;
    if (!latest || activity.sequence > latest.sequence) latest = { id: activity.id, sequence: activity.sequence };
  }
  return latest?.id ?? null;
};

const isDue = (chat: Chat, message: QueuedMessage): boolean => {
  if (openRequests(chat, "approval").length > 0 || openRequests(chat, "user-input").length > 0) return false;
  if (chat.latestTurn?.state !== "running") return true;
  return latestCompletedTool(chat) !== message.after;
};

export const sendQueued = async (client: ChatClient, threadId: string, id: string): Promise<void> => {
  const item = client.queue(threadId).find((known) => known.id === id);
  if (!item || item.state === "sending") return;
  const boundary = latestCompletedTool(client.thread(threadId));
  client.updateQueue(threadId, (queue) => queue.map((known) => (known.id === id ? { ...known, state: "sending" } : { ...known, after: boundary })));
  try {
    await sendMessage(client, threadId, item.message, { steer: true });
    client.takeQueued(threadId, id);
  } catch (error) {
    client.updateQueue(threadId, (queue) => queue.map((known) => (known.id === id ? { ...known, state: "waiting" } : known)));
    client.reportError(error);
  }
};

export const returnQueued = (client: ChatClient, threadId: string, id?: string): void => {
  const taken = client.takeQueued(threadId, id);
  if (taken.length === 0) return;
  client.handOff(threadId, {
    text: taken.map((item) => item.message.text).join("\n\n"),
    selection: [...new Set(taken.flatMap((item) => item.message.selection))],
    attachments: taken.flatMap((item) => item.message.attachments),
    elements: taken.flatMap((item) => item.message.elements ?? []),
  });
};

const ThreadQueueSender = ({ client, threadId }: { readonly client: ChatClient; readonly threadId: string }) => {
  const chat = useWatchedThread(client, threadId);
  const queue = useQueue(client, threadId);
  const head = queue[0];
  useEffect(() => {
    if (!chat || !head || head.state !== "waiting" || queue.some((item) => item.state === "sending")) return;
    if (client.inFlight(threadId)) return;
    if (isDue(chat, head)) void sendQueued(client, threadId, head.id);
  }, [client, threadId, chat, head, queue]);
  return null;
};

export const QueueSender = ({ client }: { readonly client: ChatClient }) =>
  useQueuedThreads(client).map((threadId) => <ThreadQueueSender key={threadId} client={client} threadId={threadId} />);
