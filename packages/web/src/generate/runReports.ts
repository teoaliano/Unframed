import type { RunEvent } from "@unframed/contracts";
import type { EngineConnection } from "../rpc/engine.ts";
import { showError, showNotice } from "../toasts.tsx";

type Finished = Extract<RunEvent, { type: "finished" }>;

/** The run report: `<succeeded> of <count> succeeded.` and the distinct errors, plus results that outlived their placeholder. */
export const runReport = (event: Finished): { readonly message: string; readonly type: "error" | "warning" | "info" } | undefined => {
  const count = event.succeeded + event.failed;
  const parts: string[] = [];
  if (event.failed > 0) parts.push(`${event.succeeded} of ${count} succeeded. ${event.errors.join("; ")}`);
  if (event.orphaned > 0) parts.push(`${event.orphaned} result(s) landed after their placeholder was deleted. The file is in the project folder.`);
  if (parts.length === 0) return undefined;
  const type = event.failed === 0 ? "info" : event.succeeded === 0 ? "error" : "warning";
  return { message: parts.join(" "), type };
};

/** Shows the report of every run of `project` that ends while this tab watches. A full success shows nothing. */
export const watchRunReports = (engine: EngineConnection, project: string): (() => void) =>
  engine.subscribe("run.subscribe", { project }, (event) => {
    if (event.type !== "finished") return;
    const report = runReport(event);
    if (!report) return;
    if (report.type === "error") showError(report.message);
    else showNotice(report.message, report.type);
  });
