import { UnframedError } from "@unframed/contracts";
import type { ProviderKey } from "@unframed/domain";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

export interface KeyRemoval {
  readonly confirming: boolean;
  readonly busy: boolean;
  readonly warning: string | undefined;
  readonly press: () => Promise<void>;
  readonly reset: () => void;
  readonly typed: () => void;
}

export const useKeyRemoval = (provider: ProviderKey, remove: () => Promise<void>, onError: (message: string) => void): KeyRemoval => {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string>();
  const reset = () => {
    setConfirming(false);
    setWarning(undefined);
  };
  return {
    confirming,
    busy,
    warning,
    reset,
    typed: () => {
      if (confirming) reset();
    },
    press: async () => {
      if (!confirming) {
        setConfirming(true);
        setWarning(provider.removeWarning);
        return;
      }
      setBusy(true);
      try {
        await remove();
        setWarning(provider.removedLine);
      } catch (error) {
        setWarning(undefined);
        onError(messageOf(error));
      } finally {
        setConfirming(false);
        setBusy(false);
      }
    },
  };
};

export const RemoveKeyButton = ({ removal }: { readonly removal: KeyRemoval }) => (
  <Button variant={removal.confirming ? "destructive" : "ghost"} aria-busy={removal.busy || undefined} disabled={removal.busy} onClick={() => void removal.press()}>
    {removal.busy && <Spinner aria-hidden />}
    {removal.confirming ? "Yes, remove it" : "Remove key"}
  </Button>
);

export const KeyWarning = ({ removal, testId }: { readonly removal: KeyRemoval; readonly testId: string }) =>
  removal.warning === undefined ? null : (
    <p className="m-0 text-xs text-destructive-foreground" data-testid={testId}>
      {removal.warning}
    </p>
  );
