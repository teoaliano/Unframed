import { shapeKind, shapeLabel, type ShapeKind } from "@unframed/domain";
import { AlignLeft, AppWindow, Clapperboard, Group, Image, PenLine, SquarePlay, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useValue, type Editor, type TLShapeId } from "tldraw";

export const KIND_ICONS: Record<ShapeKind, LucideIcon> = {
  prompt: AlignLeft,
  image: Image,
  video: SquarePlay,
  group: Group,
  page: AppWindow,
  motion: Clapperboard,
  mark: PenLine,
};

const KIND_NOUNS: Record<ShapeKind, string> = {
  prompt: "prompt",
  image: "image",
  video: "video",
  group: "group",
  page: "page",
  motion: "motion",
  mark: "mark",
};

export interface ChipShape {
  readonly id: string;
  readonly kind: ShapeKind;
  readonly label: string;
}


/** A shape as a chip names it: an artifact by its title, else its file name without `.html`, else its kind. */
export const describeShape = (editor: Editor, id: string): ChipShape | undefined => {
  const shape = editor.getShape(id as TLShapeId);
  if (!shape) return undefined;
  const kind = shapeKind(shape.type);
  const props = shape.props as Record<string, unknown>;
  const label = shapeLabel(props) ?? KIND_NOUNS[kind][0]!.toUpperCase() + KIND_NOUNS[kind].slice(1);
  return { id: shape.id, kind, label };
};

export type Chip = { readonly kind: "artifact"; readonly shape: ChipShape } | { readonly kind: "count"; readonly ids: ReadonlyArray<string>; readonly label: string };

/** One chip per artifact; everything else collapsed into one count chip ("3 inputs", or "1 image" when all the same kind). */
export const chipsOf = (shapes: ReadonlyArray<ChipShape>): Chip[] => {
  const artifacts = shapes.filter((shape) => shape.kind === "page" || shape.kind === "motion");
  const rest = shapes.filter((shape) => shape.kind !== "page" && shape.kind !== "motion");
  const chips: Chip[] = artifacts.map((shape) => ({ kind: "artifact", shape }));
  if (rest.length > 0) {
    const kinds = new Set(rest.map((shape) => shape.kind));
    const noun = kinds.size === 1 ? KIND_NOUNS[rest[0]!.kind] : "input";
    chips.push({ kind: "count", ids: rest.map((shape) => shape.id), label: `${rest.length} ${noun}${rest.length === 1 ? "" : "s"}` });
  }
  return chips;
};

/**
 * The message's context, as chips: the selection when the tray opens and whenever it
 * changes while the draft is empty; once the person has typed, a selection change only
 * adds. Removing a chip trims the context and leaves the canvas selection alone.
 */
export const useSelectionChips = (editor: Editor | null, draftEmpty: boolean) => {
  const selectionKey = useValue("selection", () => (editor ? editor.getSelectedShapeIds().join(" ") : ""), [editor]);
  const [ids, setIds] = useState<ReadonlyArray<string>>(() => (selectionKey === "" ? [] : selectionKey.split(" ")));
  const empty = useRef(draftEmpty);
  empty.current = draftEmpty;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const selected = selectionKey === "" ? [] : selectionKey.split(" ");
    setIds((current) => (empty.current ? selected : [...current, ...selected.filter((id) => !current.includes(id))]));
  }, [selectionKey]);
  const shapes = useValue("chip shapes", () => (editor ? ids.flatMap((id) => describeShape(editor, id) ?? []) : []), [editor, ids]);
  return {
    shapes,
    remove: (removed: ReadonlyArray<string>) => setIds((current) => current.filter((id) => !removed.includes(id))),
    add: (added: ReadonlyArray<string>) => setIds((current) => [...current, ...added.filter((id) => !current.includes(id))]),
    /** Replaces the chips, for a message put back into the composer. */
    set: (next: ReadonlyArray<string>) => setIds(next),
    clear: () => setIds([]),
  };
};

/** The context a message carries: the chips' shapes, and every member of a chip that is a group. */
export const contextSelection = (editor: Editor | null, shapes: ReadonlyArray<ChipShape>): string[] => {
  const ids: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  for (const shape of shapes) {
    add(shape.id);
    if (shape.kind === "group" && editor) for (const member of editor.getSortedChildIdsForParent(shape.id as TLShapeId)) add(member);
  }
  return ids;
};

export const ChipRow = ({ shapes, onRemove }: { readonly shapes: ReadonlyArray<ChipShape>; readonly onRemove: (ids: ReadonlyArray<string>) => void }) => {
  const chips = chipsOf(shapes);
  if (chips.length === 0) return null;
  return (
    <div className="unframed-agent-chips" role="list" aria-label="Context">
      {chips.map((chip) => {
        const label = chip.kind === "artifact" ? chip.shape.label : chip.label;
        const Icon = chip.kind === "artifact" ? KIND_ICONS[chip.shape.kind] : undefined;
        return (
          <span key={chip.kind === "artifact" ? chip.shape.id : "count"} role="listitem" className="unframed-agent-chip" data-chip={chip.kind}>
            {Icon && <Icon size={12} aria-hidden />}
            <span className="unframed-agent-chip__label">{label}</span>
            <button type="button" aria-label={`Remove ${label}`} onClick={() => onRemove(chip.kind === "artifact" ? [chip.shape.id] : chip.ids)}>
              <X size={11} aria-hidden />
            </button>
          </span>
        );
      })}
    </div>
  );
};
