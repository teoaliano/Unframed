import type { ElementChip } from "@unframed/contracts";
import { shapeKind, shapeLabel, type ShapeKind } from "@unframed/domain";
import { AlignLeft, AppWindow, Clapperboard, Component, Group, Image, PenLine, SquareMousePointer, SquarePlay, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useValue, type Editor, type TLShapeId } from "tldraw";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

export const KIND_ICONS: Record<ShapeKind, LucideIcon> = {
  prompt: AlignLeft,
  image: Image,
  video: SquarePlay,
  group: Group,
  page: AppWindow,
  motion: Clapperboard,
  component: Component,
  mark: PenLine,
};

const KIND_NOUNS: Record<ShapeKind, string> = {
  prompt: "prompt",
  image: "image",
  video: "video",
  group: "group",
  page: "page",
  motion: "motion",
  component: "component",
  mark: "mark",
};

interface ChipShape {
  readonly id: string;
  readonly kind: ShapeKind;
  readonly label: string;
}

export const describeShape = (editor: Editor, id: string): ChipShape | undefined => {
  const shape = editor.getShape(id as TLShapeId);
  if (!shape) return undefined;
  const kind = shapeKind(shape.type);
  const props = shape.props as Record<string, unknown>;
  const label = shapeLabel(props) ?? KIND_NOUNS[kind][0]!.toUpperCase() + KIND_NOUNS[kind].slice(1);
  return { id: shape.id, kind, label };
};

export type Chip = { readonly kind: "artifact"; readonly shape: ChipShape } | { readonly kind: "count"; readonly ids: ReadonlyArray<string>; readonly label: string };

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
    set: (next: ReadonlyArray<string>) => setIds(next),
    clear: () => setIds([]),
  };
};

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

export const ElementChipRow = ({ chips, onRemove }: { readonly chips: ReadonlyArray<ElementChip>; readonly onRemove: (chip: ElementChip) => void }) => {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1" role="list" aria-label="Pointed-at elements">
      {chips.map((chip) => {
        const text = `${chip.tag} · ${chip.label}`;
        return (
          <Badge key={`${chip.shapeId} ${chip.selector}`} variant="outline" size="lg" className="max-w-full" role="listitem" data-chip="element">
            <SquareMousePointer aria-hidden />
            <span className="min-w-0 truncate" data-testid="chip-label">
              {text}
            </span>
            <Button variant="ghost-muted" size="icon-tiny" aria-label={`Remove ${text}`} onClick={() => onRemove(chip)}>
              <X aria-hidden />
            </Button>
          </Badge>
        );
      })}
    </div>
  );
};

export const ChipRow = ({ shapes, onRemove }: { readonly shapes: ReadonlyArray<ChipShape>; readonly onRemove: (ids: ReadonlyArray<string>) => void }) => {
  const chips = chipsOf(shapes);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1" role="list" aria-label="Context">
      {chips.map((chip) => {
        const label = chip.kind === "artifact" ? chip.shape.label : chip.label;
        const Icon = chip.kind === "artifact" ? KIND_ICONS[chip.shape.kind] : undefined;
        return (
          <Badge key={chip.kind === "artifact" ? chip.shape.id : "count"} variant="outline" size="lg" className="max-w-full" role="listitem" data-chip={chip.kind}>
            {Icon && <Icon aria-hidden />}
            <span className="min-w-0 truncate" data-testid="chip-label">
              {label}
            </span>
            <Button variant="ghost-muted" size="icon-tiny" aria-label={`Remove ${label}`} onClick={() => onRemove(chip.kind === "artifact" ? [chip.shape.id] : chip.ids)}>
              <X aria-hidden />
            </Button>
          </Badge>
        );
      })}
    </div>
  );
};
