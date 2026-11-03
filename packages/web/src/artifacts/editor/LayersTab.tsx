/**
 * The editor's Layers tab (spec 18, The Layers tab): the artifact's elements as a tree in document
 * order, with the frame's runtime elements greyed under their nearest parent with an id. A row
 * selects its element, hovers it in the frame, renames it, hides it and locks it.
 */
import type { SourceTreeElement } from "@unframed/contracts";
import type { ArtifactKind, ChipElement } from "@unframed/domain";
import { Eye, EyeOff, Film, Frame, Image, Link, Lock, LockOpen, MessageSquarePlus, MousePointerClick, Pencil, Square, Type, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { cn } from "~/lib/utils";
import { chipDataFor } from "./chipData.ts";
import type { EditSession, LiveNode } from "./editSession.ts";

/** The hidden trigger a Layers menu is opened through (the menu is controlled, anchored to the row). */
const LAYER_MENU_TRIGGER = "layers-row-menu-trigger";

const INDENT_PX = 12;
const NAME_MAX = 60;

/** Layer open state per artifact, kept for the session: a parent is open until it is collapsed. */
const collapsedBy = new Map<string, Set<string>>();

/** One row: a source element, or a runtime element the script made (no id, read-only). */
interface Row {
  readonly key: string;
  readonly id: string | null;
  readonly tag: string;
  readonly depth: number;
  readonly parent: string | null;
  readonly element: SourceTreeElement | null;
  readonly hasChildren: boolean;
  readonly inLocked: boolean;
}

const KIND_ICON: Record<string, typeof Type> = { image: Image, link: Link, button: MousePointerClick, media: Film, frame: Frame, text: Type, shape: Square };

/** The icon a row shows, from its tag and whether it holds text only. */
const iconOf = (tag: string, text: string | null): typeof Type => {
  if (tag === "img" || tag === "picture" || tag === "svg") return KIND_ICON.image!;
  if (tag === "a") return KIND_ICON.link!;
  if (tag === "button") return KIND_ICON.button!;
  if (tag === "video" || tag === "audio") return KIND_ICON.media!;
  if (tag === "iframe") return KIND_ICON.frame!;
  if (text !== null) return KIND_ICON.text!;
  return KIND_ICON.shape!;
};

/**
 * The rows in document order. Source elements nest by their parent's id; each runtime element
 * sits under the nearest source element above it, after that element's source children.
 */
export const layerRows = (elements: readonly SourceTreeElement[], live: readonly LiveNode[], collapsed: ReadonlySet<string>, locked: readonly string[]): Row[] => {
  const known = new Set(elements.map((element) => element.id));
  const childrenOf = new Map<string | null, SourceTreeElement[]>();
  for (const element of elements) {
    const parent = element.parent !== null && known.has(element.parent) ? element.parent : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), element]);
  }
  const runtimeOf = new Map<string | null, LiveNode[]>();
  const gather = (nodes: readonly LiveNode[], under: string | null) => {
    for (const node of nodes) {
      if (node.id !== null && known.has(node.id)) {
        gather(node.children, node.id);
      } else {
        runtimeOf.set(under, [...(runtimeOf.get(under) ?? []), node]);
        gather(node.children, under);
      }
    }
  };
  gather(live, null);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const lockedSet = new Set(locked);
  const underLocked = (id: string | null): boolean => {
    for (let current = id; current !== null; current = byId.get(current)?.parent ?? null) if (lockedSet.has(current)) return true;
    return false;
  };

  const rows: Row[] = [];
  const emit = (parent: string | null, depth: number) => {
    const open = parent === null || !collapsed.has(parent);
    if (!open) return;
    for (const element of childrenOf.get(parent) ?? []) {
      const kids = (childrenOf.get(element.id)?.length ?? 0) > 0 || (runtimeOf.get(element.id)?.length ?? 0) > 0;
      rows.push({ key: element.id, id: element.id, tag: element.tag, depth, parent, element, hasChildren: kids, inLocked: underLocked(element.id) && !lockedSet.has(element.id) });
      emit(element.id, depth + 1);
    }
    for (const node of runtimeOf.get(parent) ?? []) {
      rows.push({ key: node.selector, id: null, tag: node.tag, depth, parent, element: null, hasChildren: false, inLocked: false });
    }
  };
  emit(null, 0);
  return rows;
};

export interface LayersTabProps {
  readonly session: EditSession;
  readonly kind: ArtifactKind;
  /** The artifact's shape id, which keys the open state of its layers. */
  readonly shapeId: string;
  readonly locked: readonly string[];
  /** Locks or unlocks an element. The editor writes the shape and its one undo step. */
  readonly onLock: (id: string, on: boolean) => void;
  /** Tell the agent: the chips of the selected elements go into the artifact's chat (spec 18, Point and tell). */
  readonly onTell: (elements: ChipElement[]) => void;
}

export const LayersTab = ({ session, kind, shapeId, locked, onLock, onTell }: LayersTabProps) => {
  const { tree, preparing, selection, pending, live, reports } = session;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => collapsedBy.get(shapeId) ?? new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The row whose context menu is open, and the row it is anchored to. */
  const [menuFor, setMenuFor] = useState<{ readonly id: string; readonly anchor: HTMLElement }>();
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);

  // The frame is asked for its live tree when the tab opens, so a runtime element the script added since is listed.
  useEffect(() => session.requestLive(), []);

  // A selection made in the frame opens the rows above it and brings its row into view.
  useEffect(() => {
    const [only] = selection;
    if (only === undefined || !tree) return;
    const ancestors: string[] = [];
    for (let parent = tree.elements.find((element) => element.id === only)?.parent ?? null; parent !== null; ) {
      ancestors.push(parent);
      parent = tree.elements.find((element) => element.id === parent)?.parent ?? null;
    }
    if (ancestors.some((id) => collapsed.has(id))) {
      const next = new Set([...collapsed].filter((id) => !ancestors.includes(id)));
      collapsedBy.set(shapeId, next);
      setCollapsed(next);
    }
    // Only a change of the selection reveals a row; a collapse the person made stays made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.join(",")]);

  useEffect(() => {
    if (selection.length !== 1) return;
    document.querySelector<HTMLElement>(`[data-layer="${CSS.escape(selection[0]!)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selection]);

  if (preparing) return <p className="m-0 p-2.5 text-sm text-muted-foreground">{`Getting this ${kind} ready for editing…`}</p>;
  if (tree === undefined) return null;

  const rows = layerRows(tree.elements, live, collapsed, locked);
  const pendingHidden = (id: string): boolean | undefined => {
    const edit = pending.find((item) => item.type === "hide" && item.elementId === id);
    return edit?.type === "hide" ? edit.hidden : undefined;
  };
  const pendingName = (id: string): string | null | undefined => {
    const edit = pending.find((item) => item.type === "attribute" && item.elementId === id && item.name === "data-uf-name");
    return edit?.type === "attribute" ? edit.value : undefined;
  };

  const menuElement = menuFor === undefined ? undefined : tree.elements.find((candidate) => candidate.id === menuFor.id);
  const menuHidden = menuFor === undefined ? false : (pendingHidden(menuFor.id) ?? menuElement?.hidden === true);

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedBy.set(shapeId, next);
    setCollapsed(next);
  };

  const select = (id: string, additive: boolean) => {
    if (additive) session.setSelection(selection.includes(id) ? selection.filter((other) => other !== id) : [...selection, id]);
    else session.setSelection([id]);
  };

  /** The chips of the selected elements, for Tell the agent: a selected element with no source and no report is left out. */
  const chipsOfSelection = (): ChipElement[] =>
    selection.flatMap((id) => {
      const source = tree.elements.find((candidate) => candidate.id === id);
      const report = reports[id];
      if (source === undefined && report === undefined) return [];
      const hasChildren = source !== undefined && tree.elements.some((candidate) => candidate.parent === id);
      return [chipDataFor(id, source, report, hasChildren)];
    });

  const startRename = (element: SourceTreeElement) => {
    cancelled.current = false;
    setDraft(element.name);
    setRenaming(element.id);
  };

  const finishRename = (element: SourceTreeElement, keep: boolean) => {
    if (!keep) {
      setRenaming(null);
      return;
    }
    const typed = draft.trim().slice(0, NAME_MAX);
    const current = pendingName(element.id) ?? (element.named ? element.name : null);
    setRenaming(null);
    if (typed === (current ?? "")) return;
    session.patch({ type: "attribute", elementId: element.id, name: "data-uf-name", value: typed === "" ? null : typed });
  };

  return (
    <ul aria-label="Layers" className="m-0 flex min-h-0 list-none flex-col gap-0.5 overflow-auto p-1.5" onMouseLeave={() => session.hoverLayer(null)}>
      {rows.map((row) => {
        if (row.element === null) {
          // A runtime element: greyed, labelled by its tag, read-only.
          return (
            <li key={`runtime-${row.key}`} data-layer-runtime="" style={{ paddingInlineStart: `${row.depth * INDENT_PX}px` }}>
              <div className="flex min-w-0 items-center gap-1.5 px-1 py-0.5 text-sm text-muted-foreground">
                <span className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{row.tag}</span>
                <span className="shrink-0 text-xs">Set by the agent's code</span>
              </div>
            </li>
          );
        }
        const element = row.element;
        const id = element.id;
        const selected = selection.includes(id);
        const hidden = pendingHidden(id) ?? element.hidden;
        const name = pendingName(id);
        const label = name === undefined ? element.name : name === null ? element.name : name;
        const Icon = iconOf(element.tag, element.text);
        const isLocked = locked.includes(id);
        const open = !collapsed.has(id);
        return (
          <li key={id} data-layer-row={id} data-selected={selected ? "true" : undefined} style={{ paddingInlineStart: `${row.depth * INDENT_PX}px` }} className="group">
            <div
              className={cn("flex min-w-0 items-center gap-1 rounded-sm", selected && "bg-accent")}
              onMouseEnter={() => session.hoverLayer(id)}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!selection.includes(id)) session.setSelection([id]);
                setMenuFor({ id, anchor: event.currentTarget });
              }}
            >
              {row.hasChildren ? (
                <Button variant="ghost" size="icon-sm" aria-label={open ? `Collapse ${label}` : `Expand ${label}`} aria-expanded={open} onClick={() => toggle(id)}>
                  {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                </Button>
              ) : (
                <span className="size-6 shrink-0" aria-hidden />
              )}
              {renaming === id ? (
                <Input
                  aria-label="Layer name"
                  autoFocus
                  className="min-w-0 flex-1"
                  value={draft}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  onBlur={() => finishRename(element, !cancelled.current)}
                  onKeyDown={(event) => {
                    cancelled.current = event.key === "Escape";
                    if (event.key === "Enter") finishRename(element, true);
                    if (event.key === "Escape") finishRename(element, false);
                  }}
                />
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  data-layer={id}
                  aria-pressed={selected}
                  className="min-w-0 flex-1 justify-start"
                  onClick={(event) => select(id, event.shiftKey)}
                  onDoubleClick={() => startRename(element)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.target !== event.currentTarget) return;
                    // A text element's Enter starts its in-place text edit (spec 18, Keys); any other row renames.
                    if (element.text !== null) {
                      event.preventDefault();
                      session.setSelection([id]);
                      session.startText(id);
                      return;
                    }
                    startRename(element);
                  }}
                >
                  <span className={cn("flex min-w-0 flex-1 items-center gap-1.5", hidden && "opacity-50", row.inLocked && "text-muted-foreground")}>
                    <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{element.tag}</span>
                  </span>
                </Button>
              )}
              <span className={cn("flex shrink-0 items-center gap-0.5", !(hidden || isLocked) && "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Hidden ${label}`}
                  aria-pressed={hidden}
                  onClick={() => session.patch({ type: "hide", elementId: id, hidden: !hidden })}
                >
                  {hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Locked ${label}`} aria-pressed={isLocked} onClick={() => onLock(id, !isLocked)}>
                  {isLocked ? <Lock aria-hidden /> : row.inLocked ? <Lock aria-hidden className="opacity-40" /> : <LockOpen aria-hidden />}
                </Button>
              </span>
            </div>
          </li>
        );
      })}
      <Menu modal={false} triggerId={LAYER_MENU_TRIGGER} open={menuFor !== undefined} onOpenChange={(open) => !open && setMenuFor(undefined)}>
        <MenuTrigger id={LAYER_MENU_TRIGGER} nativeButton={false} render={<span hidden />} />
        {menuFor && menuElement !== undefined && (
          <LayerMenu
            anchor={menuFor.anchor}
            label={menuElement.name}
            hidden={menuHidden}
            locked={locked.includes(menuFor.id)}
            onTell={() => onTell(chipsOfSelection())}
            onRename={() => startRename(menuElement)}
            onHide={() => session.patch({ type: "hide", elementId: menuFor.id, hidden: !menuHidden })}
            onLock={() => onLock(menuFor.id, !locked.includes(menuFor.id))}
          />
        )}
      </Menu>
    </ul>
  );
};

/** The row menu: Tell the agent, then the same rename, hide and lock the row's controls do. */
const LayerMenu = ({
  anchor,
  label,
  hidden,
  locked,
  onTell,
  onRename,
  onHide,
  onLock,
}: {
  readonly anchor: HTMLElement;
  readonly label: string;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly onTell: () => void;
  readonly onRename: () => void;
  readonly onHide: () => void;
  readonly onLock: () => void;
}) => (
  <MenuPopup anchor={anchor} side="right" align="start" sideOffset={4} className="max-w-[260px]" finalFocus={() => false} aria-label={`${label} actions`}>
    <MenuItem onClick={onTell}>
      <MessageSquarePlus aria-hidden />
      Tell the agent
    </MenuItem>
    <MenuItem onClick={onRename}>
      <Pencil aria-hidden />
      Rename
    </MenuItem>
    <MenuItem onClick={onHide}>
      {hidden ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
      {hidden ? "Show" : "Hide"}
    </MenuItem>
    <MenuItem onClick={onLock}>
      {locked ? <LockOpen aria-hidden /> : <Lock aria-hidden />}
      {locked ? "Unlock" : "Lock"}
    </MenuItem>
  </MenuPopup>
);
