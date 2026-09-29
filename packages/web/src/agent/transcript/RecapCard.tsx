import { recapRows, revertSkipLine, roomShapeId, shapeKind, type ChatActivity, type ChatTurn, type RecapRow, type RecapShape } from "@unframed/domain";
import { ChevronRight, Crosshair, ExternalLink, FileDiff, Undo2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useValue, type Editor, type TLShapeId } from "tldraw";
import { KIND_ICONS } from "../composer/chips.tsx";

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
    <section className="unframed-agent-recap" data-testid="recap-card" aria-label={`Files of turn ${turn.turnCount}`}>
      <header className="unframed-agent-recap__header">
        <button type="button" className="unframed-agent-recap__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronRight size={12} aria-hidden className="unframed-agent-chevron" />
          <span className="unframed-agent-recap__count">{`${rows.length} ${rows.length === 1 ? "file" : "files"}`}</span>
          <span className="unframed-agent-recap__hide">{open ? "Hide" : "Show"}</span>
        </button>
        {newest && changed && (
          <button type="button" className="unframed-agent-button unframed-agent-button--ghost" onClick={onDiffAll}>
            View all changes
          </button>
        )}
      </header>
      {open && (
        <ul className="unframed-agent-recap__rows">
          {rows.map((row) => {
            const Icon = row.kind in KIND_ICONS ? KIND_ICONS[row.kind as keyof typeof KIND_ICONS] : undefined;
            const artifact = row.kind === "page" || row.kind === "motion";
            return (
              <li key={row.shapeId} className="unframed-agent-recap__row" data-testid="recap-row" data-deleted={row.deleted ? "" : undefined}>
                <span className="unframed-agent-recap__icon">{Icon && <Icon size={13} aria-hidden />}</span>
                <span className="unframed-agent-recap__label">{row.label}</span>
                {row.deleted ? (
                  <span className="unframed-agent-recap__deleted">deleted</span>
                ) : (
                  <span className="unframed-agent-recap__actions">
                    {row.rewritten && (
                      <button type="button" className="unframed-agent-button unframed-agent-button--ghost" onClick={() => onDiff(row.shapeId)}>
                        <FileDiff size={13} aria-hidden />
                        View diff
                      </button>
                    )}
                    {artifact && onOpenEditor && (
                      <button type="button" className="unframed-agent-button unframed-agent-button--ghost" onClick={() => onOpenEditor(row.shapeId)}>
                        <ExternalLink size={13} aria-hidden />
                        Open
                      </button>
                    )}
                    {onLocate && (
                      <button type="button" className="unframed-agent-control unframed-agent-control--icon" aria-label="Locate on canvas" title="Locate on canvas" onClick={() => onLocate(row.shapeId)}>
                        <Crosshair size={13} aria-hidden />
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {changed && (reverted || !running) && (
        <footer className="unframed-agent-recap__footer">
          {reverted ? (
            <span className="unframed-agent-recap__reverted">Reverted</span>
          ) : (
            <button type="button" className="unframed-agent-button" disabled={turn.revertRequestedAt !== undefined} onClick={onRevert}>
              <Undo2 size={13} aria-hidden />
              Revert this turn
            </button>
          )}
          {skipLine && <p className="unframed-agent-recap__skipped">{skipLine}</p>}
        </footer>
      )}
    </section>
  );
};
