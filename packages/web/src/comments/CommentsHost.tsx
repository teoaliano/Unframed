import { clusterPins, isUnread, participants, pinPoint, type CommentAnchor, type Point } from "@unframed/domain";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { react, useEditor, useValue, type Editor, type TLShape } from "tldraw";
import { cn } from "~/lib/utils";
import "./comments.css";
import { useCanvasProject } from "../context.ts";
import { ClusterBubble, NewThreadComposer, PinBody, PreviewCard, ThreadPopover, useNow } from "./parts.tsx";
import { CommentsSidebar } from "./CommentsSidebar.tsx";
import { COMMENT_TOOL, commentsUi, type CommentsUi, type PlacedThread } from "./state.ts";

const PIN = 32;
const GAP = 16;
const DRAG_START = 3;
const SIDEBAR_WIDTH = 320;

const AT_TRANSFORM = "translate(calc((var(--px) + var(--cx)) * var(--z) * 1px), calc((var(--py) + var(--cy)) * var(--z) * 1px))";

const placeAt = (at: Point, shift = ""): CSSProperties => ({ "--px": at.x, "--py": at.y, transform: `${AT_TRANSFORM}${shift}` }) as CSSProperties;

const AT_POINT = "absolute top-0 left-0";

const boxOf = (editor: Editor) => (id: string) => {
  const bounds = editor.getShapePageBounds(id as TLShape["id"]);
  return bounds === undefined ? undefined : { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
};

const handled = (editor: Editor) => (event: ReactPointerEvent | PointerEvent) => {
  editor.markEventAsHandled(event);
  event.stopPropagation();
};

const HoverPreview = ({ thread, resolved }: { readonly thread: PlacedThread["thread"]; readonly resolved: boolean }) => {
  const now = useNow();
  return <PreviewCard thread={thread} now={now} resolved={resolved} />;
};

const Pin = ({ ui, placed, unread, selected }: { readonly ui: CommentsUi; readonly placed: PlacedThread; readonly unread: boolean; readonly selected: boolean }) => {
  const editor = ui.editor;
  const { thread } = placed;
  const hovered = useValue("pin hovered", () => ui.hovered.get() === thread.id, [ui, thread.id]);
  const draggedTo = useValue("pin dragged to", () => {
    const dragging = ui.dragging.get();
    return dragging?.id === thread.id ? dragging.at : null;
  }, [ui, thread.id]);
  const anyDragging = useValue("any pin dragging", () => ui.dragging.get() !== null, [ui]);
  const grab = useRef<{ x: number; y: number; offset: Point; moved: boolean } | null>(null);
  const at = draggedTo ?? placed.at;
  const movable = thread.createdBy.kind === "person";
  const resolved = thread.resolved !== null;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    handled(editor)(event);
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const page = editor.screenToPage({ x: event.clientX, y: event.clientY });
    grab.current = { x: event.clientX, y: event.clientY, offset: { x: page.x - placed.at.x, y: page.y - placed.at.y }, moved: false };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = grab.current;
    if (held === null) return;
    handled(editor)(event);
    if (!held.moved && Math.hypot(event.clientX - held.x, event.clientY - held.y) < DRAG_START) return;
    if (!movable) return;
    held.moved = true;
    const page = editor.screenToPage({ x: event.clientX, y: event.clientY });
    ui.dragging.set({ id: thread.id, at: { x: page.x - held.offset.x, y: page.y - held.offset.y } });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = grab.current;
    grab.current = null;
    if (held === null) return;
    handled(editor)(event);
    const drop = ui.dragging.get();
    ui.dragging.set(null);
    if (held.moved && drop !== null) {
      const anchor = thread.anchor;
      const next: CommentAnchor =
        anchor.type === "region"
          ? { ...anchor, x: anchor.x + drop.at.x - placed.at.x, y: anchor.y + drop.at.y - placed.at.y }
          : ui.anchorFor(drop.at);
      ui.moveThread(thread.id, next);
      return;
    }
    if (!editor.isIn(COMMENT_TOOL)) editor.setCurrentTool(COMMENT_TOOL);
    ui.openThread(thread.id);
  };

  const showPreview = hovered && !selected && !anyDragging;
  return (
    <div
      data-comment-pin={thread.id}
      data-unread={unread ? "" : undefined}
      data-resolved={resolved ? "" : undefined}
      aria-label={`Comment #${thread.number}`}
      role="button"
      className={cn(AT_POINT, "pointer-events-auto size-8", showPreview ? "z-20" : selected ? "z-10" : "z-0", movable && "cursor-grab active:cursor-grabbing")}
      style={placeAt(at, " translateY(-100%)")}
      onPointerEnter={() => ui.hovered.set(thread.id)}
      onPointerLeave={() => ui.hovered.get() === thread.id && ui.hovered.set(null)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        grab.current = null;
        ui.dragging.set(null);
      }}
    >
      <div className="absolute bottom-0 left-0 origin-bottom-left">
        {showPreview ? (
          <div className="origin-bottom-left animate-[unframed-comment-preview-in_120ms_ease-out] motion-reduce:animate-none">
            <HoverPreview thread={thread} resolved={resolved} />
          </div>
        ) : (
          <PinBody author={thread.messages[0]!.author} selected={selected} unread={unread} resolved={resolved} />
        )}
      </div>
    </div>
  );
};

const Cluster = ({ ui, members, centre }: { readonly ui: CommentsUi; readonly members: PlacedThread[]; readonly centre: Point }) => {
  const editor = ui.editor;
  const [hovered, setHovered] = useState(false);
  const authors = useMemo(() => {
    const out = members.flatMap((member) => participants(member.thread));
    const keys = new Set<string>();
    return out.filter((author) => {
      const key = author.kind === "person" ? "person" : author.chatId;
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
  }, [members]);
  const zoomIn = (event: ReactPointerEvent) => {
    handled(editor)(event);
    const xs = members.map((member) => member.at.x);
    const ys = members.map((member) => member.at.y);
    const pad = 120 / editor.getZoomLevel();
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    editor.zoomToBounds({ x: minX, y: minY, w: Math.max(...xs) - minX + pad, h: Math.max(...ys) - minY + pad }, { animation: { duration: 220 }, targetZoom: Math.max(editor.getZoomLevel() * 2, 1) });
  };
  return (
    <div
      data-comment-cluster={members.length}
      role="button"
      aria-label={`${members.length} comments`}
      className={cn(AT_POINT, "pointer-events-auto flex size-8 cursor-pointer items-center justify-center", hovered && "z-20")}
      style={placeAt(centre, " translate(-50%, -50%)")}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={zoomIn}
    >
      <div className="absolute">
        <ClusterBubble authors={authors} count={members.length} hovered={hovered} />
      </div>
    </div>
  );
};

const Region = ({ anchor, pending }: { readonly anchor: Extract<CommentAnchor, { type: "region" }>; readonly pending?: boolean }) => {
  const startX = anchor.x + (1 - (anchor.pinX ?? 1)) * anchor.w;
  const startY = anchor.y + (1 - (anchor.pinY ?? 1)) * anchor.h;
  return (
    <>
      <div
        data-comment-region=""
        className={cn(AT_POINT, "pointer-events-none")}
        style={{ ...placeAt({ x: anchor.x, y: anchor.y }), width: `calc(${anchor.w} * var(--z) * 1px)`, height: `calc(${anchor.h} * var(--z) * 1px)` }}
      >
        <svg className="absolute inset-0 size-full overflow-visible">
          <rect x="0" y="0" width="100%" height="100%" fill={pending ? "color-mix(in srgb, var(--comment) 6%, transparent)" : "none"} stroke="var(--comment)" strokeWidth="1.5" strokeDasharray="5 3" />
        </svg>
      </div>
      <div className={cn(AT_POINT, "pointer-events-none")} style={placeAt({ x: startX, y: startY })}>
        <span className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-comment shadow-sm" />
      </div>
    </>
  );
};

const PinsLayer = ({ ui }: { readonly ui: CommentsUi }) => {
  const editor = ui.editor;
  const hidden = useValue(ui.hidden);
  const showResolved = useValue("show resolved", () => ui.filter.get().showResolved, [ui]);
  const zoom = useValue("comment zoom", () => editor.getZoomLevel(), [editor]);
  const placed = useValue(ui.placed);
  const seen = useValue(ui.seen);
  const openId = useValue("open thread", () => {
    const open = ui.open.get();
    return open?.kind === "thread" ? open.id : null;
  }, [ui]);
  const hoveredId = useValue(ui.hovered);
  const draggingId = useValue("dragging id", () => ui.dragging.get()?.id ?? null, [ui]);

  const visible = useMemo(() => placed.filter((item) => item.thread.id === openId || (!hidden && (showResolved || item.thread.resolved === null))), [placed, openId, hidden, showResolved]);
  const clusters = useMemo(() => {
    const loose = visible.filter((item) => item.thread.id !== openId && item.thread.id !== draggingId);
    const byId = new Map(loose.map((item) => [item.thread.id, item]));
    return clusterPins(loose.map((item) => ({ id: item.thread.id, x: item.at.x * zoom, y: item.at.y * zoom })), PIN).map((cluster) => ({
      members: cluster.ids.map((id) => byId.get(id)!),
      centre: { x: (cluster.x) / zoom, y: cluster.y / zoom },
    }));
  }, [visible, openId, draggingId, zoom]);

  const fixed = visible.filter((item) => item.thread.id === openId || item.thread.id === draggingId);
  const regionThread = visible.find((item) => item.thread.anchor.type === "region" && (item.thread.id === openId || item.thread.id === hoveredId));

  return (
    <>
      {regionThread !== undefined && regionThread.thread.anchor.type === "region" && <Region anchor={regionThread.thread.anchor} />}
      {[
        ...clusters.map((cluster) =>
          cluster.members.length === 1 ? (
            <Pin key={cluster.members[0]!.thread.id} ui={ui} placed={cluster.members[0]!} unread={isUnread(cluster.members[0]!.thread, seen)} selected={false} />
          ) : (
            <Cluster key={cluster.members.map((member) => member.thread.id).join(",")} ui={ui} members={cluster.members} centre={cluster.centre} />
          ),
        ),
        ...fixed.map((item) => <Pin key={item.thread.id} ui={ui} placed={item} unread={item.thread.id !== openId && isUnread(item.thread, seen)} selected={item.thread.id === openId} />),
      ]}
    </>
  );
};

const useFloating = (editor: Editor, at: Point | null) => {
  const card = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const screen = useValue("comment floating point", () => (at === null ? null : editor.pageToViewport(at)), [editor, at?.x, at?.y]);
  const viewport = useValue("comment viewport", () => editor.getViewportScreenBounds(), [editor]);
  useLayoutEffect(() => {
    const element = card.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    setHeight(element.offsetHeight);
    return () => observer.disconnect();
  }, [at === null]);
  return { card, screen, viewport, height };
};

const Floating = ({ ui, at, width, top, children, name }: { readonly ui: CommentsUi; readonly at: Point; readonly width: number; readonly top: number; readonly children: React.ReactNode; readonly name: string }) => {
  const editor = ui.editor;
  const { card, screen, viewport, height } = useFloating(editor, at);
  const sidebar = useValue("comments sidebar open", () => editor.getCurrentToolId() === COMMENT_TOOL, [editor]);
  if (screen === null) return null;
  const right = screen.x + PIN + GAP;
  const fitsRight = right + width <= viewport.w - (sidebar ? SIDEBAR_WIDTH : 0) - 8;
  const left = fitsRight ? right : Math.max(8, screen.x - GAP - width);
  const wanted = screen.y - PIN + top;
  const y = Math.max(48, Math.min(wanted, viewport.h - 72 - height));
  return (
    <div
      ref={card}
      data-comment-floating={name}
      data-side={fitsRight ? "right" : "left"}
      className="pointer-events-auto absolute top-0 left-0 z-30"
      style={{ transform: `translate(${Math.round(left)}px, ${Math.round(y)}px)`, width }}
      onPointerDown={handled(editor)}
      onPointerMove={(event) => editor.markEventAsHandled(event)}
      onWheel={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
};

const OpenLayer = ({ ui }: { readonly ui: CommentsUi }) => {
  const editor = ui.editor;
  const open = useValue(ui.open);
  const threads = useValue(ui.threads);
  const now = useNow();
  const draftAt = useMemo(() => (open?.kind === "draft" ? pinPoint(open.anchor, boxOf(editor)) : null), [open, editor]);
  const placedOpen = useValue("open placed", () => {
    const current = ui.open.get();
    return current?.kind === "thread" ? (ui.placedThread(current.id) ?? null) : null;
  }, [ui]);
  const thread = open?.kind === "thread" ? threads.find((item) => item.id === open.id) : undefined;
  const messageCount = thread?.messages.length ?? 0;

  useEffect(() => {
    if (open?.kind === "thread" && thread === undefined) ui.close();
  }, [open, thread, ui]);

  useEffect(() => {
    if (thread !== undefined) ui.markSeen(thread.id);
  }, [thread?.id, messageCount, ui]);

  const refocus = () => editor.getContainer().focus();

  if (open?.kind === "draft" && draftAt !== null) {
    return (
      <>
        {open.anchor.type === "region" && <Region anchor={open.anchor} pending />}
        <div className={cn(AT_POINT, "pointer-events-none z-20 size-8")} style={placeAt(draftAt, " translateY(-100%)")} data-comment-pending="">
          <div className="absolute bottom-0 left-0">
            <PinBody pending />
          </div>
        </div>
        <Floating ui={ui} at={draftAt} width={292} top={0} name="new">
          <NewThreadComposer
            onCancel={() => {
              ui.close();
              refocus();
            }}
            onSubmit={(text) => {
              ui.startThread(open.anchor, text);
              ui.close();
              refocus();
            }}
          />
        </Floating>
      </>
    );
  }

  if (thread === undefined || placedOpen === null) return null;
  return (
    <Floating ui={ui} at={placedOpen.at} width={356} top={-8} name="thread">
      <ThreadPopover
        key={thread.id}
        thread={thread}
        now={now}
        autoFocus
        actions={{
          onClose: () => {
            ui.close();
            refocus();
          },
          onResolve: (resolved) => {
            ui.setResolved(thread.id, resolved);
            if (resolved && !ui.filter.get().showResolved) {
              ui.close();
              refocus();
            }
          },
          onReply: (text) => ui.reply(thread.id, text),
          onMarkUnread: () => {
            ui.close();
            ui.markUnread(thread.id);
            refocus();
          },
          onDeleteThread: () => {
            ui.deleteThread(thread.id);
            refocus();
          },
          onEdit: (id, text) => ui.edit(id, text),
          onDeleteComment: (id) => ui.deleteComment(id),
        }}
      />
    </Floating>
  );
};

const DraggingRegion = ({ ui }: { readonly ui: CommentsUi }) => {
  const region = useValue(ui.region);
  if (region === null) return null;
  return (
    <div
      data-comment-region-drag=""
      className={cn(AT_POINT, "pointer-events-none")}
      style={{
        ...placeAt({ x: Math.min(region.start.x, region.end.x), y: Math.min(region.start.y, region.end.y) }),
        width: `calc(${Math.abs(region.end.x - region.start.x)} * var(--z) * 1px)`,
        height: `calc(${Math.abs(region.end.y - region.start.y)} * var(--z) * 1px)`,
      }}
    >
      <svg className="absolute inset-0 size-full overflow-visible">
        <rect x="0" y="0" width="100%" height="100%" fill="none" stroke="var(--comment)" strokeWidth="1.5" strokeDasharray="5 3" />
      </svg>
    </div>
  );
};

export const CommentsHost = () => {
  const editor = useEditor();
  const project = useCanvasProject();
  const ui = commentsUi(editor);
  const root = useRef<HTMLDivElement>(null);
  const commenting = useValue("commenting", () => editor.getCurrentToolId() === COMMENT_TOOL, [editor]);

  useLayoutEffect(() => ui.setProject(project), [ui, project]);

  useLayoutEffect(
    () =>
      react("comment camera", () => {
        const { x, y, z } = editor.getCamera();
        const element = root.current;
        if (element === null) return;
        element.style.setProperty("--cx", String(x));
        element.style.setProperty("--cy", String(y));
        element.style.setProperty("--z", String(z));
      }),
    [editor],
  );

  return (
    <>
      <div ref={root} data-comments-layer="" className="pointer-events-none absolute inset-0 overflow-hidden font-sans">
        <PinsLayer ui={ui} />
        <DraggingRegion ui={ui} />
        <OpenLayer ui={ui} />
      </div>
      {commenting && <CommentsSidebar ui={ui} />}
    </>
  );
};
