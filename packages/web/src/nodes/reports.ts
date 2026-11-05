import type { EngineConnection } from "../rpc/engine.ts";
import { showError, showNotice } from "../toasts.tsx";

export const chainReport = (ran: number, total: number, errors: ReadonlyArray<string>): { readonly message: string; readonly type: "error" | "warning" } | undefined => {
  if (ran === total) return undefined;
  return { message: `Chain: ${ran} of ${total} nodes ran. ${errors.join("; ")}`.trim(), type: ran === 0 ? "error" : "warning" };
};

export const watchChainReports = (engine: EngineConnection, project: string): (() => void) =>
  engine.subscribe("run.subscribe", { project }, (event) => {
    if (event.type !== "chainFinished") return;
    const report = chainReport(event.ran, event.total, event.errors);
    if (!report) return;
    if (report.type === "error") showError(report.message);
    else showNotice(report.message, "warning");
  });
