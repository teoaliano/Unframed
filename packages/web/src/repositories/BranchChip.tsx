import type { GitAction, GitActionResult, Instance, InstanceDiff, ScreenShapeProps } from "@unframed/contracts";
import { branchChip, forkBranchName, SCREEN_GAP } from "@unframed/domain";
import { ChevronDown, GitBranch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createShapeId, useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup } from "~/components/ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { messageOf } from "../agent/store.ts";
import { Tip } from "../chrome/ui.tsx";
import { useCanvasProject, useEngine } from "../context.ts";
import { usePendingWork } from "./pendingWork.ts";
import { repositoryState } from "./store.ts";

type Panel = "fork" | "pick" | "changes" | "remove";

export const screenPropsOf = (editor: Editor, shapeId: TLShapeId): ScreenShapeProps | undefined => {
  const shape = editor.getShape(shapeId);
  return shape?.type === "screen" ? (shape.props as ScreenShapeProps) : undefined;
};

export const useScreenInstance = (shapeId: TLShapeId): Instance | undefined => {
  const editor = useEditor();
  const project = useCanvasProject();
  return useValue(
    "screen instance",
    () => {
      const props = screenPropsOf(editor, shapeId);
      return props === undefined ? undefined : repositoryState(project).instances.get().get(props.instance);
    },
    [editor, shapeId, project],
  );
};

export const placeScreenBeside = (editor: Editor, shapeId: TLShapeId, instance: Instance, mark: string, carry: "state" | "view" = "state"): TLShapeId | undefined => {
  const props = screenPropsOf(editor, shapeId);
  const bounds = editor.getShapePageBounds(shapeId);
  if (props === undefined || bounds === undefined) return undefined;
  const id = createShapeId();
  const { dials } = props;
  const { steps, mocks, state } = carry === "state" ? props : {};
  editor.markHistoryStoppingPoint(mark);
  editor.createShape({
    id,
    type: "screen",
    x: bounds.maxX + SCREEN_GAP,
    y: bounds.minY,
    props: {
      w: props.w,
      h: props.h,
      instance: instance.id,
      route: props.route,
      title: instance.branch,
      ...(steps === undefined ? {} : { steps }),
      ...(mocks === undefined ? {} : { mocks }),
      ...(state === undefined ? {} : { state }),
      ...(dials === undefined ? {} : { dials }),
    },
  });
  editor.select(id);
  return id;
};

const hintClass = "text-xs text-(--selection-toolbar-hint)";
const problemClass = "text-xs text-(--artifact-editor-error-foreground)";

const BranchPanel = ({ shapeId, instance, base, close }: { readonly shapeId: TLShapeId; readonly instance: Instance | undefined; readonly base: "fork" | "pick"; readonly close: () => void }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const [branches, setBranches] = useState<ReadonlyArray<string>>([]);
  const [from, setFrom] = useState("");
  const [name, setName] = useState("");
  const { busy, problem, setProblem, run } = usePendingWork();
  useEffect(() => {
    let live = true;
    engine.call("instances.branches", { project }).then(
      (answer) => {
        if (!live) return;
        setBranches(answer.branches);
        if (base === "fork") {
          setFrom(instance?.branch ?? answer.current);
          if (instance !== undefined) setName(forkBranchName(instance.branch, answer.branches));
        } else setFrom(answer.current);
      },
      (error: unknown) => live && setProblem(messageOf(error)),
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <form
      className="flex flex-col gap-2"
      aria-label={base === "fork" ? "New branch and worktree" : "Open another branch"}
      onSubmit={(event) => {
        event.preventDefault();
        if (from === "") return;
        run(async () => {
          const made = await engine.call("instances.create", { project, base: from, ...(name.trim() === "" ? {} : { branch: name.trim() }) });
          placeScreenBeside(editor, shapeId, made, "screen on a new branch", base === "fork" ? "state" : "view");
          close();
        });
      }}
    >
      {base === "pick" ? (
        <Select value={from} onValueChange={(value) => value && setFrom(value)}>
          <SelectTrigger aria-label="Base branch">
            <SelectValue>{from}</SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {branches.map((branch) => (
              <SelectItem key={branch} value={branch}>
                {branch}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : (
        <span className={hintClass}>{from === "" ? "" : `Copies ${from} as it is now onto a new branch, in its own worktree with its own dev server.`}</span>
      )}
      <Input aria-label="Branch name" placeholder={base === "pick" ? "A new branch, named for you" : undefined} value={name} autoFocus onChange={(event) => setName(event.target.value)} />
      {base === "pick" && <span className={hintClass}>Starts a new worktree with its own dev server.</span>}
      {problem !== undefined && <span className={problemClass}>{problem}</span>}
      <Button type="submit" size="sm" className="self-end" disabled={busy || from === ""}>
        {base === "fork" ? "Create branch" : "Open branch"}
      </Button>
    </form>
  );
};

const GIT_ACTION_LABELS: ReadonlyArray<readonly [GitAction, string]> = [
  ["commit", "Commit"],
  ["commit_push", "Commit and push"],
  ["commit_push_pr", "Commit, push and open PR"],
];

const gitActionSummary = (result: GitActionResult): string =>
  [
    result.commit === null ? undefined : `Committed "${result.commit.subject}".`,
    result.push === null ? undefined : `Pushed to ${result.push.remote}/${result.push.branch}.`,
    result.pr === null ? undefined : `${result.pr.existing ? "Pull request" : "Opened pull request"} #${result.pr.number} is open.`,
  ]
    .filter((line) => line !== undefined)
    .join(" ");

const ChangesPanel = ({ instance }: { readonly instance: Instance }) => {
  const engine = useEngine();
  const project = useCanvasProject();
  const [diff, setDiff] = useState<InstanceDiff | undefined>(undefined);
  const [result, setResult] = useState<GitActionResult | undefined>(undefined);
  const { busy, problem, setProblem, run } = usePendingWork();
  const load = async () => setDiff(await engine.call("instances.diff", { project, id: instance.id }));
  useEffect(() => {
    load().catch((error: unknown) => setProblem(messageOf(error)));
  }, []);
  const act = (action: GitAction) =>
    run(async () => {
      setResult(await engine.call("instances.gitAction", { project, id: instance.id, action }));
      await load();
    });
  return (
    <div className="flex flex-col gap-2" aria-label="Changes">
      {diff === undefined ? (
        problem === undefined && <span className={hintClass}>Reading changes…</span>
      ) : diff.files.length === 0 ? (
        <span className={hintClass}>No changes against {diff.baseRef}.</span>
      ) : (
        <ul className="flex max-h-60 flex-col gap-1 overflow-auto font-mono text-xs" aria-label="Changed files">
          {diff.files.map((file) => (
            <li key={file.path} className="flex justify-between gap-2" data-testid="changed-file">
              <span className="truncate">{file.path}</span>
              <span className="shrink-0 text-(--selection-toolbar-hint)">{file.binary ? "binary" : `+${file.additions} −${file.deletions}`}</span>
            </li>
          ))}
        </ul>
      )}
      {result !== undefined && (
        <span className="text-xs" data-testid="git-action-result">
          {gitActionSummary(result)}{" "}
          {result.pr !== null && (
            <a className="underline" href={result.pr.url} target="_blank" rel="noopener noreferrer">
              Open it
            </a>
          )}
        </span>
      )}
      {problem !== undefined && <span className={problemClass}>{problem}</span>}
      <div className="flex flex-wrap justify-end gap-2">
        {GIT_ACTION_LABELS.map(([action, label]) => (
          <Button key={action} type="button" variant={action === "commit" ? "default" : "outline"} size="sm" disabled={busy || diff === undefined} onClick={() => act(action)}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
};

const RemovePanel = ({ instance, close }: { readonly instance: Instance; readonly close: () => void }) => {
  const engine = useEngine();
  const project = useCanvasProject();
  const [refused, setRefused] = useState(false);
  const { busy, problem, run } = usePendingWork();
  const remove = (force: boolean) =>
    run(async () => {
      try {
        await engine.call("instances.remove", { project, id: instance.id, deleteBranch: true, force });
        close();
      } catch (error) {
        setRefused(true);
        throw error;
      }
    });
  return (
    <div className="flex flex-col gap-2" aria-label="Remove branch and worktree">
      <span className="text-xs">
        Deletes the worktree at <span className="font-mono">{instance.worktree}</span> and the branch <span className="font-mono">{instance.branch}</span>.
      </span>
      {instance.changes > 0 && <span className={hintClass}>{`${instance.changes} changed ${instance.changes === 1 ? "file differs" : "files differ"} from ${instance.baseRef}; work that is not pushed is lost.`}</span>}
      {problem !== undefined && <span className={problemClass}>{problem}</span>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={close}>
          Keep it
        </Button>
        <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => remove(refused)}>
          {refused ? "Remove anyway" : "Remove"}
        </Button>
      </div>
    </div>
  );
};

export const BranchChip = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const chip = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<Panel | undefined>(undefined);
  const instance = useScreenInstance(shapeId);
  const title = useValue("screen title", () => screenPropsOf(editor, shapeId)?.title ?? "", [editor, shapeId]);
  const text = branchChip({ branch: instance?.branch ?? title, changes: instance?.changes ?? 0 });
  const gone = instance === undefined || instance.state === "removed";
  const close = () => setPanel(undefined);
  const anotherView = () => {
    if (instance !== undefined) placeScreenBeside(editor, shapeId, instance, "another view of a branch");
  };
  return (
    <>
      <Menu>
        <Tip label="Branch and worktree">
          <MenuTrigger render={<Button ref={chip} variant="outline" size="sm" aria-label={text.label} data-testid="screen-branch" />}>
            <GitBranch aria-hidden />
            <span className="max-w-40 truncate">{text.name}</span>
            {text.count !== undefined && (
              <Badge size="sm" variant="secondary" data-testid="screen-branch-changes">
                {text.count}
              </Badge>
            )}
            <ChevronDown aria-hidden className="opacity-72" />
          </MenuTrigger>
        </Tip>
        <MenuPopup align="start" className="min-w-64">
          <MenuItem disabled={gone} onClick={anotherView}>
            Another view of this branch
          </MenuItem>
          <MenuItem disabled={gone} onClick={() => setPanel("fork")}>
            New branch and worktree…
            <MenuShortcut>New worktree</MenuShortcut>
          </MenuItem>
          <MenuItem onClick={() => setPanel("pick")}>
            Open another branch…
            <MenuShortcut>New worktree</MenuShortcut>
          </MenuItem>
          <MenuSeparator />
          <MenuItem disabled={gone} onClick={() => setPanel("changes")}>
            {text.changes}
          </MenuItem>
          <MenuSeparator />
          <MenuItem variant="destructive" disabled={gone} onClick={() => setPanel("remove")}>
            Remove branch and worktree…
          </MenuItem>
        </MenuPopup>
      </Menu>
      <Popover open={panel !== undefined} onOpenChange={(open) => !open && close()}>
        <PopoverPopup anchor={chip} side="bottom" align="start" sideOffset={6} padding="compact" className="w-80" data-testid="screen-branch-panel">
          {(panel === "fork" || panel === "pick") && <BranchPanel key={panel} shapeId={shapeId} instance={instance} base={panel} close={close} />}
          {panel === "changes" && instance !== undefined && <ChangesPanel instance={instance} />}
          {panel === "remove" && instance !== undefined && <RemovePanel instance={instance} close={close} />}
        </PopoverPopup>
      </Popover>
    </>
  );
};
