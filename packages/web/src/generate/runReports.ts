import type { RunEvent } from "@unframed/contracts";
import type { EngineConnection } from "../rpc/engine.ts";
import { showError, showNotice } from "../toasts.tsx";

type Finished = Extract<RunEvent, { type: "finished" }>;

/**
 * The run report: `<succeeded> of <count> succeeded.` and the distinct errors, plus results
 * that outlived their placeholder. A Free batch's notes (spec 05) follow the outcome line,
 * or stand alone as an info report when every output succeeded.
 */
export const runReport = (event: Finished, notes = ""): { readonly message: string; readonly type: "error" | "warning" | "info" } | undefined => {
  const count = event.succeeded + event.failed;
  const parts: string[] = [];
  if (event.failed > 0) parts.push(`${event.succeeded} of ${count} succeeded. ${event.errors.join("; ")}`);
  if (notes !== "") parts.push(notes);
  if (event.orphaned > 0) parts.push(`${event.orphaned} result(s) landed after their placeholder was deleted. The file is in the project folder.`);
  if (parts.length === 0) return undefined;
  const type = event.failed === 0 ? "info" : event.succeeded === 0 ? "error" : "warning";
  return { message: parts.join(" "), type };
};

/** Notes to show with the report of the batch they belong to, set before its run is sent. */
const batchNotes = new Map<string, string>();

export const noteBatch = (batchId: string, notes: string): void => {
  if (notes !== "") batchNotes.set(batchId, notes);
};

/** Shows the report of every run of `project` that ends while this tab watches. A full success shows nothing. */
export const watchRunReports = (engine: EngineConnection, project: string): (() => void) => {
  const batchOf = new Map<string, string>();
  return engine.subscribe("run.subscribe", { project }, (event) => {
    if (event.type === "started") batchOf.set(event.runId, event.batchId);
    if (event.type !== "finished") return;
    const batchId = batchOf.get(event.runId);
    batchOf.delete(event.runId);
    const notes = batchId === undefined ? undefined : batchNotes.get(batchId);
    if (batchId !== undefined) batchNotes.delete(batchId);
    const report = runReport(event, notes);
    if (!report) return;
    if (report.type === "error") showError(report.message);
    else showNotice(report.message, report.type);
  });
};
