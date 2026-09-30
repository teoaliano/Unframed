import type { ReactNode } from "react";
import { Alert } from "~/components/ui/alert";

export type StatusKind = "warning" | "info" | "blocked" | "error";

/** The band of status lines under the box. */
export const StatusBand = ({ children }: { readonly children: ReactNode }) => (
  <div className="flex flex-col gap-1.5 px-0.5" data-testid="composer-status">
    {children}
  </div>
);

/**
 * One status line: what stops the send (a blocker, a failed start) is a kit Alert; a
 * warning or a note is muted text, since the run still goes.
 */
export const StatusLine = ({ kind, children }: { readonly kind: StatusKind; readonly children: ReactNode }) => {
  if (kind === "error")
    return (
      <Alert variant="error" data-kind={kind}>
        {children}
      </Alert>
    );
  if (kind === "blocked")
    return (
      <Alert variant="warning" role="status" data-kind={kind}>
        {children}
      </Alert>
    );
  return (
    <p role="status" data-kind={kind} className="m-0 text-xs text-muted-foreground">
      {children}
    </p>
  );
};
