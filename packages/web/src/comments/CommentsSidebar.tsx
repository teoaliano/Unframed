import { isUnread, visibleThreads, type CommentFilter } from "@unframed/domain";
import { Ellipsis, ListFilter, MessageCircle, Search, X } from "lucide-react";
import { Tip } from "../chrome/ui.tsx";
import { useRef } from "react";
import { usePassThroughWheelEvents, useValue } from "tldraw";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Menu, MenuCheckboxItem, MenuGroup, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { CommentsEmpty, SidebarRow, useNow } from "./parts.tsx";
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
      className="pointer-events-auto absolute top-9 right-0 bottom-0 z-[calc(var(--tl-layer-watermark)_-_1)] box-border flex w-80 flex-col border-l border-(--comment-sidebar-border) bg-(--comment-sidebar-surface) font-sans text-(--comment-sidebar-foreground)"
      onPointerDown={(event) => editor.markEventAsHandled(event)}
      onPointerMove={(event) => editor.markEventAsHandled(event)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        editor.getContainer().focus();
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-3.5">
        <MessageCircle aria-hidden className="size-4 shrink-0 text-(--comment-sidebar-icon)" />
        <h2 className="m-0 ml-1 flex-1 text-sm font-medium">Comments</h2>
        <Menu>
          <Tip label="Sort and filter">
            <MenuTrigger aria-label="Sort and filter" render={<Button variant="ghost" size="icon-sm" />}>
              <ListFilter aria-hidden />
            </MenuTrigger>
          </Tip>
          <MenuPopup align="end">
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
          <Tip label="More">
            <MenuTrigger aria-label="More comment actions" render={<Button variant="ghost" size="icon-sm" />}>
              <Ellipsis aria-hidden />
            </MenuTrigger>
          </Tip>
          <MenuPopup align="end">
            <MenuItem onClick={() => ui.markAllSeen()}>Mark all as read</MenuItem>
          </MenuPopup>
        </Menu>
      </header>
      <div className="shrink-0 px-2.5 pb-2.5">
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput size="sm" type="search" aria-label="Search comments" placeholder="Search comments" value={filter.query} onChange={(event) => setFilter({ query: event.target.value })} />
          {filter.query !== "" && (
            <InputGroupAddon align="inline-end">
              <Button variant="ghost-muted" size="icon-micro" aria-label="Clear search" onClick={() => setFilter({ query: "" })}>
                <X aria-hidden />
              </Button>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>
      <Separator />
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1.5 pb-14" data-comments-list="">
        {shown.length === 0 ? (
          <CommentsEmpty filtered={threads.length > 0} />
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
