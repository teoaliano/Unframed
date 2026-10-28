import type { ProjectActivity } from "@unframed/contracts";
import { statusOf, type TabActivity, type TabStatus } from "@unframed/domain";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TopBar, type TopBarRegion, type TopBarStatus, type TopBarTab } from "~/components/ui/top-bar";
import { useEngine, useActivation } from "../context.ts";
import { useTabState } from "../project/activation.ts";
import { ProjectMenu } from "./ProjectMenu.tsx";
import { PROJECT_ACTION, type ProjectActionDetail } from "./tabEvents.ts";

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

/** The kit's status mark for a tab (spec 17): a spinner while working, a check when finished unseen, a dot for a chat waiting on the person. */
const kitStatus = (status: TabStatus): TopBarStatus | undefined => {
  if (status === "running") return "running";
  if (status === "finished") return "finished";
  if (status === "needs-you") return "dot";
  return undefined;
};

/**
 * The project tab bar, wired to the activation and the activity stream (spec 17). It reads the tab
 * state and the activity; it never touches the canvas. The app passes the logo, Settings and its
 * hook regions; the bar itself is `components/ui/top-bar`.
 */
export const TabStrip = ({
  platform,
  controls,
  squareStart,
  logo,
  settings,
  regions,
}: {
  readonly platform: "macos" | "windows";
  readonly controls?: "stand-ins" | "space" | "none" | undefined;
  readonly squareStart?: boolean | undefined;
  readonly logo: ReactNode;
  readonly settings: ReactNode;
  readonly regions: { readonly frame?: TopBarRegion; readonly start?: TopBarRegion; readonly tabs?: TopBarRegion; readonly end?: TopBarRegion };
}) => {
  const activation = useActivation();
  const { active, order } = useTabState(activation);
  const activity = useProjectActivity();
  const marks = useFinishedMarks(activity, active);

  const tabs: TopBarTab[] = order.map((name) => {
    const status = statusOf(activity.get(name), marks.has(name));
    return { name, status: kitStatus(status), state: status, title: [name, STATUS_LABEL[status]].filter(Boolean).join(" · ") };
  });

  const project = (action: ProjectActionDetail["action"], name: string) => {
    window.dispatchEvent(new CustomEvent<ProjectActionDetail>(PROJECT_ACTION, { detail: { action, name } }));
  };

  return (
    <TopBar
      platform={platform}
      layout="fixed"
      controls={controls}
      squareStart={squareStart}
      tabs={tabs}
      active={active}
      logo={logo}
      settings={settings}
      regions={regions}
      newProject={
        <div data-testid="all-projects">
          <ProjectMenu />
        </div>
      }
      onActivate={(name) => void activation.activate(name)}
      onClose={(name) => void activation.closeTab(name)}
      onCloseAll={() => void activation.closeAllTabs()}
      onRename={(name) => project("rename", name)}
      onDelete={(name) => project("delete", name)}
      onMove={(name, to) => activation.moveTab(name, to)}
    />
  );
};
