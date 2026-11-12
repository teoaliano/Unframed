import { GUIDANCE_CHOICE, mergeKit, replaceKit, type Kit, type KitPreset, type MergeChoices, type MergeResult, type Token } from "@unframed/domain";
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

const kitFrom = (preset: KitPreset): Kit => ({
  format: 1,
  name: preset.kit.name,
  modes: [...preset.kit.modes],
  tokens: structuredClone([...preset.kit.tokens]) as Token[],
  ...(preset.kit.guidance === undefined ? {} : { guidance: preset.kit.guidance }),
  from: linkFor(preset.id, preset.revision, preset.kit),
});

const applied = (name: string) => showNotice(`Applied “${name}” to this project.`, "info");

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
      <AlertDialogPopup className="max-w-(--kit-replace-dialog-width)">
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

export const mergeWith = (project: Kit, preset: KitPreset, choices: MergeChoices = {}): MergeResult =>
  mergeKit(
    {
      project,
      base: project.from?.base ?? { modes: [], tokens: [] },
      library: { modes: [...preset.kit.modes], tokens: [...preset.kit.tokens] as Token[], guidance: preset.kit.guidance },
    },
    choices,
  );

export const hasDifferences = (result: MergeResult, project: Kit): boolean =>
  result.counts.updated + result.counts.added + result.counts.removed > 0 ||
  result.conflicts.length > 0 ||
  result.kit.modes.length !== project.modes.length ||
  result.guidance === "updated" ||
  result.guidance === "conflict";

const countsLine = (counts: MergeResult["counts"]) =>
  `${counts.updated} updated, ${counts.added} added, ${counts.kept} kept as you changed them here, ${counts.removed} no longer in the kit`;

const GUIDANCE_LINE: Readonly<Record<string, string>> = {
  updated: "The guidance takes the kit's.",
  kept: "The guidance stays as you changed it here.",
};

const opening = (text: string) => (text === "" ? "(none)" : text.length > 160 ? `${text.slice(0, 159).trimEnd()}…` : text);

const ValueText = ({ colour, text }: { readonly colour: boolean; readonly text: string }) => (
  <span className="inline-flex items-center gap-1.5 font-mono text-xs">
    {colour && <span aria-hidden className="size-3 shrink-0 rounded-sm border border-(--kit-update-dialog-swatch-border)" style={{ background: text }} />}
    {text}
  </span>
);

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
      <DialogPopup data-testid="update-from-kit" className="max-w-(--kit-update-dialog-width)">
        <DialogHeader>
          <DialogTitle>{`Update from “${preset.name}”`}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <p className="text-sm text-(--kit-update-dialog-description)">{countsLine(result.counts)}</p>
          {result.guidance !== undefined && GUIDANCE_LINE[result.guidance] !== undefined && <p className="text-sm text-(--kit-update-dialog-description)">{GUIDANCE_LINE[result.guidance]}</p>}
          {result.guidanceConflict !== undefined && (
            <div data-conflict={GUIDANCE_CHOICE} className="grid gap-2 border-t border-(--kit-update-dialog-divider) pt-3">
              <span className="text-sm">Guidance</span>
              <span className="text-xs whitespace-pre-line text-(--kit-update-dialog-description)">Here: {opening(result.guidanceConflict.here)}</span>
              <span className="text-xs whitespace-pre-line text-(--kit-update-dialog-description)">Kit: {opening(result.guidanceConflict.kit)}</span>
              <ToggleGroup
                aria-label="Resolve guidance"
                value={[choices[GUIDANCE_CHOICE] ?? "mine"]}
                onValueChange={(next) => {
                  const [picked] = next as string[];
                  if (picked !== undefined) setChoices({ ...choices, [GUIDANCE_CHOICE]: picked === "kit" ? "kit" : "mine" });
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
          )}
          {result.conflicts.map((conflict) => {
            const key = `${conflict.path}|${conflict.mode}`;
            const colour = types.get(conflict.path) === "color";
            return (
              <div key={key} data-conflict={key} className="grid gap-2 border-t border-(--kit-update-dialog-divider) pt-3">
                <span className="text-sm">
                  {conflict.path}
                  {project.modes.length > 1 && <span className="text-(--kit-update-dialog-description)"> · {conflict.mode}</span>}
                </span>
                <span className="text-xs text-(--kit-update-dialog-description)">
                  Here: <ValueText colour={colour} text={conflict.here} />
                </span>
                <span className="text-xs text-(--kit-update-dialog-description)">
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
