import { PRESET_EMPTY_NAME_MESSAGE, presetFromSelection } from "@unframed/domain";
import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { useEngine } from "../context.ts";
import { showNotice } from "../toasts.tsx";
import type { Captured } from "./state.ts";

export const SAVE_FAILED_MESSAGE = "Could not save. Is the local server running?";

const fieldLabelClass = "grid gap-1.5";
const fieldNameClass = "text-xs font-medium text-foreground";

/** `N shape(s), saved as you have them now.`, naming the recipe when the group has one. */
export const saveSubtitle = (captured: Pick<Captured, "members" | "recipe">): string =>
  `${captured.members} ${captured.members === 1 ? "shape" : "shapes"}${captured.recipe ? " and its recipe" : ""}, saved as you have them now.`;

/**
 * "Add to library": a name and a description; the rest is read from the selection captured
 * when the menu item was clicked.
 */
export const AddToLibraryDialog = ({ captured, onClose }: { readonly captured: Captured; readonly onClose: () => void }) => {
  const engine = useEngine();
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed === "") return setProblem(PRESET_EMPTY_NAME_MESSAGE);
    const made = presetFromSelection(captured, { name: trimmed });
    if (!made.ok) return setProblem(made.error);
    setBusy(true);
    setProblem(undefined);
    try {
      await engine.call("library.save", { name: trimmed, summary: summary.trim(), content: made.content });
      showNotice(`Saved “${trimmed}” to your library.`, "info");
      onClose();
    } catch {
      setProblem(SAVE_FAILED_MESSAGE);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup data-testid="add-to-library" className="max-w-[420px]" initialFocus={nameField}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add to library</DialogTitle>
            <DialogDescription>{saveSubtitle(captured)}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label className={fieldLabelClass}>
              <span className={fieldNameClass}>Name</span>
              <Input
                ref={nameField}
                placeholder="e.g. Portrait retouch"
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
            <label className={fieldLabelClass}>
              <span className={fieldNameClass}>Description</span>
              <Input placeholder="What it does, in a line" value={summary} onChange={(event) => setSummary(event.target.value)} />
            </label>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
};
