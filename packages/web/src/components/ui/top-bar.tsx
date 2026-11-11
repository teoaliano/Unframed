"use client";

import type { ComponentPropsWithRef, MouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { Menu, MenuItem, MenuPopup, MenuSeparator } from "~/components/ui/menu";
import { ProjectTab, ProjectTabs, ProjectTabsList } from "~/components/ui/project-tabs";
import { useTabReorder, type TabPlan } from "~/components/ui/tab-reorder";
import { cn } from "~/lib/utils";

export type TopBarStatus = "running" | "finished" | "needs-you";

export interface TopBarTab {
  readonly name: string;
  /** The status mark after the name: a spinner while running, a check when finished, a dot when it waits for the person. */
  readonly status?: TopBarStatus | undefined;
  /** The tooltip. Defaults to the name. */
  readonly title?: string | undefined;
  /** The activity state a test or a style reads (`data-status`). Defaults to the status, else "none". */
  readonly state?: string | undefined;
  readonly pinned?: boolean | undefined;
  readonly label?: string | undefined;
  readonly icon?: ReactNode;
  readonly context?: string | undefined;
  readonly variant?: "default" | "secondary" | undefined;
  readonly attachedTo?: string | undefined;
}

const tabPlan = (tabs: ReadonlyArray<TopBarTab>, name: string): TabPlan => {
  const tab = tabs.find((each) => each.name === name);
  const at = tabs.findIndex((each) => each.name === name);
  if (tab?.attachedTo !== undefined) {
    let low = at;
    let high = at;
    while (low > 0 && tabs[low - 1]!.attachedTo === tab.attachedTo) low--;
    while (high < tabs.length - 1 && tabs[high + 1]!.attachedTo === tab.attachedTo) high++;
    return { unit: [name], lane: tabs.slice(low, high + 1).map((each) => [each.name]) };
  }
  if (tab?.pinned === true) return { unit: [name], lane: tabs.filter((each) => each.pinned === true).map((each) => [each.name]) };
  const lane: string[][] = [];
  tabs.forEach((each, index) => {
    if (each.pinned === true || each.attachedTo !== undefined) return;
    const unit = [each.name];
    for (let next = index + 1; next < tabs.length && tabs[next]!.attachedTo === each.name; next++) unit.push(tabs[next]!.name);
    lane.push(unit);
  });
  return { unit: lane.find((unit) => unit[0] === name) ?? [name], lane };
};

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
  readonly onPin?: (name: string) => void;
  readonly onUnpin?: (name: string) => void;
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

export const TOP_BAR_HEIGHT = 36;

/**
 * Window edge to the logo on macOS, as the start region's padding. The shell puts the traffic lights at x 12 (spec 17's
 * `trafficLightPosition`) and the group ends near x 72, so the logo starts 22 px after the green light. The shell's own
 * `padding-left` on `.unframed-chrome-left` (spec 01) replaces this padding rather than adding to it.
 */
const LIGHTS_INSET = "ps-23.5";

const DRAG = "[-webkit-app-region:drag]";
const NO_DRAG_CONTROLS = "[&_button]:[-webkit-app-region:no-drag]";
const NO_DRAG_TAB_CONTROLS = "[&_[data-tab-item]]:[-webkit-app-region:no-drag] [&_[data-slot=project-tab]]:[-webkit-app-region:no-drag] [&_[data-close]]:[-webkit-app-region:no-drag]";

const PinnedMark = ({ name }: { readonly name: string }) => (
  <span
    aria-hidden
    data-slot="top-bar-mark"
    data-letter={(name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase()}
    className="flex size-4 items-center justify-center rounded-[4px] border bg-muted text-[10px] leading-none font-semibold text-foreground before:content-[attr(data-letter)]"
  />
);

const WindowDots = () => (
  <span className="flex h-full items-center gap-2 ps-3">
    <span className="size-3 rounded-full bg-muted-foreground/40" />
    <span className="size-3 rounded-full bg-muted-foreground/40" />
    <span className="size-3 rounded-full bg-muted-foreground/40" />
  </span>
);

/**
 * The project tab bar (spec 17): one solid 36 px bar across the window, its border along the bottom, the window
 * controls and Settings inside it. The tabs are the bar's own project tabs, the buttons the kit's buttons; a
 * right-click on a tab opens Pin, Close, Close all tabs, Rename and Delete.
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
  onPin,
  onUnpin,
  regions = {},
  layout = "flow",
  controls = "stand-ins",
}: TopBarProps) => {
  const scroller = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ readonly name: string; readonly x: number; readonly y: number }>();
  const names = tabs.map((tab) => tab.name);
  const pinned = tabs.filter((tab) => tab.pinned === true).map((tab) => tab.name);
  const reorder = useTabReorder({ list: scroller, names, pinned, plan: (name) => tabPlan(tabs, name), onMove });
  const windows = platform === "windows";

  useEffect(() => {
    if (active === undefined) return;
    scroller.current?.querySelector<HTMLElement>(`[data-project="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const tabOf = (target: EventTarget): string | undefined =>
    target instanceof Element ? (target.closest<HTMLElement>("[data-tab-item]")?.dataset.tabItem ?? undefined) : undefined;
  const pinnedTab = (name: string) => tabs.find((tab) => tab.name === name)?.pinned === true;
  const secondaryTab = (name: string) => tabs.find((tab) => tab.name === name)?.variant === "secondary";

  const onListClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element) || event.target.closest("[data-close]") === null) return;
    const name = tabOf(event.target);
    if (name !== undefined) onClose(name);
  };
  const onListAux = (event: MouseEvent<HTMLDivElement>) => {
    const name = tabOf(event.target);
    if (name !== undefined && event.button === 1 && !pinnedTab(name)) onClose(name);
  };
  const onListContext = (event: MouseEvent<HTMLDivElement>) => {
    const name = tabOf(event.target);
    if (name === undefined) return;
    event.preventDefault();
    setMenu({ name, x: event.clientX, y: event.clientY });
  };

  const positioned = layout === "flow" ? "relative " : "";
  const tabMenu = menu === undefined ? "none" : secondaryTab(menu.name) ? "short" : "full";
  const settingsNode = (
    <div data-slot="top-bar-settings" className={cn("flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full", NO_DRAG_CONTROLS)}>
      {settings}
    </div>
  );
  const region = (base: string, custom: TopBarRegion | undefined): TopBarRegion => ({ ...custom, className: cn(base, custom?.className) });
  const lights = !windows && controls !== "none";

  return (
    <div data-slot="top-bar" data-platform={platform} {...region(`relative box-border flex h-9 w-full min-w-0 items-stretch ${DRAG}`, regions.frame)}>
      <div data-slot="top-bar-body" aria-hidden className="pointer-events-none absolute inset-0 box-border border-b bg-background" />
      <div data-slot="top-bar-start" {...region(cn(positioned, "flex h-9 shrink-0 items-center", DRAG, windows ? "pe-3" : "pe-4", lights && LIGHTS_INSET), regions.start)}>
        {lights && (
          <div data-slot="top-bar-controls" aria-hidden className="pointer-events-none absolute inset-y-0 left-0 [-webkit-app-region:drag]!">
            {controls === "stand-ins" && <WindowDots />}
          </div>
        )}
        <span data-slot="top-bar-logo" className={cn("flex shrink-0 items-center [-webkit-app-region:drag]!", !lights && "ps-3")}>
          {logo}
        </span>
        {windows && <span className="flex shrink-0 items-center ps-3">{settingsNode}</span>}
      </div>
      <div data-slot="top-bar-tabs" {...region(`${positioned}flex h-9 min-w-0 shrink items-stretch ${DRAG}`, regions.tabs)}>
        <ProjectTabs className="w-fit min-w-0 shrink" value={active ?? null} onValueChange={(name) => onActivate(String(name))}>
          <ProjectTabsList
            ref={scroller}
            aria-label="Open projects"
            className={cn("min-w-0", NO_DRAG_TAB_CONTROLS)}
            onClick={onListClick}
            onAuxClick={onListAux}
            onContextMenu={onListContext}
            onPointerDown={reorder.onPointerDown}
          >
            {tabs.map((tab) => (
              <ProjectTab
                key={tab.name}
                item={tab.name}
                value={tab.name}
                data-project={tab.name}
                data-active={tab.name === active ? "true" : undefined}
                data-status={tab.state ?? tab.status ?? "none"}
                data-pinned={tab.pinned === true ? "true" : undefined}
                data-variant={tab.variant ?? "default"}
                aria-label={tab.pinned === true ? tab.name : tab.context === undefined ? undefined : `${tab.label ?? tab.name}, ${tab.context}`}
                title={tab.title ?? tab.name}
                closable={tab.pinned !== true}
                closeLabel={`Close ${tab.label ?? tab.name}`}
                className={
                  tab.pinned === true
                    ? "w-9 min-w-0 justify-center gap-0 ps-0 pe-0 [&_[data-slot=tabs-status]]:ms-0.5"
                    : tab.variant === "secondary"
                      ? "max-w-56 gap-1.5"
                      : tab.icon === undefined
                        ? undefined
                        : "gap-1.5"
                }
                {...(tab.status === undefined ? {} : { status: tab.status })}
              >
                {tab.pinned === true ? (
                  <PinnedMark name={tab.name} />
                ) : (
                  <>
                    {tab.icon}
                    <span className="min-w-0 truncate">{tab.label ?? tab.name}</span>
                    {tab.context !== undefined && (
                      <span data-slot="top-bar-tab-context" className="min-w-0 max-w-20 shrink-[2] truncate text-muted-foreground before:me-1 before:content-['·']">
                        {tab.context}
                      </span>
                    )}
                  </>
                )}
              </ProjectTab>
            ))}
          </ProjectTabsList>
        </ProjectTabs>
        <div data-slot="top-bar-new" className={cn("flex h-9 shrink-0 items-center ps-2", NO_DRAG_CONTROLS)}>
          {newProject}
        </div>
      </div>
      {layout === "flow" && <div data-slot="top-bar-drag" className={`relative h-9 min-w-8 flex-1 ${DRAG}`} />}
      <div data-slot="top-bar-end" {...region(`${positioned}flex h-9 shrink-0 items-center ${DRAG}`, regions.end)}>
        {!windows && <span className="flex h-9 items-center pe-3">{settingsNode}</span>}
        {windows && controls !== "none" && (
          <div data-slot="top-bar-controls" aria-hidden className="pointer-events-none h-9 w-39 shrink-0 [-webkit-app-region:drag]!">
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
          {tabMenu === "full" && pinnedTab(menu!.name) && onUnpin && <MenuItem onClick={() => onUnpin(menu!.name)}>Unpin tab</MenuItem>}
          {tabMenu === "full" && !pinnedTab(menu!.name) && onPin && <MenuItem onClick={() => onPin(menu!.name)}>Pin tab</MenuItem>}
          {tabMenu === "full" && (onPin || onUnpin) && <MenuSeparator />}
          <MenuItem onClick={() => menu && onClose(menu.name)}>Close</MenuItem>
          <MenuItem onClick={() => onCloseAll()}>Close all tabs</MenuItem>
          {tabMenu === "full" && (onRename || onDelete) && <MenuSeparator />}
          {tabMenu === "full" && onRename && <MenuItem onClick={() => menu && onRename(menu.name)}>Rename project</MenuItem>}
          {tabMenu === "full" && onDelete && (
            <MenuItem variant="destructive" onClick={() => menu && onDelete(menu.name)}>
              Delete project
            </MenuItem>
          )}
        </MenuPopup>
      </Menu>
    </div>
  );
};
