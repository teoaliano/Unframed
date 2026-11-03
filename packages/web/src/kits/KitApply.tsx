/**
 * Apply on a kit card in the Library (spec 19). A project with no kit takes the library kit as a
 * copy, linked to its preset. A project whose kit came from that preset updates from it. Any other
 * kit is replaced, after a confirmation that names both kits.
 */
import { mergeKit, replaceKit, type Kit, type KitPreset, type MergeChoices, type MergeResult, type Token } from "@unframed/domain";
import { useState } from "react";
import type { Editor } from "tldraw";
import { AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle } from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Dialog, DialogClose, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { showNotice } from "../toasts.tsx";
import { kitOf, writeKit } from "./kitRoom.ts";
import { kitUi } from "./state.ts";
import { linkFor } from "./KitLibrary.tsx";

/** The copy of a library kit a project takes: its values, the project's own name for it, and the link. */
const kitFrom = (preset: KitPreset): Kit => ({
  format: 1,
  name: preset.kit.name,
  modes: [...preset.kit.modes],
  tokens: structuredClone([...preset.kit.tokens]) as Token[],
  from: linkFor(preset.id, preset.revision, preset.kit),
});

const applied = (name: string) => showNotice(`Applied “${name}” to this project.`, "info");

/** Apply from a library kit card: copies, updates or asks, as the project's kit allows. */
export const applyLibraryKit = (editor: Editor, preset: KitPreset, confirm: () => void): void => {
  const kit = kitOf(editor);
  if (kit === null) {
    writeKit(editor, kitFrom(preset));
    applied(preset.name);
    return;
  }
  if (kit.from?.presetId === preset.id) {
    kitUi(editor).update((state) => ({ ...state, merging: preset }));
    return;
  }
  confirm();
};

/** The confirmation for replacing the project's kit with a library kit. The replacement is one undo step. */
export const ReplaceKitDialog = ({ editor, preset, onClose }: { readonly editor: Editor; readonly preset: KitPreset; readonly onClose: () => void }) => {
  const current = kitOf(editor);
  const replace = () => {
    if (current !== null) {
      writeKit(editor, { ...replaceKit(current, kitFrom(preset)), from: linkFor(preset.id, preset.revision, preset.kit) });
      applied(preset.name);
    }
    onClose();
  };
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogPopup className="max-w-[400px]">
        <AlertDialogHeader>
          <AlertDialogTitle>Replace this project's kit?</AlertDialogTitle>
          <AlertDialogDescription>{`“${preset.name}” takes the place of “${current?.name ?? ""}”. Tokens with the same name take the new values. Tokens only this project has stay, so no page loses a value.`}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button onClick={replace}>Apply kit</Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
};

/** The three-way merge of the project's kit with a library kit as it is now, with the person's choices applied. */
export const mergeWith = (project: Kit, preset: KitPreset, choices: MergeChoices = {}): MergeResult =>
  mergeKit({ project, base: project.from?.base ?? { modes: [], tokens: [] }, library: { modes: [...preset.kit.modes], tokens: [...preset.kit.tokens] as Token[] } }, choices);

/** Whether a library kit would change the project at all: an update, an addition, a removal, a conflict, or a mode. */
export const hasDifferences = (result: MergeResult, project: Kit): boolean =>
  result.counts.updated + result.counts.added + result.counts.removed > 0 || result.conflicts.length > 0 || result.kit.modes.length !== project.modes.length;

const countsLine = (counts: MergeResult["counts"]) =>
  `${counts.updated} updated, ${counts.added} added, ${counts.kept} kept as you changed them here, ${counts.removed} no longer in the kit`;

/** A value as the dialog shows it: a swatch for a colour, then its text. */
const ValueText = ({ colour, text }: { readonly colour: boolean; readonly text: string }) => (
  <span className="inline-flex items-center gap-1.5 font-mono text-xs">
    {colour && <span aria-hidden className="size-3 shrink-0 rounded-sm border" style={{ background: text }} />}
    {text}
  </span>
);

/** Update from kit (spec 19): the counts, a row per conflict to keep or take, and one undo step on Update. */
export const UpdateFromKitDialog = ({ editor, preset, onClose }: { readonly editor: Editor; readonly preset: KitPreset; readonly onClose: () => void }) => {
  const project = kitOf(editor);
  const [choices, setChoices] = useState<MergeChoices>({});
  if (project === null) return null;
  const result = mergeWith(project, preset, choices);
  const types = new Map(project.tokens.map((token) => [token.path, token.type]));
  const update = () => {
    writeKit(editor, { ...result.kit, from: linkFor(preset.id, preset.revision, preset.kit) });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup data-testid="update-from-kit" className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{`Update from “${preset.name}”`}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <p className="text-sm text-muted-foreground">{countsLine(result.counts)}</p>
          {result.conflicts.map((conflict) => {
            const key = `${conflict.path}|${conflict.mode}`;
            const colour = types.get(conflict.path) === "color";
            return (
              <div key={key} data-conflict={key} className="grid gap-2 border-t pt-3">
                <span className="text-sm">
                  {conflict.path}
                  {project.modes.length > 1 && <span className="text-muted-foreground"> · {conflict.mode}</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  Here: <ValueText colour={colour} text={conflict.here} />
                </span>
                <span className="text-xs text-muted-foreground">
                  Kit: <ValueText colour={colour} text={conflict.kit} />
                </span>
                <ToggleGroup
                  aria-label={`Resolve ${key}`}
                  value={[choices[key] ?? "mine"]}
                  onValueChange={(next) => {
                    const [picked] = next as string[];
                    if (picked !== undefined) setChoices({ ...choices, [key]: picked === "kit" ? "kit" : "mine" });
                  }}
                >
                  <Toggle value="mine" aria-label="Keep mine">
                    Keep mine
                  </Toggle>
                  <Toggle value="kit" aria-label="Take the kit's">
                    Take the kit's
                  </Toggle>
                </ToggleGroup>
              </div>
            );
          })}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={update}>Update</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
