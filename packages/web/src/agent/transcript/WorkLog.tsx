import { formatWorkDuration, type SubagentRow, type WorkEntry, type WorkGroup, type WorkRow } from "@unframed/domain";
import { Ban, Check, ChevronRight, CircleAlert, LoaderCircle, Square, Users } from "lucide-react";
import { useState } from "react";

const StateIcon = ({ state, tone }: { readonly state: WorkRow["state"]; readonly tone: WorkRow["tone"] }) => {
  if (tone === "error" || state === "failed") return <CircleAlert size={12} aria-label="Failed" className="text-error" />;
  if (state === "inProgress") return <LoaderCircle size={12} aria-label="In progress" className="animate-spin" />;
  if (state === "declined") return <Ban size={12} aria-label="Declined" />;
  if (state === "stopped") return <Square size={10} aria-label="Stopped" />;
  return <Check size={12} aria-label="Completed" />;
};

/** One tool call: its label and state; one with a command, detail, files or image opens with a chevron. */
export const WorkRowView = ({ row }: { readonly row: WorkRow }) => {
  const [open, setOpen] = useState(false);
  const expandable = row.command !== undefined || row.detail !== undefined || (row.changedFiles?.length ?? 0) > 1 || row.image !== undefined;
  return (
    <div className="unframed-agent-work-row" data-state={row.state} data-tone={row.tone} data-testid="work-row">
      <button type="button" className="unframed-agent-work-row__head" aria-expanded={expandable ? open : undefined} disabled={!expandable} onClick={() => setOpen(!open)}>
        {expandable ? <ChevronRight size={12} aria-hidden className="unframed-agent-chevron" /> : <span className="unframed-agent-chevron-slot" />}
        <StateIcon state={row.state} tone={row.tone} />
        <span className="unframed-agent-work-row__label">{row.label}</span>
      </button>
      {open && (
        <div className="unframed-agent-work-row__body">
          {row.command !== undefined && <pre className="unframed-agent-work-row__command">{row.command}</pre>}
          {row.detail !== undefined && <p className="unframed-agent-work-row__detail">{row.detail}</p>}
          {(row.changedFiles?.length ?? 0) > 1 && (
            <ul className="unframed-agent-work-row__files">
              {row.changedFiles!.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          )}
          {row.image !== undefined && <p className="unframed-agent-work-row__detail">{row.image}</p>}
        </div>
      )}
    </div>
  );
};

/** Consecutive calls folded behind the sentence that counts them. */
const WorkGroupView = ({ group }: { readonly group: WorkGroup }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="unframed-agent-work-group" data-testid="work-group">
      <button type="button" className="unframed-agent-work-group__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={12} aria-hidden className="unframed-agent-chevron" />
        <span>{group.summary}</span>
      </button>
      {open && (
        <div className="unframed-agent-work-group__rows">
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
    <div className="unframed-agent-work-group" data-testid="subagents">
      <button type="button" className="unframed-agent-work-group__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={12} aria-hidden className="unframed-agent-chevron" />
        <Users size={12} aria-hidden />
        <span>{entry.label}</span>
        <span className="unframed-agent-work-group__status">{entry.status}</span>
      </button>
      {open && (
        <ul className="unframed-agent-subagents">
          {entry.tasks.map((task) => (
            <li key={task.taskId} data-state={task.state}>
              <StateIcon state={task.state === "working" ? "inProgress" : task.state} tone="tool" />
              <span className="flex-1">{task.title}</span>
              <span className="unframed-agent-work-group__status">
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
  <div className="unframed-agent-work">
    {entries.map((entry) =>
      entry.kind === "group" ? <WorkGroupView key={entry.id} group={entry} /> : entry.kind === "subagents" ? <SubagentsView key={entry.id} entry={entry} /> : <WorkRowView key={entry.id} row={entry} />,
    )}
  </div>
);
