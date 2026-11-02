/**
 * Point and tell (spec 18): puts the pointed-at elements into the artifact's chat composer. The
 * chat is the newest idle one tagged with the artifact (spec 08's continuable chat), else a new one.
 */
import type { ElementChip } from "@unframed/contracts";
import { continuableChat, elementChip, type ChipElement } from "@unframed/domain";
import { NEW_CHAT, type ChatClient } from "../../agent/store.ts";
import makeEditableAsset from "../../../../../assets/prompts/make-editable-instruction.md?raw";

/** The field names the Design tab's sentences use, by CSS property; any other property shows its name spelled out. */
const FIELD_NAMES: Readonly<Record<string, string>> = {
  "font-family": "Font",
  "font-size": "Font size",
  "font-weight": "Weight",
  "line-height": "Line height",
  "letter-spacing": "Letter spacing",
  "text-align": "Align",
  color: "Colour",
  "background-color": "Background",
  "border-width": "Border width",
  "border-style": "Border style",
  "border-color": "Border colour",
  "border-radius": "Corner radius",
  opacity: "Opacity",
  "box-shadow": "Shadow",
  gap: "Gap",
  "flex-direction": "Direction",
  "align-items": "Align",
  "justify-content": "Justify",
  "flex-wrap": "Wrap",
};

/** The name a field gets in the instruction: its label in the Design tab. */
export const fieldNameOf = (property: string): string => FIELD_NAMES[property] ?? (property.replace(/-/g, " ").charAt(0).toUpperCase() + property.replace(/-/g, " ").slice(1));

/** The draft "Ask the agent to make this editable" puts in an empty composer, naming the field. */
export const makeEditableInstruction = (field: string): string => makeEditableAsset.trim().replace("{field}", field);

const sameChip = (a: ElementChip, b: ElementChip): boolean => a.shapeId === b.shapeId && a.selector === b.selector;

/**
 * Adds the elements' chips to the chat the artifact's message belongs in, and shows that chat in
 * the rail. The instruction fills the draft only when the draft is empty.
 */
export const tellAgent = (client: ChatClient, shapeId: string, elements: ReadonlyArray<ChipElement>, instruction?: string): void => {
  const chips = elements.map((element) => elementChip(element, { shapeId }));
  const target = continuableChat(client.chats(), [shapeId]);
  const key = target?.id ?? NEW_CHAT;
  const stored = client.draft(key);
  const current = stored.elements ?? [];
  const merged = [...current, ...chips.filter((chip) => !current.some((existing) => sameChip(existing, chip)))];
  const text = instruction !== undefined && stored.text.trim() === "" ? instruction : stored.text;
  client.setDraft(key, { text, mentions: stored.mentions, elements: merged });
  client.setUi({ chosen: key, pinned: null });
};
