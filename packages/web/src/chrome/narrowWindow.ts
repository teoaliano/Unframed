import { useSyncExternalStore } from "react";

const NARROW_QUERY = "(max-width: 1279px)";

export const useNarrowWindow = (): boolean =>
  useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(NARROW_QUERY);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
  );
