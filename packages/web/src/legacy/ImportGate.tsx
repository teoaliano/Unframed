/**
 * The import from the old app, in the web (spec 11): before a project's canvas mounts,
 * the gate asks whether its folder is being imported. While it is, the canvas's place
 * says so; a failed import says why and offers Try again; once there is a canvas, a
 * report nobody has seen opens in its dialog.
 */
import { Dialog } from "@base-ui/react/dialog";
import { UnframedError, type ImportReport } from "@unframed/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { useEngine } from "../context.ts";
import { reportState, useReportState } from "./reportState.ts";

export const IMPORTING_MESSAGE = "Importing from the old Unframed…";
export const REPORT_TITLE = "Imported from the old Unframed";
export const REPORT_BODY =
  "This project was made with an older version. Its canvas was rebuilt for this one. graph.json and graph.log are still in the project folder, unchanged. Undo history from the old app does not carry over.";

const SECTIONS: ReadonlyArray<{ readonly section: ImportReport["items"][number]["section"]; readonly title: string }> = [
  { section: "changed", title: "Changed" },
  { section: "notKept", title: "Not kept" },
  { section: "missing", title: "Missing files" },
];

type Gate = { readonly kind: "checking" } | { readonly kind: "importing" } | { readonly kind: "failed"; readonly message: string } | { readonly kind: "ready" };

const isImportFailure = (error: unknown): error is UnframedError => error instanceof UnframedError && error.details?.reason === "legacy_import";

/** Calls again for as long as the socket keeps dropping: a drop is not an answer. */
const settled = async <T,>(call: () => Promise<T>): Promise<T> => {
  for (;;) {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof UnframedError && error.details?.reason === "connection_lost")) throw error;
    }
  }
};

const ImportReportDialog = ({ project }: { readonly project: string }) => {
  const engine = useEngine();
  const { project: shown, report, open } = useReportState();
  if (shown !== project || report === null) return null;
  const close = () => {
    reportState.closed();
    void engine.call("legacyImport.markSeen", { project }).catch(() => undefined);
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[900] bg-[var(--unframed-scrim)] backdrop-blur-[10px] backdrop-saturate-[160%]" />
        <Dialog.Popup
          data-testid="import-report"
          className="fixed left-1/2 top-1/2 z-[901] flex max-h-[min(640px,calc(100vh-48px))] w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-border bg-popover p-5 text-foreground shadow-lg outline-none"
        >
          <Dialog.Title className="m-0 text-[16px] font-semibold">{REPORT_TITLE}</Dialog.Title>
          <Dialog.Description className="m-0 text-[13px] text-muted-foreground">{REPORT_BODY}</Dialog.Description>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" data-scrolls="true">
            {SECTIONS.map(({ section, title }) => {
              const items = report.items.filter((item) => item.section === section);
              if (items.length === 0) return null;
              return (
                <section key={section} data-section={section} aria-label={title}>
                  <h3 className="m-0 mb-1 text-[13px] font-semibold">{title}</h3>
                  <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-foreground">
                    {items.map((item, index) => (
                      <li key={index}>{item.text}</li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          <div className="flex justify-end">
            <Dialog.Close className="h-8 cursor-pointer rounded-lg border-0 bg-primary px-3 text-[13px] text-primary-foreground">Got it</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

/** In the canvas's place: the import running, or why it failed and a way to try again. */
const Standing = ({ gate, onRetry }: { readonly gate: Gate; readonly onRetry: () => void }) => (
  <div className="absolute inset-0 flex items-center justify-center p-6" data-import-state={gate.kind}>
    {gate.kind === "importing" && (
      <p role="status" className="m-0 text-[14px] text-muted-foreground">
        {IMPORTING_MESSAGE}
      </p>
    )}
    {gate.kind === "failed" && (
      <div role="alert" className="flex max-w-[520px] flex-col items-center gap-3 text-center">
        <p className="m-0 text-[14px] text-foreground">{gate.message}</p>
        <button type="button" className="h-8 cursor-pointer rounded-lg border-0 bg-primary px-3 text-[13px] text-primary-foreground" onClick={onRetry}>
          Try again
        </button>
      </div>
    )}
  </div>
);

export const ImportGate = ({ project, children }: { readonly project: string; readonly children: ReactNode }) => {
  const engine = useEngine();
  const [gate, setGate] = useState<Gate>({ kind: "checking" });
  // 0 is the first open; each Try again counts one more.
  const [retries, setRetries] = useState(0);

  useEffect(() => {
    let live = true;
    const set = (next: Gate) => live && setGate(next);
    const learned = (report: ImportReport | null) => {
      if (live) reportState.learned(project, report);
    };
    const run = async () => {
      if (retries === 0) {
        const status = await settled(() => engine.call("legacyImport.status", { project })).catch(() => undefined);
        if (status?.state === "failed") return set({ kind: "failed", message: status.message });
        if (status?.state !== "pending") {
          // Nothing to import: the canvas opens now, and the report (if any) is read beside it.
          set({ kind: "ready" });
          void settled(() => engine.call("legacyImport.report", { project })).then(learned, () => undefined);
          return;
        }
      }
      set({ kind: "importing" });
      try {
        // The report's own read runs the import, or waits for the one already running.
        learned(await settled(() => (retries > 0 ? engine.call("legacyImport.retry", { project }) : engine.call("legacyImport.report", { project }))));
        set({ kind: "ready" });
      } catch (error) {
        // Any other failure is the canvas's to show.
        set(isImportFailure(error) ? { kind: "failed", message: error.message } : { kind: "ready" });
      }
    };
    void run();
    return () => {
      live = false;
    };
  }, [engine, project, retries]);

  useEffect(() => () => reportState.forget(project), [project]);

  if (gate.kind !== "ready") {
    return gate.kind === "checking" ? null : <Standing gate={gate} onRetry={() => setRetries((count) => count + 1)} />;
  }
  return (
    <>
      {children}
      <ImportReportDialog project={project} />
    </>
  );
};
