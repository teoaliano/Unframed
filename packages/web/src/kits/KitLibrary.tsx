/**
 * The Kit's library actions (spec 19): Save to library, which opens the Add to library form for
 * the kit, and Update in library, which replaces the linked library kit with the project's.
 */
import { UnframedError } from "@unframed/contracts";
import { PRESET_EMPTY_NAME_MESSAGE, type Kit, type KitPreset, type LibraryEntry, type Token } from "@unframed/domain";
import type { EngineConnection } from "../rpc/engine.ts";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { SAVE_FAILED_MESSAGE } from "../library/AddToLibraryDialog.tsx";
import { useCanvasProject, useEngine } from "../context.ts";
import { showError, showNotice } from "../toasts.tsx";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

/** `N tokens and M modes, saved as you have them now.` */
export const kitSaveSubtitle = (kit: Pick<Kit, "tokens" | "modes">): string =>
  `${kit.tokens.length} ${kit.tokens.length === 1 ? "token" : "tokens"} and ${kit.modes.length} ${kit.modes.length === 1 ? "mode" : "modes"}, saved as you have them now.`;

/** The link a project keeps to the library kit it has as it is now: its revision and its tokens and modes. */
export const linkFor = (presetId: string, revision: number, kit: { readonly modes: ReadonlyArray<string>; readonly tokens: ReadonlyArray<Token> }) => ({
  presetId,
  revision,
  base: { modes: [...kit.modes], tokens: structuredClone([...kit.tokens]) },
});

/** The Add to library form for a kit: a name and a description, as the library's own form. */
export const SaveKitDialog = ({ kit, onClose, onSaved }: { readonly kit: Kit; readonly onClose: () => void; readonly onSaved: (presetId: string, revision: number) => void }) => {
  const engine = useEngine();
  const project = useCanvasProject();
  const [name, setName] = useState(kit.name);
  const [summary, setSummary] = useState("");
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed === "") return setProblem(PRESET_EMPTY_NAME_MESSAGE);
    setBusy(true);
    setProblem(undefined);
    try {
      const { preset } = await engine.call("kit.saveToLibrary", { project, name: trimmed, summary: summary.trim() });
      onSaved(preset.id, (preset as { revision: number }).revision);
      showNotice(`Saved “${trimmed}” to your library.`, "info");
    } catch (error) {
      setProblem(error instanceof UnframedError ? messageOf(error) : SAVE_FAILED_MESSAGE);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup data-testid="add-to-library" className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add to library</DialogTitle>
          <DialogDescription>{kitSaveSubtitle(kit)}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Name</span>
            <Input value={name} aria-invalid={problem !== undefined || undefined} onChange={(event) => setName(event.target.value)} />
          </label>
          {problem !== undefined && (
            <p role="alert" className="m-0 text-sm text-destructive-foreground">
              {problem}
            </p>
          )}
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Description</span>
            <Input placeholder="What it does, in a line" value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={busy} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

export type UpdateOutcome = { readonly kind: "updated"; readonly presetId: string; readonly revision: number } | { readonly kind: "newer"; readonly message: string } | { readonly kind: "failed" };

/**
 * Update in library: the engine replaces the linked preset. A library kit newer than the project's
 * last take is `newer`, which the dialog answers with Update from kit rather than a toast.
 */
export const updateInLibrary = async (engine: ReturnType<typeof useEngine>, project: string): Promise<UpdateOutcome> => {
  try {
    const { preset } = await engine.call("kit.updateInLibrary", { project });
    showNotice(`Updated “${preset.name}” in your library.`, "info");
    return { kind: "updated", presetId: preset.id, revision: (preset as { revision: number }).revision };
  } catch (error) {
    if (error instanceof UnframedError && error.code === "conflict") return { kind: "newer", message: error.message };
    showError(messageOf(error));
    return { kind: "failed" };
  }
};

/** The library's kit entry with this id, or undefined when it is not in the library. */
export const libraryKitById = async (engine: EngineConnection, id: string): Promise<KitPreset | undefined> => {
  const { presets } = await engine.call("library.list");
  const found = (presets as unknown as LibraryEntry[]).find((entry) => entry.id === id);
  return found?.kind === "kit" ? found : undefined;
};
