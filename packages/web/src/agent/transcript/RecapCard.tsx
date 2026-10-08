import { recapRows, revertSkipLine, roomShapeId, shapeKind, type ChatActivity, type ChatTurn, type RecapRow, type RecapShape } from "@unframed/domain";
import { Crosshair, ExternalLink, FileDiff, Undo2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useValue, type Editor, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Tip } from "../../chrome/ui.tsx";
import { KIND_ICONS } from "../composer/chips.tsx";
import { Chevron, Disclosure } from "./WorkLog.tsx";

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** The turn's rows, re-read as the canvas changes, so a deleted shape strikes through at once. */
const useRecapRows = (editor: Editor | null, activities: ReadonlyArray<ChatActivity>, files: ChatTurn["files"]): RecapRow[] => {
  const ids = useMemo(() => recapRows(activities, files ?? [], []).map((row) => row.shapeId), [activities, files]);
  const key = useValue(
    "recap shapes",
    () =>
      JSON.stringify(
        ids.flatMap((id): RecapShape[] => {
          const shape = editor?.getShape(roomShapeId(id) as TLShapeId);
          if (!shape) return [];
          const props = shape.props as Record<string, unknown>;
          const title = text(props.title);
          const fileName = text(props.fileName);
          return [{ id: shape.id, kind: shapeKind(shape.type), ...(title !== undefined ? { title } : {}), ...(fileName !== undefined ? { fileName } : {}) }];
        }),
      ),
    [editor, ids],
  );
  // A shape deleted while the card is on screen keeps the label it had.
  const seen = useRef(new Map<string, string>());
  return useMemo(
    () =>
      recapRows(activities, files ?? [], JSON.parse(key) as RecapShape[]).map((row) => {
        if (!row.deleted) seen.current.set(row.shapeId, row.label);
        const label = row.deleted ? seen.current.get(row.shapeId) : undefined;
        return label === undefined ? row : { ...row, label };
      }),
    [activities, files, key],
  );
};

export interface RecapCardProps {
  readonly editor: Editor | null;
  readonly turn: ChatTurn;
  readonly activities: ReadonlyArray<ChatActivity>;
  /** The chat is running a turn: nothing can be reverted until it ends. */
  readonly running: boolean;
  /** The newest card offers every change of the chat. */
  readonly newest: boolean;
  readonly labelOf: (shapeId: string) => string;
  readonly onRevert: () => void;
  readonly onDiff: (shapeId?: string) => void;
  readonly onDiffAll: () => void;
  readonly onLocate?: ((shapeId: string) => void) | undefined;
  readonly onOpenEditor?: ((shapeId: string) => void) | undefined;
}

/** What a turn read or changed, with Open, Locate and View diff per row, and Revert this turn. */
export const RecapCard = ({ editor, turn, activities, running, newest, labelOf, onRevert, onDiff, onDiffAll, onLocate, onOpenEditor }: RecapCardProps) => {
  const rows = useRecapRows(editor, activities, turn.files);
  const [open, setOpen] = useState(true);
  if (rows.length === 0) return null;
  const changed = (turn.files?.length ?? 0) > 0;
  const reverted = turn.reverted;
  const skipLine = reverted ? revertSkipLine(reverted.skipped.map((shape) => ({ label: labelOf(shape.id), by: shape.by })), reverted.restored.length) : undefined;
  return (
    <section className="flex flex-col gap-1 rounded-xl border bg-card px-2 py-1.5 text-sm shadow-xs/5" data-testid="recap-card" aria-label={`Files of turn ${turn.turnCount}`}>
      <header className="flex items-center gap-1.5">
        <Disclosure
          open={open}
          onToggle={() => setOpen(!open)}
          testId="recap-toggle"
          className="flex min-h-7 min-w-0 flex-1 cursor-pointer select-none items-center gap-1.5 rounded-md px-0.5 text-left text-muted-foreground transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        >
          <Chevron open={open} />
          <span className="font-medium text-foreground">{`${rows.length} ${rows.length === 1 ? "file" : "files"}`}</span>
          <span className="ml-auto pe-1 text-xs">{open ? "Hide" : "Show"}</span>
        </Disclosure>
        {newest && changed && (
          <Button variant="ghost" size="xs" onClick={onDiffAll}>
            View all changes
          </Button>
        )}
      </header>
      {open && (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((row) => {
            const Icon = row.kind in KIND_ICONS ? KIND_ICONS[row.kind as keyof typeof KIND_ICONS] : undefined;
            const artifact = row.kind === "page" || row.kind === "motion";
            return (
              <li key={row.shapeId} className="group grid min-h-7 grid-cols-[1rem_1fr_auto] items-center gap-1.5 px-0.5" data-testid="recap-row" data-deleted={row.deleted ? "" : undefined}>
                <span className="inline-flex w-4 text-muted-foreground">{Icon && <Icon aria-hidden className="size-3.5" />}</span>
                <span className="min-w-0 truncate group-data-deleted:text-muted-foreground group-data-deleted:line-through" data-testid="recap-label">
                  {row.label}
                </span>
                {row.deleted ? (
                  <span className="text-xs text-muted-foreground">deleted</span>
                ) : (
                  <span className="inline-flex items-center gap-0.5">
                    {row.rewritten && (
                      <Button variant="ghost" size="xs" onClick={() => onDiff(row.shapeId)}>
                        <FileDiff aria-hidden />
                        View diff
                      </Button>
                    )}
                    {artifact && onOpenEditor && (
                      <Button variant="ghost" size="xs" onClick={() => onOpenEditor(row.shapeId)}>
                        <ExternalLink aria-hidden />
                        Editor
                      </Button>
                    )}
                    {onLocate && (
                      <Tip label="Locate on canvas" side="top">
                        <Button variant="ghost-muted" size="icon-xs" aria-label="Locate on canvas" onClick={() => onLocate(row.shapeId)}>
                          <Crosshair aria-hidden />
                        </Button>
                      </Tip>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {changed && (reverted || !running) && (
        <footer className="flex flex-col items-start gap-1 border-t pt-1.5">
          {reverted ? (
            <span className="px-0.5 text-xs text-muted-foreground" data-testid="recap-reverted">
              Reverted
            </span>
          ) : (
            <Button variant="outline" size="xs" disabled={turn.revertRequestedAt !== undefined} onClick={onRevert}>
              <Undo2 aria-hidden />
              Revert this turn
            </Button>
          )}
          {skipLine && (
            <p className="m-0 px-0.5 text-xs text-muted-foreground" data-testid="recap-skipped">
              {skipLine}
            </p>
          )}
        </footer>
      )}
    </section>
  );
};
