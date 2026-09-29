/**
 * The import report of the active project (spec 11), shared by the canvas's import gate,
 * which learns it, and the project menu, whose "Import report" opens it again.
 */
import type { ImportReport } from "@unframed/contracts";
import { useSyncExternalStore } from "react";

export interface ReportState {
  readonly project: string | undefined;
  /** `null` for a project that was never imported. */
  readonly report: ImportReport | null;
  /** Whether the report dialog is showing. */
  readonly open: boolean;
}

let state: ReportState = { project: undefined, report: null, open: false };
const listeners = new Set<() => void>();

const set = (next: ReportState) => {
  state = next;
  for (const listener of listeners) listener();
};

export const reportState = {
  get: (): ReportState => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /** What the gate learned for `project`: the dialog opens by itself on a report nobody has seen. */
  learned: (project: string, report: ImportReport | null) => set({ project, report, open: report !== null && !report.seen }),
  open: () => {
    if (state.report !== null) set({ ...state, open: true });
  },
  closed: () => set({ ...state, open: false, report: state.report === null ? null : { ...state.report, seen: true } }),
  forget: (project: string) => {
    if (state.project === project) set({ project: undefined, report: null, open: false });
  },
};

export const useReportState = (): ReportState => useSyncExternalStore(reportState.subscribe, reportState.get);
