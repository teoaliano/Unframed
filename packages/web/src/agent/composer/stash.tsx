import type { ChatAttachment } from "@unframed/contracts";
import { Archive, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { platform } from "../../canvas/platform.ts";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
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
    <Menu open={open} onOpenChange={(next) => onOpenChange(next)}>
      {/* Kept in place while empty, hidden, so the menu opened from the keyboard still has its anchor. */}
      <span className={entries.length === 0 ? "invisible inline-flex w-0 overflow-hidden" : "inline-flex"}>
        <MenuTrigger
          render={<Button variant="outline" size="xs" />}
          aria-label={`Stashed prompts: ${entries.length}. Open stash.`}
          data-testid="stash-badge"
          data-empty={entries.length === 0 ? "" : undefined}
        >
          <Archive aria-hidden />
          Stash
        </MenuTrigger>
      </span>
      <MenuPopup side="top" align="end" sideOffset={6} className="w-[300px]" aria-label="Stashed prompts">
        {entries.length === 0 ? (
          <p className="m-0 px-2 py-1.5 text-xs text-muted-foreground">{`Nothing stashed yet. Press ${mac ? "⌘S" : "Ctrl+S"} with a prompt in the composer to stash it.`}</p>
        ) : (
          entries.map((entry) => (
            <MenuItem
              key={entry.id}
              onClick={() => onRestore(entry)}
              onKeyDown={(event) => {
                if (event.key === "Backspace" && (mac ? event.metaKey : event.ctrlKey)) {
                  event.preventDefault();
                  onDelete(entry);
                }
              }}
            >
              <span className="flex min-w-0 flex-1 flex-col py-0.5">
                <span className="truncate text-foreground/80">{snippet(entry.text) || "(attachments only)"}</span>
                <span className="text-2xs text-muted-foreground tabular-nums">{relativeTime(entry.at)}</span>
              </span>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Delete stashed prompt"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(entry);
                }}
              >
                <Trash2 aria-hidden />
              </Button>
            </MenuItem>
          ))
        )}
      </MenuPopup>
    </Menu>
  );
};
