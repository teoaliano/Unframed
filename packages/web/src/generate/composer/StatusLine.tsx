import { NO_KEY_MESSAGE } from "@unframed/domain";
import type { ReactNode } from "react";
import { Alert, AlertAction, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { openSettings } from "../../settings/settingsEvents.ts";

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
export const NoKeyLine = ({ message }: { readonly message?: string | undefined }) => (
  <Alert variant="warning" role="status" data-kind="blocked" data-testid="no-key-blocker">
    <AlertTitle>{message ?? NO_KEY_MESSAGE}</AlertTitle>
    <AlertAction>
      <Button size="xs" variant="outline" onClick={() => openSettings("generation")}>
        Open Settings
      </Button>
    </AlertAction>
  </Alert>
);

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
    <p role="status" data-kind={kind} className="m-0 text-xs text-(--generate-tray-note)">
      {children}
    </p>
  );
};
