import { createTypingGuard, TYPING_IDLE_MS, updateTypingGuard, type TypingGuardEvent } from "@unframed/domain";
import { useCallback, useEffect, useState } from "react";

/**
 * The typing guard on a composer (t3code's `useComposerTypingGuard`): the requests it holds
 * back, and the composer's events that feed it. A new `scope` (another chat) starts afresh
 * and keeps only whether the box has focus.
 */
export const useTypingGuard = (scope: string, requestIds: ReadonlyArray<string>) => {
  const requestsKey = JSON.stringify(requestIds);
  const [snapshot, setSnapshot] = useState(() => ({
    scope,
    requestsKey,
    state: updateTypingGuard(createTypingGuard(), { type: "requests", requestIds, now: Date.now() }),
  }));
  if (snapshot.scope !== scope || snapshot.requestsKey !== requestsKey) {
    setSnapshot((current) => ({
      scope,
      requestsKey,
      state: updateTypingGuard(current.scope === scope ? current.state : { ...createTypingGuard(), focused: current.state.focused }, {
        type: "requests",
        requestIds,
        now: Date.now(),
      }),
    }));
  }
  const dispatch = useCallback((event: TypingGuardEvent) => setSnapshot((current) => ({ ...current, state: updateTypingGuard(current.state, event) })), []);
  const { held, lastTypedAt } = snapshot.state;
  useEffect(() => {
    if (held.size === 0) return;
    const timeout = window.setTimeout(() => dispatch({ type: "idle" }), Math.max(0, lastTypedAt + TYPING_IDLE_MS - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [held, lastTypedAt, dispatch]);
  return {
    held,
    onType: useCallback(() => dispatch({ type: "type", now: Date.now() }), [dispatch]),
    onFocus: useCallback(() => dispatch({ type: "focus" }), [dispatch]),
    onBlur: useCallback(() => dispatch({ type: "blur" }), [dispatch]),
    onSend: useCallback(() => dispatch({ type: "send" }), [dispatch]),
  };
};
