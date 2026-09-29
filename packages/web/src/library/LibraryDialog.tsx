import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Select } from "@base-ui/react/select";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { UnframedError } from "@unframed/contracts";
import { changeLibrary, libraryRange, libraryView, type LibraryControls, type LibrarySort, type Preset } from "@unframed/domain";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Group, Image, LayoutGrid, List, Package, Search, SquarePlay, Trash2, Type, UserRound, Workflow, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Tip } from "../chrome/ui.tsx";
import { useEngine } from "../context.ts";
import { showError } from "../toasts.tsx";
import { builtInPresets } from "./systemPresets.ts";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

export const DELETE_FAILED_MESSAGE = "Could not delete that preset. Is the local server running?";
export const EMPTY_LIBRARY_MESSAGE = "Nothing here yet. Try another category or clear the search.";
const VIEW_PREFERENCE = "library.view";

type View = "card" | "list";

const SORTS: ReadonlyArray<{ readonly value: LibrarySort; readonly label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "az", label: "A–Z" },
  { value: "za", label: "Z–A" },
];

type Hue = "purple" | "blue" | "teal" | "orange" | "cyan" | "green" | "pink";

const CHIPS: Record<string, { readonly label: string; readonly Icon: LucideIcon; readonly hue: Hue }> = {
  recipe: { label: "Recipe", Icon: Workflow, hue: "purple" },
  group: { label: "Group", Icon: Group, hue: "blue" },
  image: { label: "Image", Icon: Image, hue: "teal" },
  video: { label: "Video", Icon: SquarePlay, hue: "orange" },
  text: { label: "Text", Icon: Type, hue: "cyan" },
  user: { label: "Custom", Icon: UserRound, hue: "green" },
  system: { label: "System", Icon: Package, hue: "pink" },
};

/** What a preset is, what it makes (recipes only) and whose it is. */
const chipsOf = (preset: Preset): string[] => [preset.kind, ...(preset.kind === "recipe" && preset.medium ? [preset.medium] : []), preset.source];

const Chip = ({ kind }: { readonly kind: string }) => {
  const chip = CHIPS[kind]!;
  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded-inner border px-1.5 text-[11.5px]"
      data-chip={kind}
      style={{ backgroundColor: `var(--unframed-hue-${chip.hue}-bg)`, borderColor: `var(--unframed-hue-${chip.hue}-border)`, color: `var(--unframed-hue-${chip.hue}-text)` }}
    >
      <chip.Icon size={12} aria-hidden style={{ color: `var(--unframed-hue-${chip.hue}-icon)` }} />
      {chip.label}
    </span>
  );
};

const Chips = ({ preset }: { readonly preset: Preset }) => (
  <span className="flex flex-wrap items-center gap-1" data-testid="preset-chips">
    {chipsOf(preset).map((kind) => (
      <Chip key={kind} kind={kind} />
    ))}
  </span>
);

const smallButton = "inline-flex h-7 cursor-pointer items-center gap-1 rounded-element border border-line bg-transparent px-2.5 text-[12.5px] text-primary hover:bg-hover";
const iconButton = "flex size-7 cursor-pointer items-center justify-center rounded-inner border-0 bg-transparent p-0 text-icon-secondary hover:bg-hover hover:text-icon";
const toggleClass = "h-7 cursor-pointer rounded-inner border-0 bg-transparent px-2 text-[12.5px] text-secondary hover:text-primary data-[pressed]:bg-surface data-[pressed]:text-primary data-[pressed]:shadow-chrome";
const toggleGroupClass = "flex items-center gap-0.5 rounded-element bg-[var(--unframed-overlay-hover)] p-0.5";

const DeleteButton = ({ preset, onDelete }: { readonly preset: Preset; readonly onDelete: (preset: Preset) => void }) => (
  <Tip label="Delete from your library" side="top">
    <button type="button" aria-label={`Delete ${preset.name}`} className={iconButton} onClick={() => onDelete(preset)}>
      <Trash2 size={14} aria-hidden />
    </button>
  </Tip>
);

interface ItemProps {
  readonly preset: Preset;
  readonly onAdd: (preset: Preset) => void;
  readonly onDelete: (preset: Preset) => void;
}

const Card = ({ preset, onAdd, onDelete }: ItemProps) => (
  <li className="relative flex flex-col rounded-container border border-line bg-surface" data-testid="preset" data-preset={preset.id}>
    <div className="flex flex-1 flex-col gap-1.5 p-3 pr-9">
      <span className="text-[14px] font-medium" data-testid="preset-name">
        {preset.name}
      </span>
      {preset.summary !== "" && <span className="text-[12.5px] text-primary">{preset.summary}</span>}
      {preset.needs !== undefined && <span className="text-[12px] text-secondary" data-testid="preset-needs">{preset.needs}</span>}
      <Chips preset={preset} />
    </div>
    {preset.source === "user" && (
      <span className="absolute right-2 top-2">
        <DeleteButton preset={preset} onDelete={onDelete} />
      </span>
    )}
    <div className="flex justify-end border-t border-line px-3 py-2">
      <button type="button" className={smallButton} onClick={() => onAdd(preset)}>
        Add
      </button>
    </div>
  </li>
);

const Row = ({ preset, onAdd, onDelete }: ItemProps) => (
  <li className="flex items-start gap-3 border-b border-line py-2.5 last:border-b-0" data-testid="preset" data-preset={preset.id}>
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-medium" data-testid="preset-name">
          {preset.name}
        </span>
        <Chips preset={preset} />
      </span>
      {preset.summary !== "" && (
        <span className="line-clamp-3 text-[12.5px] text-secondary" title={preset.summary}>
          {preset.summary}
        </span>
      )}
    </div>
    <button type="button" className={smallButton} onClick={() => onAdd(preset)}>
      Add
    </button>
    {preset.source === "user" && <DeleteButton preset={preset} onDelete={onDelete} />}
  </li>
);

const Toggles = <T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: ReactNode; name?: string }>; onChange: (value: T) => void }) => (
  <ToggleGroup
    aria-label={label}
    className={toggleGroupClass}
    value={[value]}
    onValueChange={(next) => {
      const [picked] = next as T[];
      if (picked !== undefined) onChange(picked);
    }}
  >
    {options.map((option) => (
      <Toggle key={option.value} value={option.value} className={toggleClass} {...(option.name === undefined ? {} : { "aria-label": option.name })}>
        {option.label}
      </Toggle>
    ))}
  </ToggleGroup>
);

/** Reads the remembered view: list only when the preference says so; card when it is missing or cannot be read. */
const readView = async (engine: ReturnType<typeof useEngine>): Promise<View> => {
  try {
    const { values } = await engine.call("preferences.get", { keys: [VIEW_PREFERENCE] });
    return values[VIEW_PREFERENCE] === "list" ? "list" : "card";
  } catch {
    return "card";
  }
};

/**
 * The Library dialog: the user presets, read afresh every time it opens, then the system
 * presets; searched, filtered, sorted and cut into pages by the domain's library view.
 */
export const LibraryDialog = ({ onClose, onAdd }: { readonly onClose: () => void; readonly onAdd: (preset: Preset) => void }) => {
  const engine = useEngine();
  const [presets, setPresets] = useState<ReadonlyArray<Preset>>([]);
  const [readFailure, setReadFailure] = useState<string>();
  const [controls, setControls] = useState<LibraryControls>({ query: "", type: "all", source: "any", sort: "newest", page: 1 });
  const [view, setView] = useState<View>("card");
  const [deleting, setDeleting] = useState<Preset>();
  // The list shows once the file has been read, so it never reorders under the pointer.
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const { presets: listed } = await engine.call("library.list");
      setPresets(listed as unknown as Preset[]);
      setReadFailure(undefined);
    } catch (error) {
      setPresets([]);
      setReadFailure(messageOf(error));
    } finally {
      setLoaded(true);
    }
  }, [engine]);

  useEffect(() => {
    void load();
    let live = true;
    void readView(engine).then((next) => live && setView(next));
    return () => {
      live = false;
    };
  }, [engine, load]);

  const change = (patch: Partial<LibraryControls>) => setControls((current) => changeLibrary(current, patch));
  const shown = libraryView([...presets, ...builtInPresets()], controls);

  const chooseView = (next: View) => {
    setView(next);
    void engine.call("preferences.set", { key: VIEW_PREFERENCE, value: next }).catch(() => undefined);
  };

  const confirmDelete = async (preset: Preset) => {
    setDeleting(undefined);
    try {
      await engine.call("library.delete", { id: preset.id });
    } catch {
      showError(DELETE_FAILED_MESSAGE);
    }
    await load();
  };

  const Item = view === "card" ? Card : Row;
  return (
    <>
      <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-[1300] bg-[var(--unframed-scrim)] backdrop-blur-[10px] backdrop-saturate-[160%]" />
          <Dialog.Popup
            data-testid="library"
            data-view={view}
            className="fixed left-1/2 top-1/2 z-[1301] flex max-h-[min(760px,calc(100vh-48px))] w-[680px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-container border border-line bg-popover p-5 text-primary shadow-popover outline-none"
          >
            <Dialog.Title className="m-0 text-[18px] font-semibold">Library</Dialog.Title>
            <div className="flex items-center gap-2">
              <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-element border border-line-strong bg-surface px-2.5">
                <Search size={14} aria-hidden className="text-secondary" />
                <span className="sr-only">Search presets</span>
                <input
                  autoFocus
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-[14px] text-primary outline-none"
                  placeholder="Search presets…"
                  value={controls.query}
                  onChange={(event) => change({ query: event.target.value })}
                />
              </label>
              <Select.Root items={SORTS} value={controls.sort} onValueChange={(value) => value && change({ sort: value as LibrarySort })}>
                <Select.Trigger aria-label="Sort" className="flex h-9 cursor-pointer items-center gap-1.5 rounded-element border border-line-strong bg-surface px-2.5 text-[13px] text-primary">
                  <Select.Value />
                  <ChevronDown size={14} aria-hidden />
                </Select.Trigger>
                <Select.Portal>
                  <Select.Positioner sideOffset={6} className="z-[1350]" alignItemWithTrigger={false}>
                    <Select.Popup className="min-w-[120px] rounded-container border border-line bg-popover p-1 text-[13px] text-primary shadow-popover outline-none">
                      {SORTS.map((sort) => (
                        <Select.Item key={sort.value} value={sort.value} className="flex h-8 cursor-default items-center gap-2 rounded-inner px-2 outline-none data-[highlighted]:bg-hover">
                          <Select.ItemIndicator className="flex size-4 items-center">
                            <Check size={13} aria-hidden />
                          </Select.ItemIndicator>
                          <Select.ItemText>{sort.label}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Positioner>
                </Select.Portal>
              </Select.Root>
              <Toggles<View>
                label="View"
                value={view}
                onChange={chooseView}
                options={[
                  { value: "card", name: "Cards", label: <LayoutGrid size={14} aria-hidden /> },
                  { value: "list", name: "List", label: <List size={14} aria-hidden /> },
                ]}
              />
            </div>
            <div className="flex items-center gap-2">
              <Toggles<LibraryControls["type"]>
                label="Type"
                value={controls.type}
                onChange={(type) => change({ type })}
                options={[
                  { value: "all", label: "All" },
                  { value: "recipe", label: "Recipes" },
                  { value: "group", label: "Groups" },
                ]}
              />
              <Toggles<LibraryControls["source"]>
                label="Source"
                value={controls.source}
                onChange={(source) => change({ source })}
                options={[
                  { value: "any", label: "Any" },
                  { value: "user", label: "Custom" },
                  { value: "system", label: "System" },
                ]}
              />
            </div>
            {readFailure !== undefined && (
              <p role="alert" className="m-0 text-[12.5px] text-error">
                Your presets could not be read: {readFailure}
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto" data-scrolls="true">
              {!loaded ? null : shown.items.length === 0 ? (
                <p className="m-0 py-8 text-center text-[13px] text-secondary">{EMPTY_LIBRARY_MESSAGE}</p>
              ) : (
                <ul className={view === "card" ? "m-0 grid list-none grid-cols-2 gap-2.5 p-0" : "m-0 list-none p-0"} aria-label="Presets">
                  {shown.items.map((preset) => (
                    <Item key={preset.id} preset={preset} onAdd={onAdd} onDelete={setDeleting} />
                  ))}
                </ul>
              )}
            </div>
            {loaded && shown.total > 10 && (
              <nav className="flex items-center justify-end gap-1 text-[12.5px] text-secondary" aria-label="Pages">
                <span data-testid="library-range">{libraryRange(shown)}</span>
                <button type="button" aria-label="Previous page" className={iconButton} disabled={shown.page <= 1} onClick={() => change({ page: shown.page - 1 })}>
                  <ChevronLeft size={14} aria-hidden />
                </button>
                <button type="button" aria-label="Next page" className={iconButton} disabled={shown.page >= shown.pages} onClick={() => change({ page: shown.page + 1 })}>
                  <ChevronRight size={14} aria-hidden />
                </button>
              </nav>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <AlertDialog.Root open={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-[1400] bg-[var(--unframed-scrim)]" />
          <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-[1401] w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-container border border-line bg-popover p-5 text-primary shadow-popover outline-none">
            <AlertDialog.Title className="m-0 text-[16px] font-semibold">Delete preset?</AlertDialog.Title>
            <AlertDialog.Description className="m-0 mt-2 text-[13px] text-secondary">
              This removes “{deleting?.name}” from your library. Shapes already on the canvas are untouched. This can't be undone.
            </AlertDialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <AlertDialog.Close className="h-8 cursor-pointer rounded-element border border-line bg-transparent px-3 text-[13px] text-primary hover:bg-hover">Cancel</AlertDialog.Close>
              <button type="button" className="h-8 cursor-pointer rounded-element border-0 bg-[var(--unframed-error)] px-3 text-[13px] text-on-accent" onClick={() => deleting && void confirmDelete(deleting)}>
                Delete preset
              </button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
};
