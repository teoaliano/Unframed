import type { ProjectActivity } from "@unframed/contracts";
import { statusOf, tabWidth, type TabActivity, type TabStatus } from "@unframed/domain";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useEngine, useActivation } from "../context.ts";
import { useTabState } from "../project/activation.ts";
import { ProjectMenu } from "./ProjectMenu.tsx";
import { Button } from "~/components/ui/button";
import { Tip } from "./ui.tsx";

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

/** The status slot: a dot for waiting or working (the chat tabs' live dot, spec 08), a check for finished unseen. */
const StatusSlot = ({ status }: { readonly status: TabStatus }) => {
  if (status === "none") return <span className="size-3.5 shrink-0" aria-hidden />;
  if (status === "finished")
    return (
      <span data-testid="tab-finished" aria-label={STATUS_LABEL[status]} className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path d="M2 6.5 4.5 9 10 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  return (
    <span
      data-testid={status === "needs-you" ? "tab-needs-you" : "tab-running"}
      aria-label={STATUS_LABEL[status]}
      className={
        status === "needs-you"
          ? "size-2 shrink-0 rounded-full bg-highlight ring-2 ring-highlight/30"
          : "size-1.5 shrink-0 rounded-full bg-highlight"
      }
    />
  );
};

/**
 * The project tab strip (spec 17): an opaque muted strip with one rounded tab per open project,
 * and All projects at its end. It reads the tab state and the activity; it never touches the canvas.
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

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>, name: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void activation.activate(name);
    }
  };

  return (
    <div
      className="unframed-tabs box-border flex h-11 min-w-0 items-center gap-1 rounded-3xl bg-muted p-1"
      style={{ left, right }}
      data-testid="tab-strip"
    >
      <div
        ref={scroller}
        role="tablist"
        aria-label="Open projects"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {order.map((name) => {
          const isActive = name === active;
          const status = statusOf(activity.get(name), marks.has(name));
          return (
            <div
              key={name}
              role="tab"
              data-slot="project-tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              data-project={name}
              data-active={isActive ? "true" : undefined}
              data-status={status}
              title={[name, STATUS_LABEL[status]].filter(Boolean).join(" · ")}
              style={{ width }}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", name);
                event.dataTransfer.effectAllowed = "move";
                setDragging(name);
              }}
              onDragOver={(event) => {
                if (dragging !== undefined && dragging !== name) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== undefined && dragging !== name) activation.moveTab(dragging, order.indexOf(name));
                setDragging(undefined);
              }}
              onDragEnd={() => setDragging(undefined)}
              onClick={() => void activation.activate(name)}
              onKeyDown={(event) => onTabKey(event, name)}
              onAuxClick={(event: MouseEvent) => {
                if (event.button === 1) void activation.closeTab(name);
              }}
              className={`flex h-9 shrink-0 cursor-default items-center gap-2 rounded-xl border px-2.5 text-sm ${
                isActive
                  ? "border-border bg-card text-foreground shadow-xs"
                  : "border-transparent text-muted-foreground hover:bg-background/40 hover:text-foreground"
              }`}
            >
              <StatusSlot status={status} />
              <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
              <Tip label={`Close ${name}`} side="bottom">
                <Button
                  variant="ghost-muted"
                  size="icon-micro"
                  aria-label={`Close ${name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void activation.closeTab(name);
                  }}
                >
                  <X aria-hidden />
                </Button>
              </Tip>
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center" data-testid="all-projects">
        <ProjectMenu />
      </div>
    </div>
  );
};
