import { watch, type FSWatcher } from "node:fs";
import { sep } from "node:path";
import { errorText, logError } from "../log.ts";

const SETTLE_MS = 250;

const hidden = (name: string) => name.split(sep).some((part) => part.startsWith("."));

export const watchFolder = (folder: string, onChange: (names: ReadonlyArray<string>) => void): (() => void) => {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  const flush = () => {
    timer = undefined;
    const names = [...pending];
    pending.clear();
    onChange(names);
  };
  try {
    watcher = watch(folder, { recursive: true, persistent: false }, (_event, name) => {
      if (name === null || hidden(name)) return;
      pending.add(name.split(sep).join("/"));
      timer ??= setTimeout(flush, SETTLE_MS);
    });
    watcher.on("error", (error) => logError(`could not watch ${folder}: ${errorText(error)}`));
  } catch (error) {
    logError(`could not watch ${folder}: ${errorText(error)}`);
  }
  return () => {
    clearTimeout(timer);
    watcher?.close();
  };
};
