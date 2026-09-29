import { Dialog } from "@base-ui/react/dialog";
import { UnframedError } from "@unframed/contracts";
import { finalPromptWarnings } from "@unframed/domain";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useEditor, useValue } from "tldraw";
import { useEngine } from "../../context.ts";
import { batchNow, sendBatch, stagedFree, type StagedFree } from "../free.ts";
import type { TrayOverlayProps } from "../mediumRegistry.ts";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

const labelClass = "m-0 text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground";
const readOnlyClass = "m-0 max-h-[96px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-card px-2.5 py-2 text-[13px] text-foreground";
const buttonClass =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border-0 px-3 text-[13px] disabled:cursor-default disabled:opacity-50";

/** A run's row: which images it receives. */
const imagesOf = (used: ReadonlyArray<number> | null): string =>
  used === null ? "all images" : used.length === 1 ? `image ${used[0]}` : `images ${used.join(", ")}`;

const generateLabel = (runs: number) => (runs > 1 ? `Generate ${runs}×` : "Generate");

/**
 * The final prompt dialog: the assembled Free batch before any image is paid for. Its rows
 * come live from the same Free batch the send uses. Confirm sends the batch as edited, with
 * the staged batch id and no second text call; the edits never reach the source shape.
 */
const FinalPromptDialog = ({ staged, onClose, onSent }: { staged: StagedFree; onClose: () => void; onSent: () => void }) => {
  const editor = useEditor();
  const engine = useEngine();
  const [text, setText] = useState(staged.listText);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const batch = useValue("final prompt batch", () => batchNow(editor, staged, text), [editor, staged, text]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose]);

  const runs = batch.runs.length;
  const subtitle = batch.error !== undefined ? "This list cannot be assembled yet." : `${runs} ${runs === 1 ? "generation" : "generations"}. Nothing has been sent yet.`;
  const warnings = batch.error === undefined ? finalPromptWarnings(batch) : [];

  const confirm = async () => {
    if (sending) return;
    setSending(true);
    setFailure(undefined);
    try {
      await sendBatch(editor, engine, staged, batchNow(editor, staged, text));
      onSent();
    } catch (error) {
      setFailure(messageOf(error));
      setSending(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1300] bg-[var(--unframed-scrim)] backdrop-blur-[10px] backdrop-saturate-[160%]" />
        <Dialog.Popup
          data-testid="final-prompt"
          className="fixed left-1/2 top-1/2 z-[1301] flex max-h-[min(760px,calc(100vh-48px))] w-[640px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-border bg-popover p-5 text-foreground shadow-lg outline-none"
        >
          <div>
            <Dialog.Title className="m-0 text-[18px] font-semibold">Final prompt</Dialog.Title>
            <Dialog.Description className="m-0 mt-1 text-[13px] text-muted-foreground">{subtitle}</Dialog.Description>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" data-scrolls="true">
            {batch.shared !== "" && (
              <section className="flex flex-col gap-1" aria-label="Shared by every run">
                <p className={labelClass}>Shared by every run</p>
                <p className={readOnlyClass}>{batch.shared}</p>
              </section>
            )}
            {batch.instruction !== "" && (
              <section className="flex flex-col gap-1" aria-label="Added after every section">
                <p className={labelClass}>Added after every section</p>
                <p className={readOnlyClass}>{batch.instruction}</p>
              </section>
            )}
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Sections</span>
              <textarea
                rows={12}
                spellCheck={false}
                className="resize-none rounded-lg border border-input bg-card px-2.5 py-2 font-mono text-[12.5px] leading-snug text-foreground outline-none focus:border-primary"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            {runs > 0 && (
              <ol className="m-0 flex list-none flex-col p-0" aria-label="Runs">
                {batch.runs.map((run, index) => (
                  <li key={index} className="flex h-7 items-center justify-between border-b border-border text-[13px] last:border-b-0">
                    <span>Run {index + 1}</span>
                    <span className="text-muted-foreground">{imagesOf(run.used)}</span>
                  </li>
                ))}
              </ol>
            )}
            {warnings.map((line) => (
              <p key={line} role="status" data-kind="warning" className="m-0 text-[12.5px] text-[var(--unframed-text-warning,inherit)]">
                {line}
              </p>
            ))}
            {staged.repairNotes.length > 0 && (
              <p role="status" data-kind="info" className="m-0 text-[12.5px] text-muted-foreground">
                {staged.repairNotes.join(" · ")}
              </p>
            )}
            {batch.error !== undefined && (
              <p role="alert" data-kind="error" className="m-0 text-[12.5px] text-[var(--unframed-text-danger,inherit)]">
                {batch.error}
              </p>
            )}
            {failure !== undefined && (
              <p role="alert" data-kind="error" className="m-0 text-[12.5px] text-[var(--unframed-text-danger,inherit)]">
                {failure}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={`${buttonClass} bg-transparent text-foreground hover:bg-accent`} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={`${buttonClass} bg-primary text-primary-foreground`}
              disabled={batch.error !== undefined || runs === 0 || sending}
              aria-busy={sending || undefined}
              onClick={() => void confirm()}
            >
              {sending && <LoaderCircle size={14} className="animate-spin" aria-hidden />}
              {generateLabel(runs)}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

/** The image medium's overlay: the final prompt dialog while a Free batch is staged. */
export const FinalPromptOverlay = ({ onSent, onMenuOpen }: TrayOverlayProps) => {
  const editor = useEditor();
  const staged = useValue("staged free batch", () => stagedFree(editor).get(), [editor]);
  const open = staged !== undefined;
  useEffect(() => {
    onMenuOpen("final-prompt", open);
  }, [open, onMenuOpen]);
  // A staged batch lives only as long as the tray that staged it.
  useEffect(
    () => () => {
      stagedFree(editor).set(undefined);
    },
    [editor],
  );
  if (!staged) return null;
  return (
    <FinalPromptDialog
      key={staged.batchId}
      staged={staged}
      onClose={() => stagedFree(editor).set(undefined)}
      onSent={() => {
        stagedFree(editor).set(undefined);
        onSent();
      }}
    />
  );
};
