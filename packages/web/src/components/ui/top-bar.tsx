"use client";

import type { ComponentPropsWithRef, CSSProperties, DragEvent, MouseEvent, ReactNode } from "react";
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
    /** The start region: the window controls' space, Settings on Windows, and the logo. */
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
  /**
   * The bar runs square from the window's left edge, with no flare or corner there: a panel docked under it (the agent
   * rail) meets its bottom border with no gap.
   */
  readonly squareStart?: boolean | undefined;
}

// The measured geometry of the reference (the user's prototype, `component-mac-topbar.html`): a 48 px bar whose two ends
// each curve out at the top and round off at the bottom with a 20 px radius, Settings 12 px past the bar's end, and the
// window controls 14 px in from the window edge.
const BAR_HEIGHT = 48;
const CURVE = 20;
/**
 * Window edge to the bar on macOS. The shell puts the traffic lights at x 20 (main.js `trafficLightPosition`); the three
 * lights span about 60 px, so they end near x 80 and the bar starts 12 px after them. The start region's spacer and the
 * bar's left edge both use this one number.
 */
const LIGHTS_ZONE = 92;
/** The bar's end to the Settings button (the flare overlaps the button's first 8 px). */
const SETTINGS_GAP = 12;
/** The Windows caption buttons (144 px) and the 12 px to the bar. */
const CAPTION_ZONE = 156;

/**
 * The bar's outline as one path, in the bar's own coordinates. Each end is a 20 px concave flare at the top, outside the
 * bar, and a 20 px convex corner at the bottom, inside it. The top stays open against the window edge. The fill closes the
 * top; the stroke does not, so the border is the outline and nothing more.
 */
const barEnd = (width: number) => `H${width - CURVE}A${CURVE} ${CURVE} 0 0 0 ${width} ${BAR_HEIGHT - CURVE}V${CURVE}A${CURVE} ${CURVE} 0 0 1 ${width + CURVE} 0`;
const barFill = (width: number, squareStart: boolean) =>
  squareStart
    ? `M0 0V${BAR_HEIGHT}${barEnd(width)}Z`
    : `M${-CURVE} 0A${CURVE} ${CURVE} 0 0 1 0 ${CURVE}V${BAR_HEIGHT - CURVE}A${CURVE} ${CURVE} 0 0 0 ${CURVE} ${BAR_HEIGHT}${barEnd(width)}Z`;
/** A square start has no side at the window edge, so its outline starts on the bottom border. */
const barStroke = (width: number, squareStart: boolean) =>
  squareStart ? `M0 ${BAR_HEIGHT}${barEnd(width)}` : barFill(width, false).replace(/Z$/, "");

const WindowDots = () => (
  <span className="flex h-full items-center gap-2 ps-3.5">
    <span className="size-3 rounded-full bg-muted-foreground/40" />
    <span className="size-3 rounded-full bg-muted-foreground/40" />
    <span className="size-3 rounded-full bg-muted-foreground/40" />
  </span>
);

/**
 * The project tab bar (spec 17), drawn to the reference: a 48 px bar with a 20 px flare and corner at each end, its border on
 * the outline, the window controls and Settings beside it. The tabs are the kit's underline Tabs, the buttons the kit's
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
  squareStart = false,
}: TopBarProps) => {
  const scroller = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string>();
  const [menu, setMenu] = useState<{ readonly name: string; readonly x: number; readonly y: number }>();
  const [bodyWidth, setBodyWidth] = useState(0);
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

  // The bar's body is its fill and outline. On macOS it starts at the lights' zone and stops 12 px before Settings; on
  // Windows it starts 12 px after Settings and stops before the caption buttons. Settings is the edge that moves, so the
  // body is measured from it, and its width is kept for the outline's path.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const body = bodyRef.current;
    const settingsNode = root?.querySelector<HTMLElement>("[data-slot=top-bar-settings]");
    if (root === null || root === undefined || body === null || settingsNode === null || settingsNode === undefined) return;
    const measure = () => {
      const bar = root.getBoundingClientRect();
      const square = settingsNode.getBoundingClientRect();
      if (windows) {
        body.style.left = squareStart ? "0px" : `${square.right + SETTINGS_GAP - bar.left}px`;
        body.style.right = `${CAPTION_ZONE}px`;
      } else {
        body.style.left = squareStart ? "0px" : `${LIGHTS_ZONE}px`;
        body.style.right = `${bar.right - (square.left - SETTINGS_GAP)}px`;
      }
      setBodyWidth(Math.round(body.getBoundingClientRect().width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [root, settingsNode]) observer.observe(element);
    return () => observer.disconnect();
  }, [windows, squareStart]);

  const positioned = layout === "flow" ? "relative " : "";
  const settingsNode = (
    <div data-slot="top-bar-settings" className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full">
      {settings}
    </div>
  );
  const region = (base: string, custom: TopBarRegion | undefined): TopBarRegion => ({ ...custom, className: cn(base, custom?.className) });
  const controlsSpace = (width: string, style?: CSSProperties) =>
    controls === "none" ? null : (
      <div data-slot="top-bar-controls" aria-hidden className={cn("h-12 shrink-0", width)} style={style}>
        {controls === "stand-ins" && <WindowDots />}
      </div>
    );

  return (
    <div data-slot="top-bar" data-platform={platform} ref={rootRef} {...region("relative box-border flex h-12 w-full min-w-0 items-stretch", regions.frame)}>
      <div data-slot="top-bar-body" ref={bodyRef} aria-hidden className="absolute inset-y-0 left-0 right-0">
        <svg className="pointer-events-none absolute inset-0 overflow-visible" width={bodyWidth} height={BAR_HEIGHT}>
          <path d={barFill(bodyWidth, squareStart)} className="fill-background stroke-none" />
          <path d={barStroke(bodyWidth, squareStart)} className="fill-none stroke-border" />
        </svg>
      </div>
      <div data-slot="top-bar-start" {...region(`${positioned}flex h-12 shrink-0 items-center`, regions.start)}>
        {!windows && controlsSpace("", { width: LIGHTS_ZONE })}
        {windows && <span className="flex shrink-0 items-center ps-3.5">{settingsNode}</span>}
        <span className={cn("flex shrink-0 items-center", windows ? "ms-3 ps-5 pe-2.5" : "ps-5 pe-2.5")}>{logo}</span>
      </div>
      <div data-slot="top-bar-tabs" {...region(`${positioned}flex h-12 min-w-0 shrink items-stretch`, regions.tabs)}>
        <Tabs className="h-12 w-fit min-w-0 shrink" value={active ?? null} onValueChange={(name) => onActivate(String(name))}>
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
        <div data-slot="top-bar-new" className="flex h-12 shrink-0 items-center ps-1">
          {newProject}
        </div>
      </div>
      <div data-slot="top-bar-drag" className={`${positioned}h-12 min-w-8 flex-1`} />
      <div data-slot="top-bar-end" {...region(`${positioned}flex h-12 shrink-0 items-center`, regions.end)}>
        {!windows && <span className="flex h-12 items-center pe-3.5">{settingsNode}</span>}
        {windows && controlsSpace("w-39")}
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
