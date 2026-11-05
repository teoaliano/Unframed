import { watch, type FSWatcher } from "node:fs";
import { errorText, logError } from "../log.ts";

const QUIET_MS = 1000;
const LONGEST_MS = 5000;

export const watchFolder = (folder: string, onChange: (names: ReadonlyArray<string>) => void): (() => void) => {
  const pending = new Set<string>();
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let longest: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  const flush = () => {
    clearTimeout(quiet);
    clearTimeout(longest);
    quiet = undefined;
    longest = undefined;
    const names = [...pending];
    pending.clear();
    onChange(names);
  };
  try {
    watcher = watch(folder, { persistent: false }, (_event, name) => {
      if (name === null || name.startsWith(".")) return;
      pending.add(name);
      clearTimeout(quiet);
      quiet = setTimeout(flush, QUIET_MS);
      longest ??= setTimeout(flush, LONGEST_MS);
    });
    watcher.on("error", (error) => logError(`could not watch ${folder}: ${errorText(error)}`));
  } catch (error) {
    logError(`could not watch ${folder}: ${errorText(error)}`);
  }
  return () => {
    clearTimeout(quiet);
    clearTimeout(longest);
    watcher?.close();
  };
};
