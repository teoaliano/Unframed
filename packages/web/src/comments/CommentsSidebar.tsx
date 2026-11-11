import { isUnread, visibleThreads, type CommentFilter } from "@unframed/domain";
import { Ellipsis, ListFilter, MessageCircle, Search, X } from "lucide-react";
import { useRef } from "react";
import { usePassThroughWheelEvents, useValue } from "tldraw";
import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Menu, MenuCheckboxItem, MenuGroup, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { SidebarRow, useNow } from "./parts.tsx";
import type { CommentsUi } from "./state.ts";

export const CommentsSidebar = ({ ui }: { readonly ui: CommentsUi }) => {
  const editor = ui.editor;
  const threads = useValue(ui.threads);
  const filter = useValue(ui.filter);
  const seen = useValue(ui.seen);
  const open = useValue(ui.open);
  const now = useNow();
  const ref = useRef<HTMLDivElement>(null);
  usePassThroughWheelEvents(ref);
  const shown = visibleThreads(threads, filter, seen);
  const setFilter = (patch: Partial<CommentFilter>) => ui.filter.set({ ...ui.filter.get(), ...patch });

  const reveal = (id: string) => {
    const placed = ui.placedThread(id);
    if (placed !== undefined) {
      const bounds = editor.getViewportPageBounds();
      const zoom = editor.getZoomLevel();
      const { x, y } = placed.at;
      const inside = x > bounds.minX + 40 / zoom && x < bounds.maxX - 700 / zoom && y > bounds.minY + 80 / zoom && y < bounds.maxY - 200 / zoom;
      if (!inside) editor.centerOnPoint({ x: x + 300 / zoom, y }, { animation: { duration: 220 } });
    }
    ui.openThread(id);
  };

  return (
    <div
      ref={ref}
      data-comments-sidebar=""
      role="region"
      aria-label="Comments"
      className="pointer-events-auto absolute top-9 right-0 bottom-0 z-[calc(var(--tl-layer-watermark)_-_1)] box-border flex w-80 flex-col border-l bg-background font-sans text-foreground"
      onPointerDown={(event) => editor.markEventAsHandled(event)}
      onPointerMove={(event) => editor.markEventAsHandled(event)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        editor.getContainer().focus();
      }}
    >
      <div className="flex h-11 shrink-0 items-center border-b ps-4 pe-2">
        <span className="flex-1 text-sm font-semibold">Comments</span>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-2">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput size="sm" type="search" aria-label="Search comments" placeholder="Search" value={filter.query} onChange={(event) => setFilter({ query: event.target.value })} />
          {filter.query !== "" && (
            <InputGroupAddon align="inline-end">
              <Button variant="ghost-muted" size="icon-micro" aria-label="Clear search" onClick={() => setFilter({ query: "" })}>
                <X aria-hidden />
              </Button>
            </InputGroupAddon>
          )}
        </InputGroup>
        <Menu>
          <MenuTrigger aria-label="Sort and filter" title="Sort and filter" render={<Button variant="ghost" size="icon-sm" />}>
            <ListFilter aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end" className="w-56 min-w-0">
            <MenuRadioGroup value={filter.sort} onValueChange={(value) => setFilter({ sort: value as CommentFilter["sort"] })}>
              <MenuRadioItem value="date">Sort by date</MenuRadioItem>
              <MenuRadioItem value="unread">Sort by unread</MenuRadioItem>
            </MenuRadioGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuCheckboxItem checked={filter.showResolved} onCheckedChange={(checked) => setFilter({ showResolved: checked })}>
                Show resolved comments
              </MenuCheckboxItem>
              <MenuCheckboxItem checked={filter.onlyMine} onCheckedChange={(checked) => setFilter({ onlyMine: checked })}>
                Only your threads
              </MenuCheckboxItem>
            </MenuGroup>
          </MenuPopup>
        </Menu>
        <Menu>
          <MenuTrigger aria-label="More comment actions" title="More" render={<Button variant="ghost" size="icon-sm" />}>
            <Ellipsis aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end" className="w-44 min-w-0">
            <MenuItem onClick={() => ui.markAllSeen()}>Mark all as read</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-2 pb-14" data-comments-list="">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center text-[13px] text-muted-foreground">
            <MessageCircle aria-hidden className="size-6" />
            {threads.length === 0 ? <span>Click anywhere on the canvas to leave a comment. Mention @Claude or @Codex to ask an agent.</span> : <span>No comments match.</span>}
          </div>
        ) : (
          shown.map((thread) => (
            <SidebarRow
              key={thread.id}
              thread={thread}
              now={now}
              unread={isUnread(thread, seen)}
              selected={open?.kind === "thread" && open.id === thread.id}
              onOpen={() => reveal(thread.id)}
              onResolve={(resolved) => ui.setResolved(thread.id, resolved)}
              onToggleRead={() => (isUnread(thread, seen) ? ui.markSeen(thread.id) : ui.markUnread(thread.id))}
              onDelete={() => ui.deleteThread(thread.id)}
            />
          ))
        )}
      </div>
    </div>
  );
};
