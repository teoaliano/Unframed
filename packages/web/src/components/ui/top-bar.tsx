"use client";

import type { ComponentPropsWithRef, DragEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { Menu, MenuItem, MenuPopup, MenuSeparator } from "~/components/ui/menu";
import { ProjectTab, ProjectTabs, ProjectTabsList } from "~/components/ui/project-tabs";
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
  /** macOS: window controls, then the logo, the tabs and Settings. Windows: the logo, Settings, the tabs, then the controls. */
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
    /** The start region: the window controls' space, the logo, and Settings on Windows. */
    readonly start?: TopBarRegion;
    /** The tabs and the plus. */
    readonly tabs?: TopBarRegion;
    /** The end region: Settings on macOS, the window controls' space on Windows. */
    readonly end?: TopBarRegion;
  };
  /**
   * "flow" lays the regions out in a row (the catalogue). "fixed" leaves them to their own fixed positions, which the app's
   * DOM hooks give them (spec 01), so the regions are not made relative.
   */
  readonly layout?: "flow" | "fixed" | undefined;
  /**
   * The window controls' space. "stand-ins" reserves it and draws placeholders (the catalogue). "space" reserves it and
   * draws nothing: the app's controls are the window's own, drawn over that space. "none" leaves it out.
   */
  readonly controls?: "stand-ins" | "space" | "none" | undefined;
}

/**
 * Window edge to the logo on macOS, as the start region's padding. The shell puts the traffic lights at x 12 (spec 17's
 * `trafficLightPosition`) and the group ends near x 72, so the logo starts 22 px after the green light. The shell's own `padding-left` on `.unframed-chrome-left` (spec 01) replaces this
 * padding rather than adding to it.
 */
const LIGHTS_INSET = "ps-23.5";

const WindowDots = () => (
  <span className="flex h-full items-center gap-2 ps-3">
    <span className="size-3 rounded-full bg-muted-foreground/40" />
    <span className="size-3 rounded-full bg-muted-foreground/40" />
    <span className="size-3 rounded-full bg-muted-foreground/40" />
  </span>
);

/**
 * The project tab bar (spec 17): one solid 36 px bar across the window, its border along the bottom, the window
 * controls and Settings inside it. The tabs are the bar's own project tabs, the buttons the kit's
 * buttons; a right-click on a tab opens Close, Close all tabs, Rename and Delete.
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
    const group = target.closest("[data-slot='project-tab-group']");
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

  const positioned = layout === "flow" ? "relative " : "";
  const settingsNode = (
    <div data-slot="top-bar-settings" className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full">
      {settings}
    </div>
  );
  const region = (base: string, custom: TopBarRegion | undefined): TopBarRegion => ({ ...custom, className: cn(base, custom?.className) });
  const lights = !windows && controls !== "none";

  return (
    <div data-slot="top-bar" data-platform={platform} {...region("relative box-border flex h-9 w-full min-w-0 items-stretch", regions.frame)}>
      <div data-slot="top-bar-body" aria-hidden className="pointer-events-none absolute inset-0 box-border border-b bg-background" />
      <div data-slot="top-bar-start" {...region(cn(positioned, "flex h-9 shrink-0 items-center", windows ? "pe-3" : "pe-4", lights && LIGHTS_INSET), regions.start)}>
        {lights && (
          <div data-slot="top-bar-controls" aria-hidden className="pointer-events-none absolute inset-y-0 left-0">
            {controls === "stand-ins" && <WindowDots />}
          </div>
        )}
        <span className={cn("flex shrink-0 items-center", !lights && "ps-3")}>{logo}</span>
        {windows && <span className="flex shrink-0 items-center ps-3">{settingsNode}</span>}
      </div>
      <div data-slot="top-bar-tabs" {...region(`${positioned}flex h-9 min-w-0 shrink items-stretch`, regions.tabs)}>
        <ProjectTabs className="w-fit min-w-0 shrink" value={active ?? null} onValueChange={(name) => onActivate(String(name))}>
          <ProjectTabsList
            ref={scroller}
            aria-label="Open projects"
            className="min-w-0"
            onClick={onListClick}
            onAuxClick={onListAux}
            onContextMenu={onListContext}
            onDragStart={onListDragStart}
            onDragOver={onListDragOver}
            onDrop={onListDrop}
            onDragEnd={() => setDragging(undefined)}
          >
            {tabs.map((tab) => (
              <ProjectTab
                key={tab.name}
                value={tab.name}
                data-project={tab.name}
                data-active={tab.name === active ? "true" : undefined}
                data-status={tab.state ?? tab.status ?? "none"}
                title={tab.title ?? tab.name}
                draggable
                closeLabel={`Close ${tab.name}`}
                {...(tab.status === undefined ? {} : { status: tab.status })}
              >
                <span className="min-w-0 truncate">{tab.name}</span>
              </ProjectTab>
            ))}
          </ProjectTabsList>
        </ProjectTabs>
        <div data-slot="top-bar-new" className="flex h-9 shrink-0 items-center ps-2">
          {newProject}
        </div>
      </div>
      <div data-slot="top-bar-drag" className={`${positioned}h-9 min-w-8 flex-1`} />
      <div data-slot="top-bar-end" {...region(`${positioned}flex h-9 shrink-0 items-center`, regions.end)}>
        {!windows && <span className="flex h-9 items-center pe-3">{settingsNode}</span>}
        {windows && controls !== "none" && (
          <div data-slot="top-bar-controls" aria-hidden className="pointer-events-none h-9 w-39 shrink-0">
            {controls === "stand-ins" && <WindowDots />}
          </div>
        )}
      </div>
      <Menu open={menu !== undefined} onOpenChange={(open) => !open && setMenu(undefined)}>
        <MenuPopup
          anchor={menu === undefined ? undefined : { getBoundingClientRect: () => new DOMRect(menu.x, menu.y, 0, 0) }}
          align="start"
          side="bottom"
          sideOffset={4}
          className="min-w-45"
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
