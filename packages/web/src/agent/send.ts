import type { ChatAttachment, ModelSelection } from "@unframed/contracts";
import type { InteractionMode, RuntimeMode } from "@unframed/domain";
import { newId, type ChatClient } from "./store.ts";

/** A message ready to go: the text the model reads, its context and its uploaded attachments. */
export interface Outgoing {
  readonly text: string;
  readonly selection: ReadonlyArray<string>;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}

export interface NewChat {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  /** The selected artifacts; the engine keeps only those the canvas says are artifacts. */
  readonly tags: ReadonlyArray<string>;
  readonly title?: string;
}

export { messageOf } from "./store.ts";

/** Creates a chat and makes it the rail's active one before the engine answers, so its tab shows at once. */
export const createChat = async (client: ChatClient, chat: NewChat, preview = ""): Promise<string> => {
  const threadId = newId("chat");
  const now = new Date().toISOString();
  client.expectChat({
    id: threadId,
    title: chat.title ?? "",
    titledBy: null,
    preview: preview.slice(0, 80),
    tags: [...chat.tags],
    provider: chat.modelSelection.provider,
    model: chat.modelSelection.model,
    status: "idle",
    hasPendingApproval: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    turnCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  client.setUi({ chosen: threadId, pinned: null });
  try {
    await client.dispatch({
      type: "thread.create",
      threadId,
      modelSelection: chat.modelSelection,
      runtimeMode: chat.runtimeMode,
      interactionMode: chat.interactionMode,
      tags: [...chat.tags],
      createdAt: now,
    });
    if (chat.title !== undefined && chat.title !== "") await client.dispatch({ type: "thread.meta.update", threadId, title: chat.title });
  } catch (error) {
    client.forgetChat(threadId);
    throw error;
  }
  client.created(threadId);
  return threadId;
};

/** Sends one message into a chat, shown at once as the person's message. */
export const sendMessage = async (
  client: ChatClient,
  threadId: string,
  message: Outgoing,
  options: { readonly steer?: boolean; readonly sourceProposedPlan?: { threadId: string; planId: string } } = {},
): Promise<void> => {
  const messageId = newId("message");
  const now = new Date().toISOString();
  client.addOptimistic(threadId, {
    id: messageId,
    role: "user",
    text: message.text,
    turnId: null,
    streaming: false,
    createdAt: now,
    updatedAt: now,
    ...(message.attachments.length > 0 ? { attachments: message.attachments } : {}),
    ...(message.selection.length > 0 ? { context: { selection: message.selection } } : {}),
  });
  try {
    await client.dispatch({
      type: "thread.turn.start",
      threadId,
      message: {
        messageId,
        text: message.text,
        attachments: message.attachments.map((attachment) => ({ id: attachment.id, name: attachment.name })),
        ...(message.selection.length > 0 ? { context: { selection: [...message.selection] } } : {}),
      },
      ...(options.steer ? { steer: true } : {}),
      ...(options.sourceProposedPlan ? { sourceProposedPlan: options.sourceProposedPlan } : {}),
      createdAt: now,
    });
  } catch (error) {
    client.dropOptimistic(threadId, messageId);
    throw error;
  }
};
