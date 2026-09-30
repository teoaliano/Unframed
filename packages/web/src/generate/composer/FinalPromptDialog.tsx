import { UnframedError } from "@unframed/contracts";
import { finalPromptWarnings } from "@unframed/domain";
import { useEffect, useId, useState } from "react";
import { useEditor, useValue } from "tldraw";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { useEngine } from "../../context.ts";
import { batchNow, sendBatch, stagedFree, type StagedFree } from "../free.ts";
import type { TrayOverlayProps } from "../mediumRegistry.ts";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

const labelClass = "m-0 text-xs font-medium text-muted-foreground";
const readOnlyClass = "m-0 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-card px-3 py-2 text-sm text-card-foreground";

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
  const sectionsId = useId();
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup data-testid="final-prompt" className="max-h-[min(760px,calc(100vh-48px))] max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Final prompt</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
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
          <div className="flex flex-col gap-1">
            <label htmlFor={sectionsId} className={labelClass}>
              Sections
            </label>
            {/* The list reads in the mono stack, which the field inherits. The kit's field sizes to its text, so 12 rows is its height: 12 lines of 20 px, the padding and the border. */}
            <div className="font-mono">
              <Textarea id={sectionsId} rows={12} spellCheck={false} className="h-63" value={text} onChange={(event) => setText(event.target.value)} />
            </div>
          </div>
          {runs > 0 && (
            <ol className="m-0 flex list-none flex-col p-0 text-sm" aria-label="Runs">
              {batch.runs.map((run, index) => (
                <li key={index} className="flex h-7 items-center justify-between border-b last:border-b-0">
                  <span>Run {index + 1}</span>
                  <span className="text-muted-foreground">{imagesOf(run.used)}</span>
                </li>
              ))}
            </ol>
          )}
          {warnings.map((line) => (
            <Alert key={line} variant="warning" role="status" data-kind="warning">
              {line}
            </Alert>
          ))}
          {staged.repairNotes.length > 0 && (
            <p role="status" data-kind="info" className="m-0 text-xs text-muted-foreground">
              {staged.repairNotes.join(" · ")}
            </p>
          )}
          {batch.error !== undefined && (
            <Alert variant="error" data-kind="error">
              {batch.error}
            </Alert>
          )}
          {failure !== undefined && (
            <Alert variant="error" data-kind="error">
              {failure}
            </Alert>
          )}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={batch.error !== undefined || runs === 0 || sending} aria-busy={sending || undefined} onClick={() => void confirm()}>
            {sending && <Spinner aria-hidden />}
            {generateLabel(runs)}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
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
