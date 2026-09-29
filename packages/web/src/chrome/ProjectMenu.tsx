import { UnframedError } from "@unframed/contracts";
import { projectSlug } from "@unframed/domain";
import { Check, ChevronDown, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Dialog, DialogClose, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuTrigger } from "~/components/ui/menu";
import { useActivation, useEngine } from "../context.ts";
import { reportState, useReportState } from "../legacy/reportState.ts";
import { useActiveProject } from "../project/activation.ts";
import { showError } from "../toasts.tsx";
import { Tip } from "./ui.tsx";

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
    <Dialog open={open} onOpenChange={close}>
      {/* The popup is the form, so its header, panel and footer stay the popup's own column. */}
      <DialogPopup className="max-w-[360px]" render={<form onSubmit={onSubmit} />}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Project name</span>
            <Input
              autoFocus
              placeholder="e.g. product-shots"
              value={name}
              aria-invalid={problem !== undefined || undefined}
              onChange={(event) => {
                setName(event.target.value);
                setProblem(undefined);
              }}
            />
          </label>
          {problem !== undefined && (
            <p role="alert" className="m-0 text-sm text-destructive-foreground">
              {problem}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button type="submit" disabled={busy}>
            {action}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

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
  <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
    <AlertDialogPopup className="max-w-[400px]">
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
        <Button variant="destructive" disabled={busy} onClick={onConfirm}>
          {action}
        </Button>
      </AlertDialogFooter>
    </AlertDialogPopup>
  </AlertDialog>
);

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
      <Menu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (open) void refresh();
        }}
      >
        <MenuTrigger aria-label="Project" render={<Button variant="ghost" size="lg" />}>
          <span data-testid="active-project">{active ?? ""}</span>
          <ChevronDown aria-hidden />
        </MenuTrigger>
        <MenuPopup sideOffset={8} align="start" className="min-w-[220px]">
          {/* The current project is the kit's checked radio item: its check and its tint. */}
          <MenuRadioGroup value={active ?? ""}>
            {projects.map((project) => (
              <MenuRadioItem key={project} value={project} closeOnClick data-active={project === active ? "true" : undefined} onClick={() => void activation.activate(project)}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <MenuRadioItemIndicator>
                      <Check aria-label="Active" />
                    </MenuRadioItemIndicator>
                  </span>
                  <span className="min-w-0 flex-1 truncate">{project}</span>
                  <span className="ml-3 flex items-center gap-0.5">
                    <Tip label="Rename" side="top">
                      <Button variant="ghost-muted" size="icon-micro" aria-label={`Rename ${project}`} onClick={(event) => rowAction(event, () => setRenaming(project))}>
                        <Pencil aria-hidden />
                      </Button>
                    </Tip>
                    <Tip label="Delete" side="top">
                      <Button variant="ghost-destructive" size="icon-micro" aria-label={`Delete ${project}`} onClick={(event) => rowAction(event, () => setDeleting({ project }))}>
                        <Trash2 aria-hidden />
                      </Button>
                    </Tip>
                  </span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          {imported.project === active && imported.report !== null && (
            <MenuItem onClick={() => reportState.open()}>
              <FileText aria-hidden />
              Import report
            </MenuItem>
          )}
          <MenuItem onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            Add project
          </MenuItem>
        </MenuPopup>
      </Menu>
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
