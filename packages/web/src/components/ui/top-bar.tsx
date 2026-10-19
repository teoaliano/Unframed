"use client";

import type { ComponentPropsWithRef, DragEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
   * "flow" lays the regions out in a row (the catalogue). "fixed" leaves them to their own fixed positions, which the app's
   * DOM hooks give them (spec 01), so the regions are not made relative.
   */
  readonly layout?: "flow" | "fixed" | undefined;
  /**
   * The window controls' space. "stand-ins" reserves it and draws placeholders (the catalogue). "none" leaves it
   * out: the app's controls belong to the window, and the shell insets the regions for them (spec 01).
   */
  readonly controls?: "stand-ins" | "none" | undefined;
}

const BAR_HEIGHT = 44;
const FLARE_WIDTH = 40;
/** The space between the flare and the Settings square. */
const FLARE_GAP = 8;

/**
 * The bar's end, drawn as a path: the bottom edge runs out, bends up with a convex corner, and bends right again into the
 * top edge with a concave one, as a Chrome tab flares into its toolbar. The fill is the bar's own background and the stroke
 * its border, so the flare joins the bar. On Windows the flare is mirrored, with Settings on the other side.
 */
const Flare = ({ side }: { readonly side: "start" | "end" }) => (
  <svg
    data-slot="top-bar-flare"
    aria-hidden
    width={FLARE_WIDTH}
    height={BAR_HEIGHT}
    viewBox={`0 0 ${FLARE_WIDTH} ${BAR_HEIGHT}`}
    className={cn("absolute top-0", side === "end" ? "-right-10" : "-left-10 -scale-x-100")}
  >
    <path d="M0 43.5H13C20 43.5 21 39 21 30C21 12 25 .5 40 .5H0Z" className="fill-background" />
    <path d="M0 43.5H13C20 43.5 21 39 21 30C21 12 25 .5 40 .5M0 .5H40" className="fill-none stroke-border" />
  </svg>
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
  layout = "flow",
  controls = "stand-ins",
}: TopBarProps) => {
  const scroller = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
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

  // The body is the bar's fill and borders, and its flare is drawn at the edge it stops at. That edge sits beside the
  // Settings square: the flare sits FLARE_GAP from the square and is FLARE_WIDTH wide, and the body stops where the flare
  // starts (on macOS, the flare's left edge; on Windows, the flare's right edge). The body is below the canvas's floating layer, as the tab strip is, so the flare is too.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const body = bodyRef.current;
    const settings = root?.querySelector<HTMLElement>("[data-slot=top-bar-settings]");
    if (root === null || root === undefined || body === null || settings === null || settings === undefined || settings.parentElement === null) return;
    const measure = () => {
      const bar = root.getBoundingClientRect();
      const square = settings.getBoundingClientRect();
      if (windows) {
        body.style.left = `${square.right + FLARE_GAP + FLARE_WIDTH - bar.left}px`;
        body.style.right = "0px";
      } else {
        body.style.left = "0px";
        body.style.right = `${bar.right - (square.left - FLARE_GAP - FLARE_WIDTH)}px`;
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [root, settings, settings.parentElement]) observer.observe(element);
    return () => observer.disconnect();
  }, [windows]);

  const positioned = layout === "flow" ? "relative " : "";
  const settingsNode = (
    <div data-slot="top-bar-settings" className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card">
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
    <div data-slot="top-bar" data-platform={platform} ref={rootRef} {...region("relative box-border flex h-11 w-full min-w-0 items-stretch", regions.frame)}>
      <div data-slot="top-bar-body" ref={bodyRef} aria-hidden className="absolute inset-y-0 left-0 right-0 box-border border-y bg-background">
        <Flare side={windows ? "start" : "end"} />
      </div>
      <div data-slot="top-bar-start" {...region(`${positioned}flex h-11 shrink-0 items-center gap-2 border-e px-3`, regions.start)}>
        {!windows && controlsSpace("w-23")}
        {windows && settingsNode}
        <span className="flex shrink-0 items-center">{logo}</span>
      </div>
      <div data-slot="top-bar-tabs" {...region(`${positioned}flex h-11 min-w-0 shrink items-stretch`, regions.tabs)}>
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
                <span className="min-w-0 truncate">{tab.name}</span>
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
        <div data-slot="top-bar-new" className="flex h-11 shrink-0 items-center px-1">
          {newProject}
        </div>
      </div>
      <div data-slot="top-bar-drag" className={`${positioned}h-11 min-w-8 flex-1`} />
      <div data-slot="top-bar-end" {...region(`${positioned}flex h-11 shrink-0 items-center`, regions.end)}>
        {!windows && <span className="flex h-11 items-center pe-2 ps-1.5">{settingsNode}</span>}
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
