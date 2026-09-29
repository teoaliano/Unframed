import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { UnframedError } from "@unframed/contracts";
import { projectSlug } from "@unframed/domain";
import { Check, ChevronDown, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { useActivation, useEngine } from "../context.ts";
import { reportState, useReportState } from "../legacy/reportState.ts";
import { useActiveProject } from "../project/activation.ts";
import { showError } from "../toasts.tsx";
import { itemClass, popupClass, Tip } from "./ui.tsx";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

/** Answers the problem to show on the field, or nothing once it is done (having closed the dialog when it should). */
type SubmitName = (name: string, slug: string, close: () => void) => Promise<string | undefined>;

/**
 * The one project name dialog: "New project" (spec 02) and "Rename project" (spec 10), so
 * the two never disagree about what a valid name is. The name is slugged; an empty slug is refused here.
 */
const ProjectNameDialog = ({
  open,
  onOpenChange,
  title,
  action,
  initial,
  submit,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly action: string;
  readonly initial: string;
  readonly submit: SubmitName;
}) => {
  const [name, setName] = useState(initial);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);

  const close = (next: boolean) => {
    if (!next) {
      setName("");
      setProblem(undefined);
    }
    onOpenChange(next);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const slug = projectSlug(name);
    if (slug === "") return setProblem("Enter a project name.");
    setBusy(true);
    try {
      const found = await submit(name, slug, () => close(false));
      if (found !== undefined) setProblem(found);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[900] bg-[var(--unframed-scrim)] backdrop-blur-[10px] backdrop-saturate-[160%]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-[901] w-[360px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-4 text-foreground shadow-lg outline-none">
          <Dialog.Title className="m-0 text-[15px] font-semibold">{title}</Dialog.Title>
          <form className="mt-3 flex flex-col gap-2" onSubmit={onSubmit}>
            <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
              Project name
              <input
                autoFocus
                className="h-9 rounded-lg border border-input bg-card px-2.5 text-[14px] text-foreground outline-none focus:border-primary"
                placeholder="e.g. product-shots"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setProblem(undefined);
                }}
              />
            </label>
            {problem !== undefined && (
              <p role="alert" className="m-0 text-[12px] text-destructive-foreground">
                {problem}
              </p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Dialog.Close className="h-8 cursor-pointer rounded-lg border border-border bg-transparent px-3 text-[13px] text-foreground hover:bg-accent">
                Cancel
              </Dialog.Close>
              <button type="submit" className="h-8 cursor-pointer rounded-lg border-0 bg-primary px-3 text-[13px] text-primary-foreground" disabled={busy}>
                {action}
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

const alertButton = "h-8 cursor-pointer rounded-lg px-3 text-[13px]";

/** A destructive confirm: title, description, Cancel and the action. */
const Confirm = ({
  open,
  title,
  description,
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly action: string;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) => (
  <AlertDialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className="fixed inset-0 z-[900] bg-[var(--unframed-scrim)]" />
      <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-[901] w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-5 text-foreground shadow-lg outline-none">
        <AlertDialog.Title className="m-0 text-[16px] font-semibold">{title}</AlertDialog.Title>
        <AlertDialog.Description className="m-0 mt-2 text-[13px] text-muted-foreground">{description}</AlertDialog.Description>
        <div className="mt-4 flex justify-end gap-2">
          <AlertDialog.Close className={`${alertButton} border border-border bg-transparent text-foreground hover:bg-accent`}>Cancel</AlertDialog.Close>
          <button type="button" className={`${alertButton} border-0 bg-destructive text-primary-foreground`} disabled={busy} onClick={onConfirm}>
            {action}
          </button>
        </div>
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  </AlertDialog.Root>
);

const rowButton =
  "flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

type Deleting = { readonly project: string; readonly pendingRenders?: number };

/** The project menu: every project with Rename and Delete, a check on the active one, and "Add project" last. */
export const ProjectMenu = () => {
  const engine = useEngine();
  const activation = useActivation();
  const active = useActiveProject(activation);
  const [projects, setProjects] = useState<ReadonlyArray<string>>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string>();
  const [deleting, setDeleting] = useState<Deleting>();
  const [busy, setBusy] = useState(false);
  const imported = useReportState();

  const refresh = () =>
    engine.call("projects.list").then(
      (answer) => {
        setProjects(answer.projects);
        return answer.projects;
      },
      (error: unknown) => {
        showError(`Could not list your projects: ${messageOf(error)}. Reload to try again.`);
        return undefined;
      },
    );

  useEffect(() => {
    if (active !== undefined) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const create: SubmitName = async (name, slug, close) => {
    try {
      const { projects: listed } = await engine.call("projects.list");
      if (listed.includes(slug)) return `A project named “${slug}” already exists.`;
      const created = await engine.call("projects.create", { name });
      close();
      await activation.activate(created.name);
    } catch (error) {
      if (error instanceof UnframedError && error.code === "conflict") return `A project named “${slug}” already exists.`;
      if (error instanceof UnframedError && error.code === "bad_request") return error.message;
      showError(`Could not open “${slug}”: ${messageOf(error)}`);
    }
    return undefined;
  };

  const rename: SubmitName = async (name, slug, close) => {
    const from = renaming;
    if (from === undefined) return undefined;
    if (slug === from) {
      close();
      return undefined;
    }
    try {
      // The open canvas's edits reach the engine before its room closes for the rename.
      if (from === active) await activation.settle();
      const renamed = await engine.call("projects.rename", { name: from, to: name });
      close();
      setProjects((current) => [...current.map((project) => (project === from ? renamed.name : project))].sort());
      if (from === active) await activation.activate(renamed.name);
    } catch (error) {
      return messageOf(error);
    }
    return undefined;
  };

  /**
   * After a delete: the project leaves the list; an active one gives way to the first left,
   * or a new `default`, mounted afresh since the new one may have the old one's name.
   */
  const deleted = async (project: string) => {
    setDeleting(undefined);
    setProjects((current) => current.filter((each) => each !== project));
    if (project === active) await activation.reopen();
    else await refresh();
  };

  const remove = async (confirmRenders: boolean) => {
    const target = deleting;
    if (target === undefined || busy) return;
    setBusy(true);
    try {
      await engine.call("projects.delete", { name: target.project, ...(confirmRenders ? { confirmRenders: true } : {}) });
      await deleted(target.project);
    } catch (error) {
      const pendingRenders = error instanceof UnframedError && error.code === "conflict" ? error.details?.pendingRenders : undefined;
      if (typeof pendingRenders === "number" && !confirmRenders) setDeleting({ project: target.project, pendingRenders });
      else {
        setDeleting(undefined);
        showError(messageOf(error));
      }
    } finally {
      setBusy(false);
    }
  };

  /** A row's own buttons act on that project without switching to it. */
  const rowAction = (event: MouseEvent, run: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(false);
    run();
  };

  const renders = deleting?.pendingRenders ?? 0;

  return (
    <>
      <Menu.Root
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (open) void refresh();
        }}
      >
        <Menu.Trigger
          aria-label="Project"
          className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent pl-2.5 pr-2 text-[15px] text-foreground hover:bg-accent data-[popup-open]:bg-accent"
        >
          <span data-testid="active-project">{active ?? ""}</span>
          <ChevronDown size={16} aria-hidden />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={8} align="start" className="z-[800]">
            <Menu.Popup className={`${popupClass} min-w-[220px]`}>
              {projects.map((project) => (
                <Menu.Item
                  key={project}
                  className={`${itemClass} group pr-1 ${project === active ? "bg-accent" : ""}`}
                  data-active={project === active ? "true" : undefined}
                  onClick={() => void activation.activate(project)}
                >
                  <span className="flex size-4 items-center justify-center">{project === active && <Check size={15} aria-label="Active" />}</span>
                  <span className="min-w-0 flex-1 truncate">{project}</span>
                  <span className="ml-3 flex items-center gap-0.5">
                    <Tip label="Rename" side="top">
                      <button type="button" aria-label={`Rename ${project}`} className={rowButton} onClick={(event) => rowAction(event, () => setRenaming(project))}>
                        <Pencil size={14} aria-hidden />
                      </button>
                    </Tip>
                    <Tip label="Delete" side="top">
                      <button type="button" aria-label={`Delete ${project}`} className={rowButton} onClick={(event) => rowAction(event, () => setDeleting({ project }))}>
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </Tip>
                  </span>
                </Menu.Item>
              ))}
              {imported.project === active && imported.report !== null && (
                <Menu.Item className={itemClass} onClick={() => reportState.open()}>
                  <span className="flex size-4 items-center justify-center">
                    <FileText size={15} aria-hidden />
                  </span>
                  Import report
                </Menu.Item>
              )}
              <Menu.Item className={itemClass} onClick={() => setCreating(true)}>
                <span className="flex size-4 items-center justify-center">
                  <Plus size={15} aria-hidden />
                </span>
                Add project
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <ProjectNameDialog open={creating} onOpenChange={setCreating} title="New project" action="Create" initial="" submit={create} />
      <ProjectNameDialog
        open={renaming !== undefined}
        onOpenChange={(open) => !open && setRenaming(undefined)}
        title="Rename project"
        action="Rename"
        initial={renaming ?? ""}
        submit={rename}
      />
      <Confirm
        open={deleting !== undefined && deleting.pendingRenders === undefined}
        title="Delete project?"
        description={`This permanently removes "${deleting?.project ?? ""}" and its generated images. This can't be undone.`}
        action="Delete project"
        busy={busy}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => void remove(false)}
      />
      <Confirm
        open={deleting?.pendingRenders !== undefined}
        title="Stop renders and delete?"
        description={`This stops tracking ${renders} video render${renders === 1 ? "" : "s"}. They may still complete upstream, but their results will not be saved here.`}
        action="Stop renders and delete"
        busy={busy}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => void remove(true)}
      />
    </>
  );
};
