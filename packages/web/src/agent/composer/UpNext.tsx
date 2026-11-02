import { moveQueued, queuedDropTarget } from "@unframed/domain";
import { ChevronDown, CornerUpRight, GripVertical, ListOrdered, Pencil, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, InlineButton } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { Tip } from "../../chrome/ui.tsx";
import { platform } from "../../canvas/platform.ts";
import { returnQueued, sendQueued } from "../queue.tsx";
import { useQueue, type ChatClient, type QueuedMessage } from "../store.ts";

const QUEUED_DRAG_TYPE = "application/x-unframed-queued-message";
// A longer queue shows its first messages and a button that shows the rest.
const VISIBLE_ROWS = 3;

/** The shortcuts the rows name in their tooltips, in t3code's labels. */
export const queueShortcuts = (): { readonly steer: string; readonly edit: string } =>
  platform() === "darwin" ? { steer: "⇧⌘Enter", edit: "⌥Up" } : { steer: "Ctrl+Shift+Enter", edit: "Alt+Up" };

export interface UpNextProps {
  readonly client: ChatClient;
  readonly chatId: string;
  readonly running: boolean;
  readonly editingId: string | null;
  /** Set while something else holds the composer, such as an open question. */
  readonly editBlockedReason: string | null;
  readonly onEdit: (item: QueuedMessage) => void;
  readonly onCancelEdit: () => void;
}

/**
 * t3code's Up next (QueuedRunsControl) above the composer: the chat's queued messages in
 * order, each a dashed bubble with its number (a drag grip on hover), Edit, Steer or Send
 * now, and a way back to the composer.
 */
export const UpNext = ({ client, chatId, running, editingId, editBlockedReason, onEdit, onCancelEdit }: UpNextProps) => {
  const queue = useQueue(client, chatId);
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const [drag, setDrag] = useState<{ readonly id: string; readonly insertIndex: number | null } | null>(null);
  // Armed from the grip, so dragging the text of a row never reorders it.
  const armed = useRef<string | null>(null);
  const shortcuts = queueShortcuts();
  const busy = queue.some((item) => item.state === "sending");
  const collapsible = queue.length > VISIBLE_ROWS;
  const visible = collapsible && !showAll ? queue.slice(0, VISIBLE_ROWS - 1) : queue;
  // An edit begun from the keyboard may be on a folded row: show it.
  useEffect(() => {
    if (editingId !== null && !visible.some((item) => item.id === editingId)) setShowAll(true);
  }, [editingId, visible]);

  if (queue.length === 0) return null;

  const move = (id: string, beforeId: string | null) => client.updateQueue(chatId, (current) => moveQueued(current, id, beforeId));
  const ids = queue.map((item) => item.id);
  const complete = () => {
    const done = drag;
    setDrag(null);
    armed.current = null;
    if (!done || done.insertIndex === null || busy) return;
    const before = queuedDropTarget(ids, done.id, done.insertIndex);
    if (before !== undefined) move(done.id, before);
  };

  return (
    <section aria-label={`Up next: ${queue.length} queued message${queue.length === 1 ? "" : "s"}`} className={cn("flex w-full shrink flex-col gap-2 pb-2", collapsible ? "min-h-15" : "min-h-9")}>
      <h3 className="m-0 flex min-h-5 shrink-0 items-center gap-1.5 px-1 text-xs font-normal text-muted-foreground [&_svg]:size-3.5">
        <ListOrdered aria-hidden />
        Up next
        <span className="tabular-nums" aria-live="polite">
          · {queue.length} queued
        </span>
      </h3>
      {/* Capped, and the first thing to give up height (the heading and the toggle never do, the section's minimum holds them), so a long queue never hides an approval or pushes the composer out of a narrow rail. */}
      <ol className="m-0 flex max-h-[min(28rem,50vh)] min-h-0 shrink list-none flex-col items-end gap-3 overflow-y-auto overscroll-contain px-0 py-1.5" id={listId}>
        {visible.map((item, index) => {
          const editing = item.id === editingId;
          return (
            <li
              key={item.id}
              aria-label={`Queued message ${index + 1} of ${queue.length}, not sent`}
              aria-current={editing ? "true" : undefined}
              data-testid="queued-message"
              data-state={item.state}
              className={cn("group/queued relative flex w-full flex-col items-end gap-1", drag?.id === item.id && "opacity-50")}
              draggable={queue.length > 1 && !busy}
              onDragStart={(event) => {
                if (armed.current !== item.id) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.setData(QUEUED_DRAG_TYPE, item.id);
                event.dataTransfer.effectAllowed = "move";
                setDrag({ id: item.id, insertIndex: null });
              }}
              onDragEnd={() => {
                armed.current = null;
                setDrag(null);
              }}
              onDragOver={(event) => {
                if (drag === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const rect = event.currentTarget.getBoundingClientRect();
                const insertIndex = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
                if (drag.insertIndex !== insertIndex) setDrag({ id: drag.id, insertIndex });
              }}
              onDrop={(event) => {
                if (drag === null) return;
                event.preventDefault();
                complete();
              }}
            >
              {drag?.insertIndex === index && <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-1.5 h-0.5 rounded bg-primary/70" />}
              {index === queue.length - 1 && drag?.insertIndex === queue.length && (
                <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-1.5 h-0.5 rounded bg-primary/70" />
              )}
              {/* Dashed and unfilled: a message that has not been sent yet. */}
              <div
                className={cn(
                  "flex max-w-[80%] min-w-0 flex-col gap-2 rounded-2xl border border-dashed px-3 py-2 text-sm",
                  editing ? "border-primary/60 text-foreground" : "border-muted-foreground/40 text-muted-foreground",
                )}
              >
                <p className="m-0 line-clamp-3 whitespace-pre-wrap break-words" data-testid="queued-text" title={item.message.text}>
                  {item.message.text}
                </p>
              </div>
              <div className="flex items-center gap-0.5 pe-1 text-xs text-muted-foreground">
                {queue.length > 1 ? (
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`Reorder queued message ${index + 1} of ${queue.length} (drag, or press the arrow keys)`}
                    className="group/grip cursor-grab active:cursor-grabbing"
                    // Not `disabled`: that drops the focus mid-move and breaks repeated arrow presses.
                    aria-disabled={busy || undefined}
                    onPointerDown={() => {
                      if (!busy) armed.current = item.id;
                    }}
                    onKeyDown={(event) => {
                      if (busy) return;
                      if (event.key === "ArrowUp" && index > 0) {
                        event.preventDefault();
                        move(item.id, ids[index - 1] ?? null);
                      }
                      if (event.key === "ArrowDown" && index < queue.length - 1) {
                        event.preventDefault();
                        // Moving into the folded rows would unmount the focused grip.
                        if (index + 1 >= visible.length) setShowAll(true);
                        move(item.id, ids[index + 2] ?? null);
                      }
                    }}
                  >
                    <span className="text-xs font-medium tabular-nums group-hover/queued:hidden group-focus-visible/grip:hidden">{index + 1}</span>
                    <GripVertical aria-hidden className="hidden group-hover/queued:block group-focus-visible/grip:block" />
                  </Button>
                ) : null}
                {editing ? (
                  <>
                    <span className="px-1 text-foreground">Editing in the composer</span>
                    <Button size="xs" variant="ghost" aria-label="Cancel editing queued message" onClick={onCancelEdit}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Tip label={editBlockedReason ?? `Edit in the composer${index === queue.length - 1 ? ` (${shortcuts.edit})` : ""}`} side="top">
                      {/* The span keeps the tooltip, and its reason, on a disabled button. */}
                      <span className="flex shrink-0">
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          aria-label="Edit queued message"
                          disabled={item.state === "sending" || editBlockedReason !== null}
                          onClick={() => onEdit(item)}
                        >
                          <Pencil aria-hidden />
                        </Button>
                      </span>
                    </Tip>
                    <Tip label={`${running ? "Send as a steer instead" : "Start a turn with this message"}${index === 0 ? ` (${shortcuts.steer})` : ""}`} side="top">
                      <span className="flex shrink-0">
                        <Button size="xs" variant="ghost-muted" disabled={busy} onPointerDown={(event) => event.preventDefault()} onClick={() => void sendQueued(client, chatId, item.id)}>
                          <CornerUpRight aria-hidden />
                          {running ? "Steer" : "Send now"}
                        </Button>
                      </span>
                    </Tip>
                    <Tip label="Cancel and return to the composer" side="top">
                      <Button
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label="Cancel and return to the composer"
                        disabled={item.state === "sending"}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => returnQueued(client, chatId, item.id)}
                      >
                        <X aria-hidden />
                      </Button>
                    </Tip>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {collapsible && (
        <div className="shrink-0 self-end pe-1 text-xs">
          <InlineButton
            tone="muted"
            aria-expanded={showAll}
            aria-controls={listId}
            // Keep the composer focused; the keyboard still works.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? "Show fewer" : `Show all ${queue.length} queued`}
            <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", showAll && "rotate-180")} />
          </InlineButton>
        </div>
      )}
    </section>
  );
};
