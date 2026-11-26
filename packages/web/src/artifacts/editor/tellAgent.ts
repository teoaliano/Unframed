import type { ElementChip } from "@unframed/contracts";
import { continuableChat, elementChip, type ChipElement } from "@unframed/domain";
import { NEW_CHAT, type ChatClient } from "../../agent/store.ts";
import makeEditableAsset from "../../../../../assets/prompts/make-editable-instruction.md?raw";

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

export const fieldNameOf = (property: string): string => FIELD_NAMES[property] ?? (property.replace(/-/g, " ").charAt(0).toUpperCase() + property.replace(/-/g, " ").slice(1));

export const makeEditableInstruction = (field: string): string => makeEditableAsset.trim().replace("{field}", field);

const sameChip = (a: ElementChip, b: ElementChip): boolean => a.shapeId === b.shapeId && a.selector === b.selector;

const unlisted = (chips: ReadonlyArray<ElementChip>, listed: ReadonlyArray<ElementChip>): ElementChip[] => chips.filter((chip) => !listed.some((existing) => sameChip(existing, chip)));

const draftKey = (client: ChatClient, shapeId: string): string => continuableChat(client.chats(), [shapeId])?.id ?? NEW_CHAT;

export const tellAgent = (client: ChatClient, shapeId: string, elements: ReadonlyArray<ChipElement>, instruction?: string): void => {
  const chips = elements.map((element) => elementChip(element, { shapeId }));
  const key = draftKey(client, shapeId);
  const stored = client.draft(key);
  const current = stored.elements ?? [];
  const text = instruction !== undefined && stored.text.trim() === "" ? instruction : stored.text;
  client.setDraft(key, { ...stored, text, elements: [...current, ...unlisted(chips, current)] });
  client.setUi({ chosen: key, pinned: null });
};
