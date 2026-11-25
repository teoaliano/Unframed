import { DEFAULT_RUNTIME_MODE } from "@unframed/domain";
import type { TLShapeId } from "tldraw";
import { readyProviders } from "../agent/providers.ts";
import { createChat, sendMessage } from "../agent/send.ts";
import { useChatClient } from "../agent/store.ts";
import { useCanvasProject, useEngine } from "../context.ts";

export const NO_PROVIDER = "Connect Claude or Codex first.";

export const useAskAgent = () => {
  const client = useChatClient(useEngine(), useCanvasProject());
  return async (shapeId: TLShapeId, instruction: string): Promise<void> => {
    if (client.providers === undefined) await client.loadProviders();
    const ready = readyProviders(client.providers);
    if (ready.length === 0) throw new Error(NO_PROVIDER);
    const chatId = await createChat(client, { modelSelection: { provider: ready[0]!, model: "", traits: {} }, runtimeMode: DEFAULT_RUNTIME_MODE, interactionMode: "default", tags: [shapeId] }, instruction);
    client.setUi({ open: true, chosen: chatId, pinned: null });
    await sendMessage(client, chatId, { text: instruction, selection: [shapeId], attachments: [] });
  };
};
