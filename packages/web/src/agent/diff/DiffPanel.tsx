import { Menu } from "@base-ui/react/menu";
import type { ArtifactDiffFile } from "@unframed/contracts";
import type { Chat } from "@unframed/domain";
import { PatchDiff } from "@pierre/diffs/react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { Check, ChevronDown, Columns2, Pilcrow, Rows3, TextWrap, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { itemClass, popupClass, Tip } from "../../chrome/ui.tsx";
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
  return (
    <section
      ref={root}
      className="unframed-agent-diff"
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
      <header className="unframed-agent-diff__header">
        <Menu.Root>
          <Menu.Trigger className="unframed-agent-control" aria-label={`Diff scope: ${scopeLabel}`} disabled={!latest}>
            <span className="unframed-agent-control__label">{scopeLabel}</span>
            <ChevronDown size={13} aria-hidden />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="start" sideOffset={4} className="z-[1100]">
              <Menu.Popup className={popupClass}>
                <Menu.RadioGroup value={scope === "all" ? "all" : latest && scope === latest.turnCount ? "latest" : `turn:${scope}`}>
                  {latest && (
                    <Menu.RadioItem className={itemClass} value="latest" closeOnClick onClick={() => choose(latest.turnCount)}>
                      Latest turn
                      <Menu.RadioItemIndicator className="ml-auto">
                        <Check size={13} aria-hidden />
                      </Menu.RadioItemIndicator>
                    </Menu.RadioItem>
                  )}
                  {turns.map((turn) => (
                    <Menu.RadioItem key={turn.turnId} className={itemClass} value={`turn:${turn.turnCount}`} closeOnClick onClick={() => choose(turn.turnCount)}>
                      {`Turn ${turn.turnCount}`}
                      <Menu.RadioItemIndicator className="ml-auto">
                        <Check size={13} aria-hidden />
                      </Menu.RadioItemIndicator>
                    </Menu.RadioItem>
                  ))}
                  <Menu.RadioItem className={itemClass} value="all" closeOnClick onClick={() => choose("all")}>
                    All turns
                    <Menu.RadioItemIndicator className="ml-auto">
                      <Check size={13} aria-hidden />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        <span className="flex-1" />
        <div className="unframed-agent-diff__segmented" role="group" aria-label="Diff layout">
          <Tip label="Stacked" side="bottom">
            <button type="button" className="unframed-agent-control unframed-agent-control--icon" aria-label="Stacked diff view" aria-pressed={layout === "stacked"} onClick={() => setLayout("stacked")}>
              <Rows3 size={14} aria-hidden />
            </button>
          </Tip>
          <Tip label="Split" side="bottom">
            <button type="button" className="unframed-agent-control unframed-agent-control--icon" aria-label="Split diff view" aria-pressed={layout === "split"} onClick={() => setLayout("split")}>
              <Columns2 size={14} aria-hidden />
            </button>
          </Tip>
        </div>
        <Tip label={wrap ? "Disable line wrapping" : "Enable line wrapping"} side="bottom">
          <button type="button" className="unframed-agent-control unframed-agent-control--icon" aria-label={wrap ? "Disable line wrapping" : "Enable line wrapping"} aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
            <TextWrap size={14} aria-hidden />
          </button>
        </Tip>
        <Tip label={ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"} side="bottom">
          <button
            type="button"
            className="unframed-agent-control unframed-agent-control--icon"
            aria-label={ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
            aria-pressed={ignoreWhitespace}
            onClick={() => setIgnoreWhitespace(!ignoreWhitespace)}
          >
            <Pilcrow size={14} aria-hidden />
          </button>
        </Tip>
        <Tip label="Close" side="bottom">
          <button type="button" className="unframed-agent-control unframed-agent-control--icon" aria-label="Close diff" onClick={close}>
            <X size={14} aria-hidden />
          </button>
        </Tip>
      </header>
      {!latest ? (
        <p className="unframed-agent-diff__empty">No completed turns yet.</p>
      ) : current && "error" in current ? (
        <p className="unframed-agent-diff__empty" role="alert">
          {current.error}
        </p>
      ) : !files ? (
        <p className="unframed-agent-diff__empty" role="status">
          Loading changes…
        </p>
      ) : files.length === 0 ? (
        <p className="unframed-agent-diff__empty">No page or motion changed in this selection.</p>
      ) : (
        <div className="unframed-agent-diff__body">
          <nav className="unframed-agent-diff__files" aria-label="Changed files">
            {files.map((file) => (
              <button
                key={file.shapeId}
                type="button"
                className="unframed-agent-diff__file"
                aria-current={diff.shapeId === file.shapeId ? "true" : undefined}
                onClick={() => {
                  client.setUi({ diff: { ...diff, shapeId: file.shapeId } });
                  root.current?.querySelector(`[data-diff-file="${CSS.escape(file.shapeId)}"]`)?.scrollIntoView({ block: "start" });
                }}
              >
                <span className="unframed-agent-diff__file-label">{file.label}</span>
                <span className="unframed-agent-diff__added">{`+${file.additions}`}</span>
                <span className="unframed-agent-diff__removed">{`−${file.deletions}`}</span>
              </button>
            ))}
          </nav>
          <WorkerPoolContextProvider poolOptions={POOL} highlighterOptions={HIGHLIGHTER}>
            <div className="unframed-agent-diff__patches">
              {files.map((file) => (
                <article key={file.shapeId} className="unframed-agent-diff__patch" data-diff-file={file.shapeId} aria-label={file.label}>
                  <header className="unframed-agent-diff__patch-header">
                    <span className="unframed-agent-diff__file-label">{file.label}</span>
                    <span className="unframed-agent-diff__names">{`${file.before ?? "new"} → ${file.after ?? "removed"}`}</span>
                  </header>
                  {file.tooLarge ? (
                    <p className="unframed-agent-diff__empty">{file.patch}</p>
                  ) : (
                    <PatchDiff
                      patch={file.patch}
                      options={{ diffStyle: layout === "split" ? "split" : "unified", overflow: wrap ? "wrap" : "scroll", disableFileHeader: true, themeType: "system", theme: HIGHLIGHTER.theme, lineDiffType: "none" }}
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
