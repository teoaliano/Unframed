"use client";

import { cva } from "class-variance-authority";
import type { ComponentPropsWithRef, DragEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { Menu, MenuItem, MenuPopup, MenuSeparator } from "~/components/ui/menu";
import { Tabs, TabsList, TabsTab } from "~/components/ui/tabs";
import { cn } from "~/lib/utils";

export type TopBarStatus = "running" | "finished" | "dot";

export interface TopBarTab {
  readonly name: string;
  /** The status mark after the name: a spinner while running, a check when finished, a dot when it waits for the person. */
  readonly status?: TopBarStatus | undefined;
  /** The tooltip. Defaults to the name. */
  readonly title?: string | undefined;
  /** The activity state a test or a style reads (`data-status`). Defaults to the status, else "none". */
  readonly state?: string | undefined;
}

/** A region's element props. The app passes its hook classes, refs and inline offsets here; the catalogue passes none. */
export type TopBarRegion = Omit<ComponentPropsWithRef<"div">, "children"> & { readonly [attribute: `data-${string}`]: string | undefined };

export interface TopBarProps {
  /** macOS: window controls, then the logo, the tabs and Settings. Windows: Settings, the logo, the tabs, then the controls. */
  readonly platform: "macos" | "windows";
  readonly tabs: ReadonlyArray<TopBarTab>;
  readonly active: string | undefined;
  readonly logo: ReactNode;
  readonly settings: ReactNode;
  /** The control after the last tab, the plus. */
  readonly newProject: ReactNode;
  readonly onActivate: (name: string) => void;
  readonly onClose: (name: string) => void;
  readonly onCloseAll: () => void;
  readonly onRename?: (name: string) => void;
  readonly onDelete?: (name: string) => void;
  /** Moves a dragged tab to position `to` in the order. */
  readonly onMove?: (name: string, to: number) => void;
  readonly regions?: {
    /** The bar behind the three regions. */
    readonly frame?: TopBarRegion;
    /** The start region: the window controls' inset, Settings on Windows, and the logo. */
    readonly start?: TopBarRegion;
    /** The tabs and the plus. */
    readonly tabs?: TopBarRegion;
    /** The end region: Settings on macOS, the window controls' inset on Windows. */
    readonly end?: TopBarRegion;
  };
  /**
   * The window controls' space. "stand-ins" reserves it and draws placeholders (the catalogue). "none" leaves it
   * out: the app's controls belong to the window, and the shell insets the regions for them (spec 01).
   */
  readonly controls?: "stand-ins" | "none" | undefined;
}

// Settings in its own raised cell: the bottom edge sweeps up into it on the side that faces the tabs, as a browser's active tab does.
const settingsCell = cva(
  "relative flex h-11 shrink-0 items-center rounded-t-xl border-x border-t border-border bg-card px-1.5 before:absolute before:bottom-0 before:size-3 after:absolute after:bottom-0 after:size-3",
  {
    variants: {
      side: {
        start: "after:-end-3 after:bg-[radial-gradient(circle_at_100%_0,transparent_0.75rem,var(--color-background)_0.75rem)]",
        end: "before:-start-3 before:bg-[radial-gradient(circle_at_0_0,transparent_0.75rem,var(--color-background)_0.75rem)]",
      },
    },
  },
);

const WindowDots = () => (
  <span className="flex h-full items-center gap-2 ps-4">
    <span className="size-3 rounded-full bg-muted-foreground/40" />
    <span className="size-3 rounded-full bg-muted-foreground/40" />
    <span className="size-3 rounded-full bg-muted-foreground/40" />
  </span>
);

/**
 * The project tab bar (spec 17): one full-width bar with the window controls, the logo, the tabs,
 * the plus and Settings. Dividers run the full height of the bar between the logo and the tabs and
 * between the tabs. The tabs are the kit's underline Tabs; a right-click on a tab opens Close, Close
 * all tabs, Rename and Delete.
 */
export const TopBar = ({
  platform,
  tabs,
  active,
  logo,
  settings,
  newProject,
  onActivate,
  onClose,
  onCloseAll,
  onRename,
  onDelete,
  onMove,
  regions = {},
  controls = "stand-ins",
}: TopBarProps) => {
  const scroller = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string>();
  const [menu, setMenu] = useState<{ readonly name: string; readonly x: number; readonly y: number }>();
  const names = tabs.map((tab) => tab.name);
  const windows = platform === "windows";

  useEffect(() => {
    if (active === undefined) return;
    scroller.current?.querySelector<HTMLElement>(`[data-project="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  /** The tab an event landed on. A tab's close button sits beside the tab, in the same group. */
  const tabOf = (target: EventTarget): string | undefined => {
    if (!(target instanceof Element)) return undefined;
    const group = target.closest("[data-slot='tabs-tab-group']");
    const tab = group === null ? target.closest<HTMLElement>("[data-project]") : group.querySelector<HTMLElement>("[data-project]");
    return tab?.dataset.project;
  };

  // Close, drag, middle-click and the right-click menu sit on the list, not on each tab: a handler per tab adds
  // listeners the budget counts (spec 17).
  const onListClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element) || event.target.closest("[data-close]") === null) return;
    const name = tabOf(event.target);
    if (name !== undefined) onClose(name);
  };
  const onListAux = (event: MouseEvent<HTMLDivElement>) => {
    const name = tabOf(event.target);
    if (name !== undefined && event.button === 1) onClose(name);
  };
  const onListContext = (event: MouseEvent<HTMLDivElement>) => {
    const name = tabOf(event.target);
    if (name === undefined) return;
    event.preventDefault();
    setMenu({ name, x: event.clientX, y: event.clientY });
  };
  const onListDragStart = (event: DragEvent<HTMLDivElement>) => {
    const name = tabOf(event.target);
    if (name === undefined) return;
    event.dataTransfer.setData("text/plain", name);
    event.dataTransfer.effectAllowed = "move";
    setDragging(name);
  };
  const onListDragOver = (event: DragEvent<HTMLDivElement>) => {
    const name = tabOf(event.target);
    if (name !== undefined && dragging !== undefined && dragging !== name) event.preventDefault();
  };
  const onListDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const name = tabOf(event.target);
    if (name !== undefined && dragging !== undefined && dragging !== name) onMove?.(dragging, names.indexOf(name));
    setDragging(undefined);
  };

  const settingsCellNode = (
    <div data-slot="top-bar-settings" className={settingsCell({ side: windows ? "start" : "end" })}>
      {settings}
    </div>
  );
  const region = (base: string, custom: TopBarRegion | undefined): TopBarRegion => ({ ...custom, className: cn(base, custom?.className) });
  const controlsSpace = (width: string) =>
    controls === "none" ? null : (
      <div data-slot="top-bar-controls" aria-hidden className={cn("h-11 shrink-0", width)}>
        <WindowDots />
      </div>
    );

  return (
    <div data-slot="top-bar" data-platform={platform} {...region("box-border flex h-11 w-full min-w-0 items-stretch border-y bg-background", regions.frame)}>
      <div data-slot="top-bar-start" {...region("flex h-11 shrink-0 items-center gap-2 border-e px-3", regions.start)}>
        {!windows && controlsSpace("w-23")}
        {windows && settingsCellNode}
        <span className="flex shrink-0 items-center">{logo}</span>
      </div>
      <div data-slot="top-bar-tabs" {...region("flex h-11 min-w-0 shrink items-stretch", regions.tabs)}>
        <Tabs className="h-11 w-fit min-w-0 shrink" value={active ?? null} onValueChange={(name) => onActivate(String(name))}>
          <TabsList
            ref={scroller}
            aria-label="Open projects"
            variant="underline"
            size="compact"
            overflow="truncate"
            className="h-full min-w-0 max-w-full"
            onClick={onListClick}
            onAuxClick={onListAux}
            onContextMenu={onListContext}
            onDragStart={onListDragStart}
            onDragOver={onListDragOver}
            onDrop={onListDrop}
            onDragEnd={() => setDragging(undefined)}
          >
            {tabs.map((tab) => (
              <TabsTab
                key={tab.name}
                value={tab.name}
                data-project={tab.name}
                data-active={tab.name === active ? "true" : undefined}
                data-status={tab.state ?? tab.status ?? "none"}
                title={tab.title ?? tab.name}
                draggable
                divider
                closable
                closeLabel={`Close ${tab.name}`}
                {...(tab.status === undefined ? {} : { status: tab.status })}
              >
                <span className="truncate">{tab.name}</span>
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
        <div data-slot="top-bar-new" className="flex h-11 shrink-0 items-center px-1">
          {newProject}
        </div>
      </div>
      <div data-slot="top-bar-drag" className="h-11 min-w-8 flex-1" />
      <div data-slot="top-bar-end" {...region("flex h-11 shrink-0 items-center gap-2 px-2", regions.end)}>
        {!windows && settingsCellNode}
        {windows && controlsSpace("w-36")}
      </div>
      <Menu open={menu !== undefined} onOpenChange={(open) => !open && setMenu(undefined)}>
        <MenuPopup
          anchor={menu === undefined ? undefined : { getBoundingClientRect: () => new DOMRect(menu.x, menu.y, 0, 0) }}
          align="start"
          side="bottom"
          sideOffset={4}
          className="min-w-[180px]"
          data-testid="tab-menu"
        >
          <MenuItem onClick={() => menu && onClose(menu.name)}>Close</MenuItem>
          <MenuItem onClick={() => onCloseAll()}>Close all tabs</MenuItem>
          <MenuSeparator />
          {onRename && <MenuItem onClick={() => menu && onRename(menu.name)}>Rename project</MenuItem>}
          {onDelete && (
            <MenuItem variant="destructive" onClick={() => menu && onDelete(menu.name)}>
              Delete project
            </MenuItem>
          )}
        </MenuPopup>
      </Menu>
    </div>
  );
};
