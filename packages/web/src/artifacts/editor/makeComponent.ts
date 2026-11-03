/**
 * Make component (spec 20): sends the element's chip and the fixed instruction to the artifact's own
 * chat, the newest idle one tagged with it or a new one, and opens the rail on that chat.
 */
import { continuableChat, DEFAULT_RUNTIME_MODE, elementChip, MAKE_COMPONENT_TEMPLATE, type ArtifactKind, type ChipElement } from "@unframed/domain";
import { readyProviders } from "../../agent/providers.ts";
import { createChat, sendMessage } from "../../agent/send.ts";
import type { ChatClient } from "../../agent/store.ts";
import { showError } from "../../toasts.tsx";

export interface MakeComponentInput {
  readonly client: ChatClient;
  /** The provider statuses the store last read, used when the client has not loaded its own. */
  readonly statuses: Parameters<typeof readyProviders>[0];
  readonly shapeId: string;
  readonly kind: ArtifactKind;
  readonly title: string;
  readonly element: ChipElement;
}

/** The instruction for an artifact: its kind word and title filled into the asset's placeholders. */
export const makeComponentInstruction = (kind: ArtifactKind, title: string): string => MAKE_COMPONENT_TEMPLATE.split("<kind>").join(kind).replace("<title>", title);

export const makeComponent = async ({ client, statuses, shapeId, kind, title, element }: MakeComponentInput): Promise<void> => {
  if (client.providers === undefined) await client.loadProviders();
  const ready = readyProviders(client.providers ?? statuses);
  if (ready.length === 0) {
    showError("Connect Claude or Codex first.");
    return;
  }
  const instruction = makeComponentInstruction(kind, title);
  const target =
    continuableChat(client.chats(), [shapeId])?.id ??
    (await createChat(
      client,
      { modelSelection: { provider: ready[0]!, model: "", traits: {} }, runtimeMode: DEFAULT_RUNTIME_MODE, interactionMode: "default", tags: [shapeId] },
      instruction,
    ));
  client.setUi({ open: true, chosen: target, pinned: null });
  await sendMessage(client, target, { text: instruction, selection: [shapeId], attachments: [], elements: [elementChip(element, { shapeId })] });
};
