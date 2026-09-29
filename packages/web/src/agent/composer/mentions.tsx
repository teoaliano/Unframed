import { agentShapeId, plainText, readRef, shapeKind } from "@unframed/domain";
import { File } from "lucide-react";
import type { Editor, TLAssetId, TLShape } from "tldraw";
import { KIND_ICONS } from "./chips.tsx";
import type { MenuItem } from "./ComposerMenu.tsx";
import type { DraftChip } from "./PromptEditor.tsx";

const KIND_WORDS: Record<string, string> = { prompt: "Prompt", group: "Group", page: "Page", motion: "Motion", image: "Image", video: "Video" };

export interface Mentionable extends MenuItem {
  readonly chip: DraftChip;
  /** The shape the mention adds to the message's context; none for a file. */
  readonly shapeId?: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const projectFileOf = (editor: Editor, shape: TLShape): string => {
  const props = shape.props as Record<string, unknown>;
  if (text(props.file) !== "") return text(props.file);
  const assetId = props.assetId;
  if (typeof assetId !== "string") return "";
  const src = text((editor.getAsset(assetId as TLAssetId)?.props as Record<string, unknown> | undefined)?.src);
  return src.startsWith("project-file:") ? src.slice("project-file:".length) : "";
};

const labelOf = (editor: Editor, shape: TLShape, kind: string): string => {
  const props = shape.props as Record<string, unknown>;
  if (kind === "prompt" || kind === "group") return `@${readRef(shape) ?? agentShapeId(shape.id)}`;
  const named = shapeLabel(props);
  if (named !== undefined) return named;
  const assetId = props.assetId;
  const assetName = typeof assetId === "string" ? text((editor.getAsset(assetId as TLAssetId)?.props as Record<string, unknown> | undefined)?.name) : "";
  return assetName || `${KIND_WORDS[kind]} ${readRef(shape) ?? agentShapeId(shape.id)}`;
};

/**
 * What `@` offers: the project's shapes (prompts and groups by `@id`, artifacts and media
 * by label) and the project files they name, matched case-insensitively.
 */
export const mentionItems = (editor: Editor, query: string): Mentionable[] => {
  const wanted = query.toLowerCase();
  const shapes: Mentionable[] = [];
  const files = new Map<string, Mentionable>();
  for (const shape of editor.getCurrentPageShapesSorted()) {
    const kind = shapeKind(shape.type);
    if (kind === "mark") continue;
    const label = labelOf(editor, shape, kind);
    const Icon = KIND_ICONS[kind];
    const preview = kind === "prompt" ? plainText((shape.props as { richText?: unknown }).richText).replace(/\s+/g, " ").trim().slice(0, 24) : undefined;
    if (label.toLowerCase().includes(wanted) || (preview ?? "").toLowerCase().includes(wanted)) {
      shapes.push({
        key: shape.id,
        label,
        ...(preview ? { description: preview } : {}),
        icon: <Icon size={13} aria-hidden />,
        chip: { kind: "mention", label: KIND_WORDS[kind]!, title: label, ref: agentShapeId(shape.id) },
        shapeId: shape.id,
      });
    }
    const file = projectFileOf(editor, shape);
    if (file !== "" && file.toLowerCase().includes(wanted) && !files.has(file)) {
      files.set(file, { key: `file:${file}`, label: file, badge: "File", icon: <File size={13} aria-hidden />, chip: { kind: "mention", label: "File", title: file, ref: file } });
    }
  }
  return [...shapes, ...[...files.values()].sort((a, b) => a.label.localeCompare(b.label))];
};
