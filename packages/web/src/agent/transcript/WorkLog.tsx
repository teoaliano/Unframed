import { formatWorkDuration, type SubagentRow, type WorkEntry, type WorkGroup, type WorkRow } from "@unframed/domain";
import { Ban, Check, ChevronRight, CircleAlert, Layers, LoaderCircle, Square, Users } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";

/** t3code's timeline row: a quiet row that highlights on hover, its icon in a 24 px slot. */
const ROW_CLASS =
  "group/timeline-row relative flex min-h-6 w-full min-w-0 select-none items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-sm leading-relaxed transition-colors duration-150";
const TOGGLE_CLASS = "cursor-pointer hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70";

/**
 * A row that opens and closes what is under it. t3code's rows are buttons by role, not
 * `<button>`, so a row can hold its own layout; Enter and Space toggle it.
 */
export const Disclosure = ({
  open,
  onToggle,
  className,
  testId,
  children,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly className: string;
  readonly testId?: string;
  readonly children: ReactNode;
}) => (
  <div
    role="button"
    data-testid={testId}
    tabIndex={0}
    aria-expanded={open}
    className={className}
    onClick={onToggle}
    onKeyDown={(event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onToggle();
    }}
  >
    {children}
  </div>
);

/** The chevron at the end of a timeline row, turning a quarter when it opens. */
export const Chevron = ({ open, hidden = false }: { readonly open: boolean; readonly hidden?: boolean }) => (
  <span className={hidden ? "invisible flex size-4 shrink-0 items-center justify-center" : "flex size-4 shrink-0 items-center justify-center"} aria-hidden>
    <ChevronRight className={open ? "size-3 shrink-0 rotate-90 text-icon-muted opacity-70 transition-transform duration-200 motion-reduce:transition-none" : "size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200 motion-reduce:transition-none"} />
  </span>
);

/** A row's icon slot. */
export const IconSlot = ({ children, tone = "muted" }: { readonly children: ReactNode; readonly tone?: "muted" | "error" }) => (
  <span className={tone === "error" ? "flex size-6 shrink-0 items-center justify-center text-destructive" : "flex size-6 shrink-0 items-center justify-center text-icon-muted"}>{children}</span>
);

/** Where an opened row's detail sits: under the label, on the muted fill. */
const BODY_CLASS = "ms-7 mt-1 mb-1 cursor-default rounded-md bg-muted/40 px-3 py-2";

const StateIcon = ({ state, tone }: { readonly state: WorkRow["state"]; readonly tone: WorkRow["tone"] }) => {
  if (tone === "error" || state === "failed") return <CircleAlert aria-label="Failed" className="size-4 shrink-0" />;
  if (state === "inProgress") return <LoaderCircle aria-label="In progress" className="size-4 shrink-0 animate-spin" />;
  if (state === "declined") return <Ban aria-label="Declined" className="size-4 shrink-0" />;
  if (state === "stopped") return <Square aria-label="Stopped" className="size-3.5 shrink-0" />;
  return <Check aria-label="Completed" className="size-4 shrink-0" />;
};

/** One tool call: its label and state; one with a command, detail, files or image opens with a chevron. */
export const WorkRowView = ({ row }: { readonly row: WorkRow }) => {
  const [open, setOpen] = useState(false);
  const expandable = row.command !== undefined || row.detail !== undefined || (row.changedFiles?.length ?? 0) > 1 || row.image !== undefined;
  const failed = row.tone === "error" || row.state === "failed";
  const head = (
    <>
      <IconSlot tone={failed ? "error" : "muted"}>
        <StateIcon state={row.state} tone={row.tone} />
      </IconSlot>
      <span className={failed ? "min-w-0 flex-1 truncate font-medium text-destructive-foreground" : "min-w-0 flex-1 truncate text-secondary-label"} data-testid="work-row-label">
        {row.label}
      </span>
      <Chevron open={open} hidden={!expandable} />
    </>
  );
  return (
    <div className="flex flex-col" data-state={row.state} data-tone={row.tone} data-testid="work-row">
      {expandable ? (
        <Disclosure open={open} onToggle={() => setOpen(!open)} className={`${ROW_CLASS} ${TOGGLE_CLASS}`}>
          {head}
        </Disclosure>
      ) : (
        <div className={ROW_CLASS}>{head}</div>
      )}
      {open && (
        <div className={BODY_CLASS} data-testid="work-row-body">
          {row.command !== undefined && (
            <pre className="m-0 max-h-64 overflow-auto font-mono text-2xs leading-relaxed whitespace-pre-wrap break-words text-secondary-label select-text" data-testid="work-row-command">
              {row.command}
            </pre>
          )}
          {row.detail !== undefined && <p className="m-0 text-xs whitespace-pre-wrap text-muted-foreground">{row.detail}</p>}
          {(row.changedFiles?.length ?? 0) > 1 && (
            <ul className="m-0 list-none p-0 font-mono text-2xs leading-relaxed text-secondary-label">
              {row.changedFiles!.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          )}
          {row.image !== undefined && <p className="m-0 text-xs whitespace-pre-wrap text-muted-foreground">{row.image}</p>}
        </div>
      )}
    </div>
  );
};

/** Consecutive calls folded behind the sentence that counts them. */
const WorkGroupView = ({ group }: { readonly group: WorkGroup }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col" data-testid="work-group">
      <Disclosure open={open} onToggle={() => setOpen(!open)} className={`${ROW_CLASS} ${TOGGLE_CLASS}`}>
        <IconSlot>
          <Layers className="size-4 shrink-0" aria-hidden />
        </IconSlot>
        <span className="min-w-0 flex-1 truncate text-secondary-label">{group.summary}</span>
        <Chevron open={open} />
      </Disclosure>
      {open && (
        <div className="flex flex-col gap-px ps-3">
          {group.rows.map((row) => (
            <WorkRowView key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
};

/** One row per spawn of sub-agents; it opens to each one's state and duration. */
const SubagentsView = ({ entry }: { readonly entry: SubagentRow }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col" data-testid="subagents">
      <Disclosure open={open} onToggle={() => setOpen(!open)} className={`${ROW_CLASS} ${TOGGLE_CLASS}`}>
        <IconSlot>
          <Users className="size-4 shrink-0" aria-hidden />
        </IconSlot>
        <span className="min-w-0 flex-1 truncate text-secondary-label">{entry.label}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{entry.status}</span>
        <Chevron open={open} />
      </Disclosure>
      {open && (
        <ul className={`${BODY_CLASS} m-0 flex list-none flex-col gap-1 text-xs text-muted-foreground`}>
          {entry.tasks.map((task) => (
            <li key={task.taskId} className="flex min-h-5 items-center gap-1.5" data-state={task.state}>
              <span className="flex size-4 shrink-0 items-center justify-center text-icon-muted">
                <StateIcon state={task.state === "working" ? "inProgress" : task.state} tone="tool" />
              </span>
              <span className="min-w-0 flex-1 truncate text-secondary-label">{task.title}</span>
              <span className="shrink-0 tabular-nums">
                {task.state === "working" ? "working" : task.state}
                {task.durationMs !== undefined ? ` · ${formatWorkDuration(task.durationMs)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const WorkEntries = ({ entries }: { readonly entries: ReadonlyArray<WorkEntry> }) => (
  <section className="-mx-1 flex flex-col gap-px px-1 py-0.5" aria-label="Activity">
    {entries.map((entry) =>
      entry.kind === "group" ? <WorkGroupView key={entry.id} group={entry} /> : entry.kind === "subagents" ? <SubagentsView key={entry.id} entry={entry} /> : <WorkRowView key={entry.id} row={entry} />,
    )}
  </section>
);

export { BODY_CLASS, ROW_CLASS, TOGGLE_CLASS };
