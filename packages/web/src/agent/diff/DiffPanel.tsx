import type { ArtifactDiffFile } from "@unframed/contracts";
import type { Chat } from "@unframed/domain";
import { PatchDiff } from "@pierre/diffs/react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { ChevronDown, Columns2, Pilcrow, Rows3, TextWrap, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { Toggle } from "~/components/ui/toggle";
import { Toggle as GroupToggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tip } from "../../chrome/ui.tsx";
import { DIFF_SURFACE_CSS } from "../../theme/diffs.ts";
import { messageOf } from "../send.ts";
import type { ChatClient, RailUi } from "../store.ts";

const LAYOUT_PREFERENCE = "agent.diffLayout";

type Layout = "stacked" | "split";
type Scope = number | "all";

/** Turns that have finished, oldest first: only they have a diff. */
const completedTurns = (chat: Chat) => chat.turns.filter((turn) => turn.state !== "running").sort((a, b) => a.turnCount - b.turnCount);

const POOL = { workerFactory: () => new DiffsWorker(), poolSize: 2 };
const HIGHLIGHTER = { theme: { dark: "pierre-dark", light: "pierre-light" }, langs: ["html" as const] };

/** The layout, remembered as the `agent.diffLayout` preference. */
const useLayout = (client: ChatClient): [Layout, (next: Layout) => void] => {
  const [layout, setLayout] = useState<Layout>("stacked");
  useEffect(() => {
    let live = true;
    client.engine
      .call("preferences.get", { keys: [LAYOUT_PREFERENCE] })
      .then(({ values }) => {
        if (live) setLayout(values[LAYOUT_PREFERENCE] === "split" ? "split" : "stacked");
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client]);
  return [
    layout,
    (next) => {
      setLayout(next);
      void client.engine.call("preferences.set", { key: LAYOUT_PREFERENCE, value: next }).catch(() => undefined);
    },
  ];
};

type Loaded = { readonly key: string; readonly files: ReadonlyArray<ArtifactDiffFile> } | { readonly key: string; readonly error: string };

/**
 * The diff panel (t3code's): the pages and motions a turn, or the whole chat, rewrote.
 * A scope menu, the changed files down the side, each patch rendered by `@pierre/diffs`
 * in a worker. Read-only: taking a change back is Revert.
 */
export const DiffPanel = ({ client, chat, diff }: { readonly client: ChatClient; readonly chat: Chat; readonly diff: NonNullable<RailUi["diff"]> }) => {
  const [layout, setLayout] = useLayout(client);
  const [wrap, setWrap] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>();
  const root = useRef<HTMLElement>(null);
  const turns = completedTurns(chat);
  const latest = turns.at(-1);
  const scope: Scope = diff.turnCount;
  const close = () => client.setUi({ diff: undefined });
  const choose = (next: Scope) => client.setUi({ diff: { threadId: chat.id, turnCount: next } });

  const key = latest ? `${chat.id}:${String(scope)}:${latest.turnCount}:${ignoreWhitespace}` : "";
  useEffect(() => {
    if (!latest) return;
    let live = true;
    const request =
      scope === "all"
        ? client.engine.call("orchestration.getFullThreadDiff", { projectId: client.project, threadId: chat.id, toTurnCount: latest.turnCount, ignoreWhitespace })
        : client.engine.call("orchestration.getTurnDiff", { projectId: client.project, threadId: chat.id, fromTurnCount: scope - 1, toTurnCount: scope, ignoreWhitespace });
    request.then(
      (answer) => live && setLoaded({ key, files: answer.files }),
      (error: unknown) => live && setLoaded({ key, error: messageOf(error) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => root.current?.focus(), []);
  const current = loaded?.key === key ? loaded : undefined;
  const files = current && "files" in current ? current.files : undefined;

  // Opened from a row's View diff: that artifact's patch comes into view.
  useEffect(() => {
    if (!files || diff.shapeId === undefined) return;
    root.current?.querySelector(`[data-diff-file="${CSS.escape(diff.shapeId)}"]`)?.scrollIntoView({ block: "start" });
  }, [files, diff.shapeId]);

  const scopeLabel = scope === "all" ? "All turns" : latest && scope === latest.turnCount ? "Latest turn" : `Turn ${scope}`;
  const wrapLabel = wrap ? "Disable line wrapping" : "Enable line wrapping";
  const whitespaceLabel = ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes";
  return (
    // t3code's diff panel shell, beside the rail on its left and as tall as it.
    <section
      ref={root}
      className="absolute top-0 left-[calc(100%+8px)] bottom-0 flex w-[min(760px,calc(100vw-540px))] min-w-0 flex-col overflow-hidden rounded-xl border bg-background text-sm shadow-lg/5 outline-none"
      role="dialog"
      aria-label="Changes"
      tabIndex={-1}
      data-testid="diff-panel"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        close();
      }}
    >
      <header className="flex h-10 min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background px-2">
        <Menu>
          <MenuTrigger render={<Button variant="secondary" size="xs" className="max-w-full" />} aria-label={`Diff scope: ${scopeLabel}`} disabled={!latest}>
            <span className="truncate">{scopeLabel}</span>
            <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-70" />
          </MenuTrigger>
          <MenuPopup side="bottom" align="start">
            <MenuRadioGroup value={scope === "all" ? "all" : latest && scope === latest.turnCount ? "latest" : `turn:${scope}`}>
              {latest && (
                <MenuRadioItem value="latest" closeOnClick onClick={() => choose(latest.turnCount)}>
                  Latest turn
                </MenuRadioItem>
              )}
              {turns.map((turn) => (
                <MenuRadioItem key={turn.turnId} value={`turn:${turn.turnCount}`} closeOnClick onClick={() => choose(turn.turnCount)}>
                  {`Turn ${turn.turnCount}`}
                </MenuRadioItem>
              ))}
              <MenuRadioItem value="all" closeOnClick onClick={() => choose("all")}>
                All turns
              </MenuRadioItem>
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
        <div className="flex shrink-0 items-center gap-1">
          <ToggleGroup
            aria-label="Diff layout"
            className="shrink-0"
            variant="segmented"
            value={[layout]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "stacked" || next === "split") setLayout(next);
            }}
          >
            <GroupToggle aria-label="Stacked diff view" value="stacked">
              <Rows3 aria-hidden className="size-3.5" />
            </GroupToggle>
            <GroupToggle aria-label="Split diff view" value="split">
              <Columns2 aria-hidden className="size-3.5" />
            </GroupToggle>
          </ToggleGroup>
          <Tip label={wrapLabel} side="bottom">
            <Toggle variant="ghost" size="sm" aria-label={wrapLabel} pressed={wrap} onPressedChange={(pressed) => setWrap(pressed)}>
              <TextWrap aria-hidden className="size-3.5" />
            </Toggle>
          </Tip>
          <Tip label={whitespaceLabel} side="bottom">
            <Toggle variant="ghost" size="sm" aria-label={whitespaceLabel} pressed={ignoreWhitespace} onPressedChange={(pressed) => setIgnoreWhitespace(pressed)}>
              <Pilcrow aria-hidden className="size-3.5" />
            </Toggle>
          </Tip>
          <Tip label="Close" side="bottom">
            <Button variant="ghost" size="icon-sm" aria-label="Close diff" onClick={close}>
              <X aria-hidden />
            </Button>
          </Tip>
        </div>
      </header>
      {!latest ? (
        <p className={EMPTY_CLASS}>No completed turns yet.</p>
      ) : current && "error" in current ? (
        <p className={EMPTY_CLASS} role="alert">
          {current.error}
        </p>
      ) : !files ? (
        <p className={EMPTY_CLASS} role="status">
          Loading changes…
        </p>
      ) : files.length === 0 ? (
        <p className={EMPTY_CLASS}>No page or motion changed in this selection.</p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-45 shrink-0 flex-col gap-px overflow-auto border-r border-border/60 p-1.5" aria-label="Changed files">
            {files.map((file) => (
              <Button
                key={file.shapeId}
                variant="ghost"
                size="sm"
                className="w-full"
                aria-current={diff.shapeId === file.shapeId ? "true" : undefined}
                data-pressed={diff.shapeId === file.shapeId ? "" : undefined}
                onClick={() => {
                  client.setUi({ diff: { ...diff, shapeId: file.shapeId } });
                  root.current?.querySelector(`[data-diff-file="${CSS.escape(file.shapeId)}"]`)?.scrollIntoView({ block: "start" });
                }}
              >
                <span className="min-w-0 flex-1 truncate text-left">{file.label}</span>
                <DiffStat additions={file.additions} deletions={file.deletions} />
              </Button>
            ))}
          </nav>
          <WorkerPoolContextProvider poolOptions={POOL} highlighterOptions={HIGHLIGHTER}>
            <div className="min-w-0 flex-1 overflow-auto">
              {files.map((file) => (
                <article key={file.shapeId} className="border-border/60 not-first:border-t" data-diff-file={file.shapeId} aria-label={file.label}>
                  <header className="sticky top-0 z-1 flex h-8 items-center gap-2 border-b border-border/60 bg-background px-3">
                    <span className="min-w-0 truncate text-sm font-medium">{file.label}</span>
                    <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground" data-testid="diff-names">{`${file.before ?? "new"} → ${file.after ?? "removed"}`}</span>
                  </header>
                  {file.tooLarge ? (
                    <p className={EMPTY_CLASS}>{file.patch}</p>
                  ) : (
                    <PatchDiff
                      patch={file.patch}
                      options={{
                        diffStyle: layout === "split" ? "split" : "unified",
                        overflow: wrap ? "wrap" : "scroll",
                        disableFileHeader: true,
                        themeType: "system",
                        theme: HIGHLIGHTER.theme,
                        lineDiffType: "none",
                        unsafeCSS: DIFF_SURFACE_CSS,
                      }}
                    />
                  )}
                </article>
              ))}
            </div>
          </WorkerPoolContextProvider>
        </div>
      )}
    </section>
  );
};

/** t3code's empty and loading lines in the diff panel. */
const EMPTY_CLASS = "m-0 flex flex-1 items-center justify-center px-5 py-6 text-center text-xs text-muted-foreground/70";

/** Added and removed line counts, in t3code's diff colours. */
const DiffStat = ({ additions, deletions }: { readonly additions: number; readonly deletions: number }) => (
  <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
    <span className="text-diff-addition" data-testid="diff-additions">{`+${additions}`}</span>
    <span className="text-diff-deletion" data-testid="diff-deletions">{`−${deletions}`}</span>
  </span>
);
