import type { ProjectActivity } from "@unframed/contracts";
import { statusOf, type TabActivity, type TabStatus } from "@unframed/domain";
import { useEffect, useRef, useState, type ComponentProps, type DragEvent, type MouseEvent } from "react";
import { X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator } from "~/components/ui/menu";
import { Tabs, TabsList, TabsTab } from "~/components/ui/tabs";
import { useEngine, useActivation } from "../context.ts";
import { useTabState } from "../project/activation.ts";
import { ProjectMenu } from "./ProjectMenu.tsx";
import { PROJECT_ACTION, type ProjectActionDetail } from "./tabEvents.ts";

/** Room the strip keeps for the All projects button and its gap, so tabs share the rest. */
const MENU_SPACE = 44;

/**
 * Every project's live work, from `projects.activity` (spec 17). Projects with no work are
 * absent, which reads as zero. The stream is one per page.
 */
export const useProjectActivity = (): ReadonlyMap<string, TabActivity> => {
  const engine = useEngine();
  const [activity, setActivity] = useState<ReadonlyMap<string, TabActivity>>(() => new Map());
  useEffect(
    () =>
      engine.subscribe("projects.activity", undefined, (item: ProjectActivity) => {
        setActivity((current) => {
          const next = new Map(current);
          if (item.running === 0 && item.needsYou === 0) next.delete(item.project);
          else next.set(item.project, { running: item.running, needsYou: item.needsYou });
          return next;
        });
      }),
    [engine],
  );
  return activity;
};

/**
 * The project tabs that were running and have since finished, while they were in the
 * background (spec 17). Looking at a tab clears its mark. Kept in memory only.
 */
export const useFinishedMarks = (activity: ReadonlyMap<string, TabActivity>, active: string | undefined): ReadonlySet<string> => {
  const [marks, setMarks] = useState<ReadonlySet<string>>(() => new Set());
  const previous = useRef(activity);
  useEffect(() => {
    const before = previous.current;
    previous.current = activity;
    const finished: string[] = [];
    for (const [project, was] of before) {
      if (was.running > 0 && (activity.get(project)?.running ?? 0) === 0 && project !== active) finished.push(project);
    }
    if (finished.length > 0) setMarks((current) => new Set([...current, ...finished]));
  }, [activity, active]);
  useEffect(() => {
    if (active === undefined) return;
    setMarks((current) => {
      if (!current.has(active)) return current;
      const next = new Set(current);
      next.delete(active);
      return next;
    });
  }, [active]);
  return marks;
};

const STATUS_LABEL: Record<TabStatus, string> = {
  "needs-you": "Waiting for you in a chat",
  running: "Working",
  finished: "Finished while you were away",
  none: "",
};

type KitTabStatus = ComponentProps<typeof TabsTab>["status"];

/**
 * The kit's status slot (underline look, spec 13): a spinner while working, a check when finished unseen, and a dot
 * for a chat waiting on the person. The kit has no "waiting" icon of its own, so the dot stands in for it.
 */
const kitStatus = (status: TabStatus): KitTabStatus => {
  if (status === "running") return "running";
  if (status === "finished") return "finished";
  if (status === "needs-you") return "dot";
  return undefined;
};

/**
 * The project tab strip (spec 17), on the kit Tabs component in its underline look. One tab per open project and
 * All projects at its end. It reads the tab state and the activity; it never touches the canvas.
 */
export const TabStrip = ({ left, right }: { readonly left: number; readonly right: number }) => {
  const activation = useActivation();
  const { active, order } = useTabState(activation);
  const activity = useProjectActivity();
  const marks = useFinishedMarks(activity, active);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active === undefined) return;
    scroller.current?.querySelector<HTMLElement>(`[data-project="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  // Drag a tab onto another to take its place (spec 17); Alt+arrow does the same from the keyboard.
  const [dragging, setDragging] = useState<string>();
  // The right-click menu: the project it is for, and the pointer's place.
  const [menu, setMenu] = useState<{ readonly name: string; readonly x: number; readonly y: number }>();

  /** The tab an event landed on, by its project name. A tab's close button sits beside the tab, in the same group. */
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
    if (name !== undefined) void activation.closeTab(name);
  };
  const onListAux = (event: MouseEvent<HTMLDivElement>) => {
    const name = tabOf(event.target);
    if (name !== undefined && event.button === 1) void activation.closeTab(name);
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
    if (name !== undefined && dragging !== undefined && dragging !== name) activation.moveTab(dragging, order.indexOf(name));
    setDragging(undefined);
  };

  const project = (action: ProjectActionDetail["action"], name: string) => {
    window.dispatchEvent(new CustomEvent<ProjectActionDetail>(PROJECT_ACTION, { detail: { action, name } }));
  };

  return (
    <div className="unframed-tabs box-border flex h-11 min-w-0 items-center gap-1 bg-background px-1" style={{ left, right }} data-testid="tab-strip">
      <Tabs className="min-w-0 shrink" value={active ?? null} onValueChange={(name) => void activation.activate(String(name))}>
        <TabsList
          ref={scroller}
          aria-label="Open projects"
          variant="underline"
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
          {order.map((name) => {
            const isActive = name === active;
            const status = statusOf(activity.get(name), marks.has(name));
            const kit = kitStatus(status);
            return (
              <TabsTab
                key={name}
                value={name}
                data-project={name}
                data-active={isActive ? "true" : undefined}
                data-status={status}
                title={[name, STATUS_LABEL[status]].filter(Boolean).join(" · ")}
                draggable
                divider
                closable
                closeLabel={`Close ${name}`}
                {...(kit === undefined ? {} : { status: kit })}
              >
                <span className="truncate">{name}</span>
              </TabsTab>
            );
          })}
        </TabsList>
      </Tabs>
      <div className="flex shrink-0 items-center" data-testid="all-projects">
        <ProjectMenu />
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
          <MenuItem onClick={() => menu && void activation.closeTab(menu.name)}>Close</MenuItem>
          <MenuItem onClick={() => void activation.closeAllTabs()}>Close all tabs</MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => menu && project("rename", menu.name)}>Rename project</MenuItem>
          <MenuItem variant="destructive" onClick={() => menu && project("delete", menu.name)}>Delete project</MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
};
