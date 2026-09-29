import { UnframedError } from "@unframed/contracts";
import { changeLibrary, legacyPresetLine, libraryRange, libraryView, type LibraryControls, type LibrarySort, type Preset } from "@unframed/domain";
import { ChevronLeft, ChevronRight, Group, Image, LayoutGrid, List, Package, Search, SquarePlay, Trash2, Type, UserRound, Workflow, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Alert } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
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

/** Each kind's chip: its label, icon and the Tailwind palette hue its label Badge tints from. */
const CHIPS: Record<string, { readonly label: string; readonly Icon: LucideIcon; readonly hue: string }> = {
  recipe: { label: "Recipe", Icon: Workflow, hue: "var(--color-purple-500)" },
  group: { label: "Group", Icon: Group, hue: "var(--color-blue-500)" },
  image: { label: "Image", Icon: Image, hue: "var(--color-teal-500)" },
  video: { label: "Video", Icon: SquarePlay, hue: "var(--color-orange-500)" },
  text: { label: "Text", Icon: Type, hue: "var(--color-cyan-500)" },
  user: { label: "Custom", Icon: UserRound, hue: "var(--color-green-500)" },
  system: { label: "System", Icon: Package, hue: "var(--color-pink-500)" },
};

/** What a preset is, what it makes (recipes only) and whose it is. */
const chipsOf = (preset: Preset): string[] => [preset.kind, ...(preset.kind === "recipe" && preset.medium ? [preset.medium] : []), preset.source];

const Chip = ({ kind }: { readonly kind: string }) => {
  const chip = CHIPS[kind]!;
  return (
    <Badge variant="label" data-chip={kind} style={{ "--label": chip.hue } as CSSProperties}>
      <chip.Icon aria-hidden />
      {chip.label}
    </Badge>
  );
};

const Chips = ({ preset }: { readonly preset: Preset }) => (
  <span className="flex flex-wrap items-center gap-1" data-testid="preset-chips">
    {chipsOf(preset).map((kind) => (
      <Chip key={kind} kind={kind} />
    ))}
  </span>
);

/** Under a converted old preset's summary (spec 11): where it came from and what it lost. */
const LegacyLine = ({ preset }: { readonly preset: Preset }) =>
  preset.legacy ? (
    <span className="text-xs text-muted-foreground" data-testid="preset-legacy">
      {legacyPresetLine(preset.notes ?? [])}
    </span>
  ) : null;

const DeleteButton = ({ preset, onDelete }: { readonly preset: Preset; readonly onDelete: (preset: Preset) => void }) => (
  <Tip label="Delete from your library" side="top">
    <Button variant="ghost-destructive" size="icon-xs" aria-label={`Delete ${preset.name}`} onClick={() => onDelete(preset)}>
      <Trash2 aria-hidden />
    </Button>
  </Tip>
);

interface ItemProps {
  readonly preset: Preset;
  readonly onAdd: (preset: Preset) => void;
  readonly onDelete: (preset: Preset) => void;
}

const Card = ({ preset, onAdd, onDelete }: ItemProps) => (
  <li className="relative flex flex-col rounded-xl border bg-card text-card-foreground shadow-xs/5" data-testid="preset" data-preset={preset.id}>
    <div className="flex flex-1 flex-col gap-1.5 p-3 pr-9">
      <span className="text-sm font-medium" data-testid="preset-name">
        {preset.name}
      </span>
      {preset.summary !== "" && <span className="text-xs">{preset.summary}</span>}
      <LegacyLine preset={preset} />
      {preset.needs !== undefined && (
        <span className="text-xs text-muted-foreground" data-testid="preset-needs">
          {preset.needs}
        </span>
      )}
      <Chips preset={preset} />
    </div>
    {preset.source === "user" && (
      <span className="absolute right-2 top-2">
        <DeleteButton preset={preset} onDelete={onDelete} />
      </span>
    )}
    <div className="flex justify-end border-t px-3 py-2">
      <Button variant="outline" size="xs" onClick={() => onAdd(preset)}>
        Add
      </Button>
    </div>
  </li>
);

const Row = ({ preset, onAdd, onDelete }: ItemProps) => (
  <li className="flex items-start gap-3 border-b py-2.5 last:border-b-0" data-testid="preset" data-preset={preset.id}>
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium" data-testid="preset-name">
          {preset.name}
        </span>
        <Chips preset={preset} />
      </span>
      {preset.summary !== "" && (
        <span className="line-clamp-3 text-xs text-muted-foreground" title={preset.summary}>
          {preset.summary}
        </span>
      )}
      <LegacyLine preset={preset} />
    </div>
    <Button variant="outline" size="xs" onClick={() => onAdd(preset)}>
      Add
    </Button>
    {preset.source === "user" && <DeleteButton preset={preset} onDelete={onDelete} />}
  </li>
);

const Toggles = <T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: ReactNode; name?: string }>; onChange: (value: T) => void }) => (
  <ToggleGroup
    aria-label={label}
    value={[value]}
    onValueChange={(next) => {
      const [picked] = next as T[];
      if (picked !== undefined) onChange(picked);
    }}
  >
    {options.map((option) => (
      <Toggle key={option.value} value={option.value} {...(option.name === undefined ? {} : { "aria-label": option.name })}>
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
  // The preset the delete confirm names; it stays set while the confirm animates out.
  const [deleting, setDeleting] = useState<Preset>();
  const [confirming, setConfirming] = useState(false);
  // The list shows once the file has been read, so it never reorders under the pointer.
  const [loaded, setLoaded] = useState(false);
  const search = useRef<HTMLInputElement>(null);

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

  const askDelete = (preset: Preset) => {
    setDeleting(preset);
    setConfirming(true);
  };

  const confirmDelete = async (preset: Preset) => {
    setConfirming(false);
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
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogPopup data-testid="library" data-view={view} className="max-h-[min(760px,calc(100vh-48px))] max-w-[680px]" initialFocus={search}>
          <DialogHeader>
            <DialogTitle>Library</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-6">
            <div className="flex items-center gap-2">
              <InputGroup className="min-w-0 flex-1">
                <InputGroupAddon>
                  <Search aria-hidden />
                </InputGroupAddon>
                <InputGroupInput ref={search} aria-label="Search presets" placeholder="Search presets…" value={controls.query} onChange={(event) => change({ query: event.target.value })} />
              </InputGroup>
              <Select items={SORTS} value={controls.sort} onValueChange={(value) => value && change({ sort: value as LibrarySort })}>
                <SelectTrigger aria-label="Sort" className="w-auto min-w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {SORTS.map((sort) => (
                    <SelectItem key={sort.value} value={sort.value}>
                      {sort.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Toggles<View>
                label="View"
                value={view}
                onChange={chooseView}
                options={[
                  { value: "card", name: "Cards", label: <LayoutGrid aria-hidden /> },
                  { value: "list", name: "List", label: <List aria-hidden /> },
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
            {readFailure !== undefined && <Alert variant="error">Your presets could not be read: {readFailure}</Alert>}
            <div className="min-h-0 flex-1 overflow-y-auto" data-scrolls="true">
              {!loaded ? null : shown.items.length === 0 ? (
                <p className="m-0 py-8 text-center text-sm text-muted-foreground">{EMPTY_LIBRARY_MESSAGE}</p>
              ) : (
                <ul className={view === "card" ? "m-0 grid list-none grid-cols-2 gap-2.5 p-0" : "m-0 list-none p-0"} aria-label="Presets">
                  {shown.items.map((preset) => (
                    <Item key={preset.id} preset={preset} onAdd={onAdd} onDelete={askDelete} />
                  ))}
                </ul>
              )}
            </div>
            {loaded && shown.pages > 1 && (
              <nav className="flex items-center justify-end gap-1 text-xs text-muted-foreground" aria-label="Pages">
                <span data-testid="library-range">{libraryRange(shown)}</span>
                <Button variant="ghost" size="icon-xs" aria-label="Previous page" disabled={shown.page <= 1} onClick={() => change({ page: shown.page - 1 })}>
                  <ChevronLeft aria-hidden />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label="Next page" disabled={shown.page >= shown.pages} onClick={() => change({ page: shown.page + 1 })}>
                  <ChevronRight aria-hidden />
                </Button>
              </nav>
            )}
          </div>
        </DialogPopup>
      </Dialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogPopup className="max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete preset?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes “{deleting?.name}” from your library. Shapes already on the canvas are untouched. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={() => deleting && void confirmDelete(deleting)}>
              Delete preset
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
};
