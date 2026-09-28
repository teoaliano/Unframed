import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { UnframedError } from "@unframed/contracts";
import { projectSlug } from "@unframed/domain";
import { Check, ChevronDown, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useActivation, useEngine } from "../context.ts";
import { useActiveProject } from "../project/activation.ts";
import { showError } from "../toasts.tsx";
import { itemClass, popupClass } from "./ui.tsx";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

/** "New project": a name, slugged; an empty slug or a taken one is refused in the dialog. */
const NewProjectDialog = ({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) => {
  const engine = useEngine();
  const activation = useActivation();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  const close = (next: boolean) => {
    if (!next) {
      setName("");
      setProblem(undefined);
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const slug = projectSlug(name);
    if (slug === "") return setProblem("Enter a project name.");
    setBusy(true);
    try {
      const { projects } = await engine.call("projects.list");
      if (projects.includes(slug)) return setProblem(`A project named “${slug}” already exists.`);
      const created = await engine.call("projects.create", { name });
      close(false);
      await activation.activate(created.name);
    } catch (error) {
      if (error instanceof UnframedError && error.code === "conflict") setProblem(`A project named “${slug}” already exists.`);
      else if (error instanceof UnframedError && error.code === "bad_request") setProblem(error.message);
      else showError(`Could not open “${slug}”: ${messageOf(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[900] bg-[var(--unframed-scrim)] backdrop-blur-[10px] backdrop-saturate-[160%]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-[901] w-[360px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-container border border-line bg-popover p-4 text-primary shadow-popover outline-none">
          <Dialog.Title className="m-0 text-[15px] font-semibold">New project</Dialog.Title>
          <form className="mt-3 flex flex-col gap-2" onSubmit={submit}>
            <label className="flex flex-col gap-1 text-[12px] text-secondary">
              Project name
              <input
                autoFocus
                className="h-9 rounded-element border border-line-strong bg-surface px-2.5 text-[14px] text-primary outline-none focus:border-accent"
                placeholder="e.g. product-shots"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setProblem(undefined);
                }}
              />
            </label>
            {problem !== undefined && (
              <p role="alert" className="m-0 text-[12px] text-error">
                {problem}
              </p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Dialog.Close className="h-8 cursor-pointer rounded-element border border-line bg-transparent px-3 text-[13px] text-primary hover:bg-hover">
                Cancel
              </Dialog.Close>
              <button type="submit" className="h-8 cursor-pointer rounded-element border-0 bg-accent px-3 text-[13px] text-on-accent" disabled={busy}>
                Create
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

/** The project menu: every project, a check on the active one, and "Add project" last. */
export const ProjectMenu = () => {
  const engine = useEngine();
  const activation = useActivation();
  const active = useActiveProject(activation);
  const [projects, setProjects] = useState<ReadonlyArray<string>>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = () =>
    engine.call("projects.list").then(
      (answer) => setProjects(answer.projects),
      (error: unknown) => showError(`Could not list your projects: ${messageOf(error)}`),
    );

  useEffect(() => {
    if (active !== undefined) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <>
      <Menu.Root onOpenChange={(open) => void (open && refresh())}>
        <Menu.Trigger
          aria-label="Project"
          className="flex h-9 cursor-pointer items-center gap-1.5 rounded-element border-0 bg-transparent pl-2.5 pr-2 text-[15px] text-primary hover:bg-hover data-[popup-open]:bg-hover"
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
                  className={`${itemClass} ${project === active ? "bg-hover" : ""}`}
                  data-active={project === active ? "true" : undefined}
                  onClick={() => void activation.activate(project)}
                >
                  <span className="flex size-4 items-center justify-center">{project === active && <Check size={15} aria-label="Active" />}</span>
                  {project}
                </Menu.Item>
              ))}
              <Menu.Item className={itemClass} onClick={() => setDialogOpen(true)}>
                <span className="flex size-4 items-center justify-center">
                  <Plus size={15} aria-hidden />
                </span>
                Add project
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
};
