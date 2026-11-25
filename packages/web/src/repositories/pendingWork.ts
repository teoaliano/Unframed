import { useState } from "react";
import { messageOf } from "../agent/store.ts";

export const usePendingWork = () => {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const run = (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setProblem(undefined);
    work()
      .catch((error: unknown) => setProblem(messageOf(error)))
      .finally(() => setBusy(false));
  };
  return { busy, problem, setProblem, run };
};
