import { draftLine, elementKind, type DraftChange } from "@unframed/domain";
import { Eye, PencilLine, X } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import type { EditSession } from "../artifacts/editor/editSession.ts";
import { APPLY_STATE_TEXT, type ApplyRow, type ApplyRun, type ApplyState } from "./screenApply.ts";

const counted = (count: number) => (count === 1 ? "1 change" : `${count} changes`);

const STATE_LOOK: Readonly<Record<ApplyState, string>> = {
  writing: "text-(--artifact-editor-meta)",
  checking: "text-(--artifact-editor-meta)",
  took: "text-(--artifact-editor-foreground)",
  missed: "text-(--artifact-editor-error-foreground)",
  agent: "text-(--artifact-editor-warning-foreground)",
  unsent: "text-(--artifact-editor-error-foreground)",
};

const where = (change: DraftChange): string => {
  const element = change.element;
  const owner = element.component === null ? "" : ` · in ${element.component}`;
  return `${elementKind(element.tag)}${owner}`;
};

const Row = ({ change, row, session, busy }: { readonly change: DraftChange; readonly row: ApplyRow | undefined; readonly session: EditSession; readonly busy: boolean }) => {
  const many = change.element.instanceCount > 1;
  return (
    <li className="flex min-w-0 flex-col gap-1 py-1.5" data-draft-row={change.id} data-draft-state={row?.state ?? "draft"}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">{where(change)}</span>
        {row === undefined ? (
          <Button variant="ghost" size="icon-xs" aria-label={`Discard ${draftLine(change)}`} disabled={busy} onClick={() => session.discardDraft(change.id)}>
            <X aria-hidden />
          </Button>
        ) : (
          <span className={cn("shrink-0 text-xs", STATE_LOOK[row.state])} data-testid="draft-state">
            {APPLY_STATE_TEXT[row.state]}
          </span>
        )}
      </div>
      <span className="min-w-0 truncate font-mono text-xs text-(--artifact-editor-meta)" data-testid="draft-line">
        {draftLine(change)}
      </span>
      {row === undefined && many && (
        <div role="group" aria-label="Which instances" className="flex items-center gap-1 text-xs">
          <Button variant={change.scope === "all" ? "secondary" : "ghost"} size="xs" aria-pressed={change.scope === "all"} onClick={() => session.scopeDraft(change.id, "all")}>
            {`All ${change.element.instanceCount}`}
          </Button>
          <Button variant={change.scope === "one" ? "secondary" : "ghost"} size="xs" aria-pressed={change.scope === "one"} onClick={() => session.scopeDraft(change.id, "one")}>
            Only this one
          </Button>
        </div>
      )}
      {row?.reason && <span className="text-xs text-(--artifact-editor-note)" data-testid="draft-reason">{row.reason}</span>}
    </li>
  );
};

export const ScreenDrafts = ({ session, run, onApply, onDismiss }: { readonly session: EditSession; readonly run: ApplyRun | undefined; readonly onApply: () => void; readonly onDismiss: () => void }) => {
  const [open, setOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const drafts = session.drafts;
  const showRun = drafts.length === 0 && run !== undefined;
  const changes = showRun ? run.rows.map((row) => row.change) : drafts;
  if (changes.length === 0) return null;
  const busy = run?.busy === true;
  const compare = (on: boolean) => {
    setComparing(on);
    session.showDrafts(!on);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && comparing) compare(false);
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" className="shrink-0" data-testid="screen-drafts" />}>
        <PencilLine aria-hidden />
        {showRun ? (busy ? "Applying…" : "Applied") : counted(changes.length)}
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" padding="compact" className="w-80" aria-label="Changes" initialFocus={false}>
        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm font-semibold">{showRun ? "Applied changes" : `${counted(changes.length)} to apply`}</p>
          <ul className="m-0 flex list-none flex-col divide-y divide-(--artifact-editor-column-border) p-0" aria-label="Changes">
            {changes.map((change) => (
              <Row key={change.id} change={change} row={showRun ? run.rows.find((row) => row.change.id === change.id) : undefined} session={session} busy={busy} />
            ))}
          </ul>
          {showRun ? (
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-xs text-(--artifact-editor-note)">{busy ? "" : "Undo puts back what Apply wrote."}</span>
              <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
                Done
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant={comparing ? "secondary" : "ghost"} size="sm" aria-pressed={comparing} onClick={() => compare(!comparing)}>
                <Eye aria-hidden />
                Compare
              </Button>
              <Button variant="ghost" size="sm" className="ml-auto" disabled={busy} onClick={() => session.discard()}>
                Discard all
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (comparing) compare(false);
                  onApply();
                }}
              >
                Apply
              </Button>
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
};
