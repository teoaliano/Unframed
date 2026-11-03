import { UnframedError } from "@unframed/contracts";
import { PRESET_EMPTY_NAME_MESSAGE, type Kit, type KitPreset, type LibraryEntry, type Token } from "@unframed/domain";
import type { EngineConnection } from "../rpc/engine.ts";
import { useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { SAVE_FAILED_MESSAGE } from "../library/AddToLibraryDialog.tsx";
import { useCanvasProject, useEngine } from "../context.ts";
import { showError, showNotice } from "../toasts.tsx";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

const kitSaveSubtitle = (kit: Pick<Kit, "tokens" | "modes">): string =>
  `${kit.tokens.length} ${kit.tokens.length === 1 ? "token" : "tokens"} and ${kit.modes.length} ${kit.modes.length === 1 ? "mode" : "modes"}, saved as you have them now.`;

export const linkFor = (presetId: string, revision: number, kit: { readonly modes: ReadonlyArray<string>; readonly tokens: ReadonlyArray<Token> }) => ({
  presetId,
  revision,
  base: { modes: [...kit.modes], tokens: structuredClone([...kit.tokens]) },
});

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
          <Label>
            <span className="grid w-full gap-1.5">
            <span className="text-xs font-medium text-foreground">Name</span>
            <Input value={name} aria-invalid={problem !== undefined || undefined} onChange={(event) => setName(event.target.value)} />
            </span>
          </Label>
          {problem !== undefined && (
            <Alert variant="error">{problem}</Alert>
          )}
          <Label>
            <span className="grid w-full gap-1.5">
            <span className="text-xs font-medium text-foreground">Description</span>
            <Input placeholder="What it does, in a line" value={summary} onChange={(event) => setSummary(event.target.value)} />
            </span>
          </Label>
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

type UpdateOutcome = { readonly kind: "updated"; readonly presetId: string; readonly revision: number } | { readonly kind: "newer"; readonly message: string } | { readonly kind: "failed" };

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

export const libraryKitById = async (engine: EngineConnection, id: string): Promise<KitPreset | undefined> => {
  const { presets } = await engine.call("library.list");
  const found = (presets as unknown as LibraryEntry[]).find((entry) => entry.id === id);
  return found?.kind === "kit" ? found : undefined;
};
