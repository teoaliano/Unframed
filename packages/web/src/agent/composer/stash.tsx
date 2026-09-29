import { Menu } from "@base-ui/react/menu";
import type { ChatAttachment } from "@unframed/contracts";
import { Archive, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { platform } from "../../canvas/platform.ts";
import { itemClass, popupClass } from "../../chrome/ui.tsx";
import type { EngineConnection } from "../../rpc/engine.ts";
import { showNotice } from "../../toasts.tsx";
import { newId } from "../store.ts";

export const STASH_LIMIT = 20;

/** A draft set aside: its text, its chips and its uploaded attachments (the files stay in the data folder). */
export interface StashEntry {
  readonly id: string;
  readonly text: string;
  readonly selection: ReadonlyArray<string>;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly at: string;
}

const isEntry = (value: unknown): value is StashEntry =>
  typeof value === "object" && value !== null && typeof (value as StashEntry).id === "string" && typeof (value as StashEntry).text === "string";

/** The prompt stash of one project, kept as the `agent.stash.<project>` preference, newest first. */
export const useStash = (engine: EngineConnection, project: string) => {
  const key = `agent.stash.${project}`;
  const [entries, setEntries] = useState<ReadonlyArray<StashEntry>>([]);
  const latest = useRef<ReadonlyArray<StashEntry>>([]);
  // Our own writes come back as changes, and not always in order: an echo of one, or any
  // change while one is in flight, is older than what we hold. Only another tab's counts.
  const writing = useRef(0);
  const written = useRef<string[]>([]);
  useEffect(
    () =>
      engine.subscribe("preferences.subscribe", { keys: [key] }, (change) => {
        if (change.key !== key || writing.current > 0 || written.current.includes(JSON.stringify(change.value ?? null))) return;
        latest.current = Array.isArray(change.value) ? change.value.filter(isEntry) : [];
        setEntries(latest.current);
      }),
    [engine, key],
  );
  const save = useCallback(
    (next: ReadonlyArray<StashEntry>) => {
      latest.current = next;
      setEntries(next);
      written.current = [...written.current.slice(-49), JSON.stringify(next.length === 0 ? null : next)];
      writing.current++;
      void engine
        .call("preferences.set", { key, value: next.length === 0 ? null : next })
        .catch(() => undefined)
        .finally(() => writing.current--);
    },
    [engine, key],
  );
  const push = useCallback(
    (entry: Omit<StashEntry, "id" | "at">) => {
      const next = [{ ...entry, id: newId("stash"), at: new Date().toISOString() }, ...latest.current];
      if (next.length > STASH_LIMIT) showNotice("Oldest stashed prompt discarded", "info", `The stash holds ${STASH_LIMIT} prompts; the oldest was removed to make room.`);
      save(next.slice(0, STASH_LIMIT));
    },
    [save],
  );
  const remove = useCallback((id: string) => save(latest.current.filter((entry) => entry.id !== id)), [save]);
  return { entries, push, remove };
};

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export const relativeTime = (at: string, now = Date.now()): string => {
  const seconds = Math.round((Date.parse(at) - now) / 1000);
  if (Math.abs(seconds) < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
};

const snippet = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 90).trimEnd()}…` : flat;
};

/**
 * The Stash badge and its menu (t3code's): each stashed prompt as a snippet and when it was
 * stashed. Enter restores it, Cmd+Backspace deletes it, Escape closes.
 */
export const StashMenu = ({
  entries,
  open,
  onOpenChange,
  onRestore,
  onDelete,
}: {
  readonly entries: ReadonlyArray<StashEntry>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRestore: (entry: StashEntry) => void;
  readonly onDelete: (entry: StashEntry) => void;
}) => {
  const mac = platform() === "darwin";
  return (
    <Menu.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Menu.Trigger
        className="unframed-agent-stash"
        aria-label={`Stashed prompts: ${entries.length}. Open stash.`}
        data-testid="stash-badge"
        data-empty={entries.length === 0 ? "" : undefined}
      >
        <Archive size={12} aria-hidden />
        Stash
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="end" sideOffset={6} className="z-[1100]">
          <Menu.Popup className={`${popupClass} w-[300px]`} aria-label="Stashed prompts">
            {entries.length === 0 ? (
              <p className="m-0 p-2 text-[12.5px] text-secondary">{`Nothing stashed yet. Press ${mac ? "⌘S" : "Ctrl+S"} with a prompt in the composer to stash it.`}</p>
            ) : (
              entries.map((entry) => (
                <Menu.Item
                  key={entry.id}
                  className={`${itemClass} h-auto min-h-8 py-1.5`}
                  onClick={() => onRestore(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && (mac ? event.metaKey : event.ctrlKey)) {
                      event.preventDefault();
                      onDelete(entry);
                    }
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{snippet(entry.text) || "(attachments only)"}</span>
                    <span className="text-[11px] text-secondary">{relativeTime(entry.at)}</span>
                  </span>
                  <button
                    type="button"
                    aria-label="Delete stashed prompt"
                    className="unframed-agent-control unframed-agent-control--icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(entry);
                    }}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </Menu.Item>
              ))
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};
