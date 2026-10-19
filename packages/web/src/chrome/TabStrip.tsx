import type { ProjectActivity } from "@unframed/contracts";
import { statusOf, tabWidth, type TabActivity, type TabStatus } from "@unframed/domain";
import { useEffect, useRef, useState, type ComponentProps, type DragEvent, type MouseEvent } from "react";
import { X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tabs, TabsList, TabsTab } from "~/components/ui/tabs";
import { useEngine, useActivation } from "../context.ts";
import { useTabState } from "../project/activation.ts";
import { ProjectMenu } from "./ProjectMenu.tsx";

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
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const measure = () => setAvailable(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (active === undefined) return;
    scroller.current?.querySelector<HTMLElement>(`[data-project="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const width = tabWidth(available - MENU_SPACE, order.length);
  // Drag a tab onto another to take its place (spec 17); Alt+arrow does the same from the keyboard.
  const [dragging, setDragging] = useState<string>();

  /** The tab an event landed on, by its project name. */
  const tabOf = (target: EventTarget): string | undefined => {
    if (!(target instanceof Element)) return undefined;
    return target.closest<HTMLElement>("[data-project]")?.dataset.project;
  };

  // Close, drag and middle-click sit on the list, not on each tab: a handler per tab adds listeners the budget counts (spec 17).
  const onListClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element) || event.target.closest("[data-close]") === null) return;
    const name = tabOf(event.target);
    if (name !== undefined) void activation.closeTab(name);
  };
  const onListAux = (event: MouseEvent<HTMLDivElement>) => {
    const name = tabOf(event.target);
    if (name !== undefined && event.button === 1) void activation.closeTab(name);
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

  return (
    <div className="unframed-tabs box-border flex h-11 min-w-0 items-center gap-2 bg-background px-1" style={{ left, right }} data-testid="tab-strip">
      <Tabs className="min-w-0 flex-1" value={active ?? null} onValueChange={(name) => void activation.activate(String(name))}>
        <TabsList
          ref={scroller}
          aria-label="Open projects"
          variant="underline"
          overflow="scroll"
          className="h-full min-w-0 flex-1"
          onClick={onListClick}
          onAuxClick={onListAux}
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
              <span key={name} data-project={name} className="relative inline-flex shrink-0">
                <TabsTab
                  value={name}
                  data-project={name}
                  data-active={isActive ? "true" : undefined}
                  data-status={status}
                  title={[name, STATUS_LABEL[status]].filter(Boolean).join(" · ")}
                  style={{ width }}
                  draggable
                  {...(kit === undefined ? {} : { status: kit })}
                >
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                </TabsTab>
                {/* The close sits beside the tab, as the kit lays out a closable tab. One delegated click on the list handles it. */}
                <Button variant="ghost-muted" size="icon-micro" aria-label={`Close ${name}`} title={`Close ${name}`} data-close="" className="absolute end-1 top-1/2 -translate-y-1/2">
                  <X aria-hidden />
                </Button>
              </span>
            );
          })}
        </TabsList>
      </Tabs>
      <div className="flex shrink-0 items-center" data-testid="all-projects">
        <ProjectMenu />
      </div>
    </div>
  );
};
