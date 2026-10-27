import { applyKitOps, type KitOp, type KitPreset } from "@unframed/domain";
import { useEffect, useRef, useState } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { EllipsisIcon } from "lucide-react";
import { AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle } from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuSub, MenuSubPopup, MenuSubTrigger, MenuTrigger } from "~/components/ui/menu";
import type { KitExportFormat } from "@unframed/contracts";
import { useCanvasProject, useEngine } from "../context.ts";
import { KitTable, type KitUsageCounts } from "./KitTable.tsx";
import { commitKit, kitOf, linkKit } from "./kitRoom.ts";
import { libraryKitById, linkFor, SaveKitDialog, updateInLibrary } from "./KitLibrary.tsx";
import { hasDifferences, mergeWith } from "./KitApply.tsx";
import { kitUi } from "./state.ts";
import { ImportKitDialog } from "./KitImport.tsx";
import { showError, showReveal } from "../toasts.tsx";

export const NO_KIT_MESSAGE = "This project has no kit yet. A kit holds the colours, sizes, fonts and motion values its pages and motions share.";
export const DEFAULT_KIT_NAME = "Kit";

/** What the confirm dialog is asking about, if anything. */
type Ask = { readonly kind: "token"; readonly path: string } | { readonly kind: "mode"; readonly mode: string } | { readonly kind: "kit" };

const NO_USE = { tokens: {}, modes: {} } as KitUsageCounts;

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** The Kit dialog (spec 19): the empty state, or the kit's name, the table, and its menu. */
export const KitDialog = ({ onClose, onFromLibrary }: { readonly onClose: () => void; readonly onFromLibrary: () => void }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const kit = useValue("kit", () => kitOf(editor), [editor]);
  const [problem, setProblem] = useState<string>();
  const [usage, setUsage] = useState<KitUsageCounts>(NO_USE);
  const [ask, setAsk] = useState<Ask>();
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  // The library kit this project came from: undefined while it is read, null when it is gone.
  const [linkedPreset, setLinkedPreset] = useState<KitPreset | null>();
  // The engine refused Update in library because the library kit is newer; the dialog offers Update from kit.
  const [newer, setNewer] = useState<string>();
  const fromId = kit?.from?.presetId;
  const fromRevision = kit?.from?.revision;

  // Used-by counts are read when the dialog opens and after each kit change (spec 19).
  useEffect(() => {
    if (kit === null) return;
    engine
      .call("kit.usage", { project })
      .then((answer) => setUsage(answer))
      .catch(() => setUsage(NO_USE));
  }, [engine, project, kit]);

  /** Commits ops as one undo step. Returns the refusal, so a field can show it under itself. */
  const apply = (ops: ReadonlyArray<KitOp>): string | undefined => {
    const result = commitKit(editor, ops);
    setProblem(result.ok ? undefined : result.refusal);
    return result.ok ? undefined : result.refusal;
  };

  /** After a save or an update, the project's link says which library kit it matches, as it is now. */
  const relink = (presetId: string, revision: number) => {
    const current = kitOf(editor);
    if (current !== null) linkKit(editor, linkFor(presetId, revision, current));
  };

  // The library kit a project came from is read when the dialog opens and after each update.
  useEffect(() => {
    if (fromId === undefined) return;
    let live = true;
    libraryKitById(engine, fromId)
      .then((found) => live && setLinkedPreset(found ?? null))
      .catch(() => live && setLinkedPreset(undefined));
    return () => {
      live = false;
    };
  }, [engine, fromId, fromRevision]);

  const update = async () => {
    const outcome = await updateInLibrary(engine, project);
    if (outcome.kind === "updated") {
      setNewer(undefined);
      relink(outcome.presetId, outcome.revision);
    } else if (outcome.kind === "newer") setNewer(outcome.message);
  };

  /** Opens Update from kit for the library kit this project came from. */
  const updateFromKit = async () => {
    if (kit?.from === undefined) return;
    const found = await libraryKitById(engine, kit.from.presetId);
    if (found !== undefined) kitUi(editor).update((state) => ({ ...state, merging: found }));
  };

  /** The source line: the library kit it came from, the offer of Update from kit, or that the library kit is gone. */
  const sourceLine = () => {
    if (kit === null || kit.from === undefined || linkedPreset === undefined) return null;
    if (linkedPreset === null)
      return <p className="m-0 text-sm text-muted-foreground">{`The library kit “${kit.name}” is gone. This project keeps its copy.`}</p>;
    const offer = linkedPreset.revision > kit.from.revision && hasDifferences(mergeWith(kit, linkedPreset), kit);
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{`From “${linkedPreset.name}” in your library.`}</span>
        {offer && (
          <Button variant="ghost" size="sm" onClick={() => void updateFromKit()}>
            Update from kit
          </Button>
        )}
      </div>
    );
  };


  /** Export writes the kit into the project folder; the toast offers to reveal the file. */
  const exportKit = (format: KitExportFormat) => {
    engine
      .call("kit.exportFile", { project, format })
      .then(({ file }) => showReveal(`Saved ${file} in the project folder.`, () => void engine.call("files.reveal", { project, fileNames: [file] })))
      .catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
  };

  const titleOf = (id: string) => (editor.getShape(id as TLShapeId) as { props?: { title?: string } } | undefined)?.props?.title ?? id;

  const confirmDelete = () => {
    if (ask === undefined) return;
    if (ask.kind === "token") apply([{ op: "deleteToken", path: ask.path }]);
    else if (ask.kind === "mode") apply([{ op: "deleteMode", name: ask.mode }]);
    else commitKit(editor, [{ op: "remove" }]);
    setAsk(undefined);
  };

  const tokenUses = ask?.kind === "token" ? (usage.tokens[ask.path] ?? []).length : 0;
  const modeUses = ask?.kind === "mode" ? (usage.modes[ask.mode] ?? []).length : 0;
  const defaultMode = kit?.modes[0] ?? "";

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogPopup data-testid="kit" className="max-w-[960px]">
          <DialogHeader>
            <DialogTitle>Kit</DialogTitle>
            {kit !== null && (
              <KitMenu
                linked={kit.from !== undefined && linkedPreset !== null}
                onSave={() => setSaving(true)}
                onUpdate={() => void update()}
                onImport={() => setImporting(true)}
                onExport={exportKit}
                onDelete={() => setAsk({ kind: "kit" })}
              />
            )}
          </DialogHeader>
          <DialogPanel>
            {kit === null ? (
              <div className="grid gap-4">
                <p className="text-sm text-muted-foreground">{NO_KIT_MESSAGE}</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => apply([{ op: "create", name: DEFAULT_KIT_NAME, modes: ["default"] }])}>New kit</Button>
                  <Button variant="outline" onClick={onFromLibrary}>
                    From library
                  </Button>
                  <Button variant="outline" onClick={() => setImporting(true)}>
                    Import
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-4">
                {sourceLine()}
                {newer !== undefined && (
                  <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-sm text-destructive">
                    {newer}
                    <Button variant="outline" size="sm" onClick={() => void updateFromKit()}>
                      Update from kit
                    </Button>
                  </p>
                )}
                <Input
                  key={kit.name}
                  aria-label="Kit name"
                  defaultValue={kit.name}
                  onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                  onBlur={(event) => event.currentTarget.value !== kit.name && apply([{ op: "rename", name: event.currentTarget.value }])}
                />
                <KitTable kit={kit} usage={usage} apply={apply} titleOf={titleOf} onAskDeleteToken={(path) => setAsk({ kind: "token", path })} onAskDeleteMode={(mode) => setAsk({ kind: "mode", mode })} />
              </div>
            )}
            {problem !== undefined && (
              <p role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            )}
          </DialogPanel>
        </DialogPopup>
      </Dialog>

      {saving && kit !== null && <SaveKitDialog kit={kit} onClose={() => setSaving(false)} onSaved={(presetId, revision) => { relink(presetId, revision); setSaving(false); }} />}

      {importing && (
        <ImportKitDialog
          kit={kit}
          onClose={() => setImporting(false)}
        />
      )}

      <AlertDialog open={ask !== undefined} onOpenChange={(open) => !open && setAsk(undefined)}>
        <AlertDialogPopup className="max-w-[400px]">
          <AlertDialogHeader>
            {ask?.kind === "token" && (
              <>
                <AlertDialogTitle>Delete {ask.path}?</AlertDialogTitle>
                <AlertDialogDescription>{tokenUses > 0 ? `${tokenUses} ${plural(tokenUses, "artifact uses", "artifacts use")} it and lose${tokenUses === 1 ? "s" : ""} this value.` : "No artifact uses it."}</AlertDialogDescription>
              </>
            )}
            {ask?.kind === "mode" && (
              <>
                <AlertDialogTitle>Delete the {ask.mode} mode?</AlertDialogTitle>
                <AlertDialogDescription>{modeUses > 0 ? `${modeUses} ${plural(modeUses, "artifact uses", "artifacts use")} this mode and go back to ${defaultMode}.` : "No artifact uses this mode."}</AlertDialogDescription>
              </>
            )}
            {ask?.kind === "kit" && (
              <>
                <AlertDialogTitle>Delete this project's kit?</AlertDialogTitle>
                <AlertDialogDescription>Pages and motions keep their files, and lose every token value. The library is untouched.</AlertDialogDescription>
              </>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={confirmDelete}>
              {ask?.kind === "token" ? "Delete token" : ask?.kind === "mode" ? "Delete mode" : "Delete kit"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
};

/** The kit's More menu: the actions that are not a cell's. */
const EXPORTS: ReadonlyArray<{ readonly format: KitExportFormat; readonly label: string }> = [
  { format: "dtcg", label: "DTCG JSON" },
  { format: "css", label: "CSS variables" },
  { format: "tailwind", label: "Tailwind @theme" },
];

const KitMenu = ({ linked, onSave, onUpdate, onImport, onExport, onDelete }: { readonly linked: boolean; readonly onSave: () => void; readonly onUpdate: () => void; readonly onImport: () => void; readonly onExport: (format: KitExportFormat) => void; readonly onDelete: () => void }) => {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Menu>
      <MenuTrigger ref={trigger} render={<Button variant="ghost" size="icon-sm" aria-label="More" />}>
        <EllipsisIcon aria-hidden />
      </MenuTrigger>
      <MenuPopup anchor={trigger} side="bottom" align="end">
        <MenuItem onClick={onSave}>Save to library</MenuItem>
        {linked && <MenuItem onClick={onUpdate}>Update in library</MenuItem>}
        <MenuItem onClick={onImport}>Import…</MenuItem>
        <MenuSub>
          <MenuSubTrigger>Export</MenuSubTrigger>
          <MenuSubPopup>
            {EXPORTS.map((item) => (
              <MenuItem key={item.format} onClick={() => onExport(item.format)}>
                {item.label}
              </MenuItem>
            ))}
          </MenuSubPopup>
        </MenuSub>
        <MenuItem onClick={onDelete}>Delete kit</MenuItem>
      </MenuPopup>
    </Menu>
  );
};
