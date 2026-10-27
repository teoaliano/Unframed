/**
 * Apply on a kit card in the Library (spec 19). A project with no kit takes the library kit as a
 * copy, linked to its preset. A project whose kit came from that preset updates from it. Any other
 * kit is replaced, after a confirmation that names both kits.
 */
import { replaceKit, type Kit, type KitPreset, type Token } from "@unframed/domain";
import type { Editor } from "tldraw";
import { AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle } from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
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
