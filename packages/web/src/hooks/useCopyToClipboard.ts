import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The part of t3code's copy hook the UI kit uses (the toast's Copy error button): write
 * text to the clipboard and report "copied" for `timeout` ms.
 */
export function useCopyToClipboard({ timeout = 2000 }: { timeout?: number; target?: string } = {}): {
  copyToClipboard: (value: string) => void;
  isCopied: boolean;
} {
  const [isCopied, setIsCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  const copyToClipboard = useCallback(
    (value: string) => {
      void navigator.clipboard?.writeText(value).then(() => {
        setIsCopied(true);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setIsCopied(false), timeout);
      });
    },
    [timeout],
  );
  return { copyToClipboard, isCopied };
}
