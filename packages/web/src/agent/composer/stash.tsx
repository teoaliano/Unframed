import type { ChatAttachment, ElementChip } from "@unframed/contracts";
import { stashSnippet } from "@unframed/domain";
import { Bookmark, ChevronDown, File, FileText, Image, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { platform } from "../../canvas/platform.ts";
import { Button } from "~/components/ui/button";
import type { EngineConnection } from "../../rpc/engine.ts";
import { cn } from "~/lib/utils";
import { BANNER } from "./panels.tsx";
import { showNotice } from "../../toasts.tsx";
import { newId } from "../store.ts";

export const STASH_LIMIT = 20;

export interface StashEntry {
  readonly id: string;
  readonly text: string;
  readonly selection: ReadonlyArray<string>;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly elements?: ReadonlyArray<ElementChip>;
  readonly at: string;
}

const isEntry = (value: unknown): value is StashEntry =>
  typeof value === "object" && value !== null && typeof (value as StashEntry).id === "string" && typeof (value as StashEntry).text === "string";

export const useStash = (engine: EngineConnection, project: string) => {
  const key = `agent.stash.${project}`;
  const [entries, setEntries] = useState<ReadonlyArray<StashEntry>>([]);
  const latest = useRef<ReadonlyArray<StashEntry>>([]);
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

export const StashBadge = ({ count, open, pulse, onToggle }: { readonly count: number; readonly open: boolean; readonly pulse: number; readonly onToggle: () => void }) => {
  if (count === 0) return null;
  const pulsed = pulse > 0;
  return (
    <span className={cn(BANNER, "ml-auto w-fit shrink-0 px-0.5 py-0.5")}>
      <Button
        variant="ghost-muted"
        size="xs"
        data-testid="stash-badge"
        data-prompt-stash-badge=""
        data-pressed={open ? "" : undefined}
        aria-label={`Stashed prompts: ${count}. Open stash.`}
        aria-expanded={open}
        onPointerDown={(event) => event.preventDefault()}
        onClick={onToggle}
      >
        <Bookmark aria-hidden className="size-3" />
        <span className={pulsed ? (pulse % 2 === 0 ? "animate-stash-pulse-row-alt motion-reduce:animate-none" : "animate-stash-pulse-row motion-reduce:animate-none") : undefined}>Stash</span>
        <span key={pulse} className={cn("min-w-4 text-center tabular-nums", pulsed && "animate-stash-pulse-count motion-reduce:animate-none")} data-testid="stash-count">
          {count}
        </span>
      </Button>
    </span>
  );
};

export const StashDrawer = ({
  entries,
  box,
  onRestore,
  onDelete,
  onClose,
}: {
  readonly entries: ReadonlyArray<StashEntry>;
  readonly box: () => HTMLElement | null;
  readonly onRestore: (entry: StashEntry) => void;
  readonly onDelete: (entry: StashEntry) => void;
  readonly onClose: () => void;
}) => {
  const mac = platform() === "darwin";
  const drawer = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState<string | null>(entries[0]?.id ?? null);
  const current = entries.find((entry) => entry.id === highlighted) ?? entries[0];
  const latest = useRef({ entries, current, box, onRestore, onDelete, onClose });
  latest.current = { entries, current, box, onRestore, onDelete, onClose };

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if ((drawer.current && event.composedPath().includes(drawer.current)) || (target instanceof Element && target.closest("[data-prompt-stash-badge]"))) return;
      latest.current.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const element = drawer.current;
      const target = event.target;
      if (!element || !(target instanceof Node)) return;
      const inScope =
        target === document.body || (target instanceof Element && target.closest("[data-prompt-stash-badge]") !== null) || element.contains(target) || (latest.current.box()?.contains(target) ?? false);
      if (!inScope) return;
      const { entries: all, current: entry } = latest.current;
      const take = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.key === "Escape") {
        take();
        latest.current.onClose();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (all.length === 0) return;
        take();
        const index = all.findIndex((known) => known.id === entry?.id);
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = ((index >= 0 ? index : step === 1 ? -1 : 0) + step + all.length) % all.length;
        setHighlighted(all[next]?.id ?? null);
        const button = element.querySelectorAll<HTMLButtonElement>("[data-stash-restore]")[next];
        button?.scrollIntoView({ block: "nearest" });
        if (element.contains(document.activeElement)) button?.focus({ preventScroll: true });
      } else if (event.key === "Enter") {
        if (target instanceof HTMLElement && target.closest("[data-stash-delete]")) return;
        if (!entry) return;
        take();
        latest.current.onRestore(entry);
      } else if (event.key === "Backspace" && (mac ? event.metaKey : event.ctrlKey)) {
        if (!entry) return;
        take();
        latest.current.onDelete(entry);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [mac]);

  return (
    <div ref={drawer} className={cn(BANNER, "gap-0.5 px-1 py-1 transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none")} data-testid="stash-drawer">
      <Button
        variant="ghost-muted"
        size="xs"
        className="w-full justify-start"
        aria-label="Close stash"
        aria-expanded="true"
        onPointerDown={(event) => event.preventDefault()}
        onClick={onClose}
      >
        <Bookmark aria-hidden className="size-3" />
        <span className="flex-1">Stash</span>
        <span className="font-medium tabular-nums">{entries.length}</span>
        <ChevronDown aria-hidden className="size-3.5" />
      </Button>
      <ul role="list" aria-label="Stashed prompts" className="m-0 grid max-h-[min(24rem,40dvh)] list-none grid-cols-1 gap-px overflow-y-auto p-0">
        {entries.length === 0 ? (
          <li className="px-2 py-1 text-xs text-muted-foreground">{`Nothing stashed yet. Press ${mac ? "⌘S" : "Ctrl+S"} with a prompt in the composer to stash it.`}</li>
        ) : (
          entries.map((entry) => {
            const pointed = entry.elements?.length ?? 0;
            const snippet = entry.text.trim() === "" && entry.attachments.length === 0 && pointed > 0 ? `(${pointed} element${pointed === 1 ? "" : "s"})` : stashSnippet(entry.text, entry.attachments);
            const images = entry.attachments.filter((item) => item.kind === "image").length;
            const files = entry.attachments.length - images;
            const lit = current?.id === entry.id;
            return (
              <li
                key={entry.id}
                className={cn("flex min-h-6 items-center gap-1.5 rounded-sm ps-2 text-xs", lit && "bg-accent text-accent-foreground")}
                data-stash-entry={entry.id}
                data-highlighted={lit ? "" : undefined}
                onMouseMove={() => {
                  if (highlighted !== entry.id) setHighlighted(entry.id);
                }}
                onFocus={() => setHighlighted(entry.id)}
              >
                <FileText aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <Button
                  variant="ghost"
                  size="xs"
                  className="min-w-0 flex-1 justify-start"
                  data-stash-restore={entry.id}
                  aria-label={`Restore stashed prompt: ${snippet}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => onRestore(entry)}
                >
                  <span className="min-w-0 flex-1 truncate text-start font-normal text-foreground/80">{snippet}</span>
                </Button>
                {images > 0 && (
                  <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground" aria-label={`${images} image${images === 1 ? "" : "s"}`}>
                    <Image aria-hidden className="size-3" />
                    {images}
                  </span>
                )}
                {files > 0 && (
                  <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground" aria-label={`${files} file${files === 1 ? "" : "s"}`}>
                    <File aria-hidden className="size-3" />
                    {files}
                  </span>
                )}
                <time dateTime={entry.at} className="shrink-0 text-muted-foreground tabular-nums">
                  {relativeTime(entry.at)}
                </time>
                <Button
                  variant="ghost-muted"
                  size="icon-xs"
                  aria-label="Delete stashed prompt"
                  data-stash-delete=""
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => onDelete(entry)}
                >
                  <X aria-hidden />
                </Button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
};
