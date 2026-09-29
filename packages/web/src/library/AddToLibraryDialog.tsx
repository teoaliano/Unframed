import { Dialog } from "@base-ui/react/dialog";
import { PRESET_EMPTY_NAME_MESSAGE, presetFromSelection } from "@unframed/domain";
import { useState } from "react";
import { useEngine } from "../context.ts";
import { showNotice } from "../toasts.tsx";
import type { Captured } from "./state.ts";

export const SAVE_FAILED_MESSAGE = "Could not save. Is the local server running?";

const fieldClass = "h-9 rounded-element border border-line-strong bg-surface px-2.5 text-[14px] text-primary outline-none focus:border-accent";

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
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1300] bg-[var(--unframed-scrim)] backdrop-blur-[10px] backdrop-saturate-[160%]" />
        <Dialog.Popup
          data-testid="add-to-library"
          className="fixed left-1/2 top-1/2 z-[1301] w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-container border border-line bg-popover p-5 text-primary shadow-popover outline-none"
        >
          <Dialog.Title className="m-0 text-[18px] font-semibold">Add to library</Dialog.Title>
          <Dialog.Description className="m-0 mt-1 text-[13px] text-secondary">{saveSubtitle(captured)}</Dialog.Description>
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className="flex flex-col gap-1 text-[13px]">
              Name
              <input
                autoFocus
                className={fieldClass}
                placeholder="e.g. Portrait retouch"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setProblem(undefined);
                }}
              />
            </label>
            {problem !== undefined && (
              <p role="alert" className="-mt-1 m-0 text-[12px] text-error">
                {problem}
              </p>
            )}
            <label className="flex flex-col gap-1 text-[13px]">
              Description
              <input className={fieldClass} placeholder="What it does, in a line" value={summary} onChange={(event) => setSummary(event.target.value)} />
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <Dialog.Close className="h-8 cursor-pointer rounded-element border border-line bg-transparent px-3 text-[13px] text-primary hover:bg-hover">Cancel</Dialog.Close>
              <button type="submit" className="h-8 cursor-pointer rounded-element border-0 bg-accent px-3 text-[13px] text-on-accent disabled:opacity-50" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
