import type { ElementChip, ScreenWrite } from "@unframed/contracts";
import { changeTook, continuableChat, DEFAULT_RUNTIME_MODE, DID_NOT_TAKE, elementKind, NO_SOURCE, NOT_IN_WORKTREE, NOT_SELF_MAPPED, ONLY_THIS_ONE, oneLine, screenDraftInstruction, type DraftChange, type DraftSource } from "@unframed/domain";
import { useRef, useState } from "react";
import { readyProviders } from "../agent/providers.ts";
import { createChat, sendMessage } from "../agent/send.ts";
import { messageOf, type ChatClient } from "../agent/store.ts";
import type { EditSession, MeasureTarget } from "../artifacts/editor/editSession.ts";
import type { EngineConnection } from "../rpc/engine.ts";
import { showError, showNotice } from "../toasts.tsx";
import { NO_PROVIDER } from "./askAgent.ts";
import { repositoryState } from "./store.ts";

export type ApplyState = "writing" | "checking" | "took" | "missed" | "agent" | "unsent";

export interface ApplyRow {
  readonly change: DraftChange;
  readonly state: ApplyState;
  readonly reason: string | null;
}

export interface ApplyRun {
  readonly apply: string | null;
  readonly rows: readonly ApplyRow[];
  readonly busy: boolean;
}

export const APPLY_STATE_TEXT: Readonly<Record<ApplyState, string>> = {
  writing: "Writing…",
  checking: "Checking…",
  took: "Took",
  missed: "Did not take",
  agent: "With the agent",
  unsent: "Not sent",
};


const UPDATE_WAIT_MS = 10_000;
const CHECK_WINDOW_MS = 6_000;
const CHECK_EVERY_MS = 400;
const AGENT_TURN_MS = 20 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const targetOf = (change: DraftChange): MeasureTarget => ({
  ...(change.element.key === null ? {} : { key: change.element.key, index: change.element.instanceIndex }),
  stamp: change.element.stamp,
  selector: change.element.selector,
  properties: change.kind === "text" || change.kind === "attr" ? [] : [change.property],
  attributes: change.kind === "attr" ? [change.property] : [],
});

const writeOf = (change: DraftChange): ScreenWrite | undefined => {
  const source = change.element.source;
  if (source === null) return undefined;
  return { id: change.id, kind: change.kind, property: change.property, before: change.before, after: change.after, file: source.file, line: source.line, col: source.col, tag: change.element.tag };
};

const leftReason = (change: DraftChange): string | null => {
  if (change.element.source === null) return NO_SOURCE;
  if (!change.element.selfMapped) return NOT_SELF_MAPPED;
  if (change.scope === "one" && change.element.instanceCount > 1) return ONLY_THIS_ONE;
  return null;
};

const chipOf = (shapeId: string, change: DraftChange, at: DraftSource | null): ElementChip => {
  const kind = elementKind(change.element.tag);
  const tag = /^[a-z][a-z0-9-]{0,63}$/.test(change.element.tag) ? change.element.tag : "element";
  return {
    shapeId,
    elementId: null,
    selector: oneLine(change.element.selector, 300),
    tag,
    label: oneLine(`${kind} · ${change.element.name}`, 80),
    excerpt: `<${tag}>`,
    ...(at === null ? {} : { source: JSON.stringify(oneLine(at.file, 300)) + `:${at.line}:${at.col}${change.element.component === null ? "" : ` in ${JSON.stringify(oneLine(change.element.component, 80))}`}` }),
  };
};

const turnEnded = (client: ChatClient, chatId: string): Promise<void> =>
  new Promise((resolve) => {
    let seenRunning = false;
    const timer = window.setTimeout(finish, AGENT_TURN_MS);
    const stop = client.subscribe("shell", check);
    function check() {
      const chat = client.chats().find((each) => each.id === chatId);
      if (chat?.status === "running") seenRunning = true;
      else if (seenRunning) finish();
    }
    function finish() {
      window.clearTimeout(timer);
      stop();
      resolve();
    }
    check();
  });

export interface ScreenApplyInput {
  readonly engine: EngineConnection;
  readonly project: string;
  readonly shapeId: string;
  readonly instance: { readonly id: string; readonly branch: string; readonly worktree: string } | undefined;
  readonly state: string;
  readonly session: EditSession;
  readonly client: ChatClient;
}

export const useScreenApply = (input: ScreenApplyInput) => {
  const [run, setRunState] = useState<ApplyRun | undefined>(undefined);
  const runRef = useRef<ApplyRun | undefined>(undefined);
  const latest = useRef(input);
  latest.current = input;
  const setRun = (next: ApplyRun | undefined) => {
    runRef.current = next;
    setRunState(next);
  };
  const generation = useRef(0);
  const resolving = useRef(false);
  const update = (ids: readonly string[], state: ApplyState, reason?: string | null, of = generation.current) => {
    const current = runRef.current;
    if (current === undefined || of !== generation.current) return;
    setRun({ ...current, rows: current.rows.map((row) => (ids.includes(row.change.id) ? { ...row, state, reason: reason === undefined ? row.reason : reason } : row)) });
  };

  const check = async (rows: readonly ApplyRow[], window: number): Promise<{ took: string[]; missed: string[] }> => {
    const { session } = latest.current;
    const pending = new Map(rows.map((row) => [row.change.id, row.change]));
    const took: string[] = [];
    const ends = Date.now() + window;
    while (pending.size > 0) {
      const asked = [...pending.values()];
      const results = await session.measure(asked.map(targetOf));
      asked.forEach((change, index) => {
        const measured = results[index];
        if (measured !== undefined && changeTook(change, measured)) {
          took.push(change.id);
          pending.delete(change.id);
        }
      });
      if (pending.size === 0 || Date.now() > ends) break;
      await sleep(CHECK_EVERY_MS);
    }
    return { took, missed: [...pending.keys()] };
  };

  const confirmed = (change: DraftChange): Promise<DraftSource | null> => {
    const { engine, project, instance } = latest.current;
    const source = change.element.source;
    if (source === null || instance === undefined) return Promise.resolve(null);
    return engine
      .call("screens.inspect", { project, instance: instance.id, file: source.file, line: source.line, col: source.col, tag: change.element.tag })
      .then(
        (found): DraftSource => ({ file: found.file, line: found.line, col: found.col, endLine: found.endLine, endCol: found.endCol }),
        () => null,
      );
  };

  const handOff = async (rows: readonly ApplyRow[], of: number) => {
    const { client, shapeId, instance, state } = latest.current;
    const places = await Promise.all(rows.map((row) => confirmed(row.change)));
    const text = screenDraftInstruction({
      shape: shapeId.replace(/^shape:/, ""),
      branch: instance?.branch ?? "",
      state,
      worktree: instance?.worktree ?? "",
      changes: rows.map((row, index) => ({ change: row.change, reason: row.reason ?? DID_NOT_TAKE, at: places[index] ?? null })),
    });
    const ids = rows.map((row) => row.change.id);
    try {
      const setup = repositoryState(client.project).repository.get()?.setupChat;
      let chatId = continuableChat(client.chats().filter((chat) => chat.id !== setup), [shapeId])?.id;
      if (chatId === undefined) {
        if (client.providers === undefined) await client.loadProviders();
        const ready = readyProviders(client.providers);
        if (ready.length === 0) {
          update(ids, "unsent", NO_PROVIDER, of);
          return;
        }
        chatId = await createChat(client, { modelSelection: { provider: ready[0]!, model: "", traits: {} }, runtimeMode: DEFAULT_RUNTIME_MODE, interactionMode: "default", tags: [shapeId] }, text);
      }
      client.setUi({ open: true, chosen: chatId, pinned: null });
      const ended = turnEnded(client, chatId);
      await sendMessage(client, chatId, { text, selection: [shapeId], attachments: [], elements: rows.map((row, index) => chipOf(shapeId, row.change, places[index] ?? null)) });
      update(ids, "agent", undefined, of);
      await ended;
      if (of !== generation.current) return;
      const outcome = await check(rows, CHECK_WINDOW_MS);
      update(outcome.took, "took", null, of);
      update(outcome.missed, "missed", DID_NOT_TAKE, of);
    } catch (error) {
      update(ids, "unsent", messageOf(error), of);
    }
  };

  const apply = async () => {
    const { session, engine, project, instance } = latest.current;
    if (instance === undefined || session.drafts.length === 0 || runRef.current?.busy === true || resolving.current) return;
    resolving.current = true;
    const drafts = await Promise.all(
      session.drafts.map(async (change) => {
        const found = await session.resolve(change.element.stamp, true);
        if (found === null || found.source === null) return { ...change, element: { ...change.element, source: null } };
        return { ...change, element: { ...change.element, key: found.key, source: { file: found.source.file, line: found.source.line, col: found.source.col }, component: found.owner, selfMapped: found.selfMapped, instanceIndex: found.instanceIndex, instanceCount: found.instanceCount, tag: found.tag } };
      }),
    ).finally(() => {
      resolving.current = false;
    });
    const rows: ApplyRow[] = drafts.map((change) => {
      const reason = leftReason(change);
      return { change, state: reason === null ? "writing" : "agent", reason };
    });
    generation.current += 1;
    const of = generation.current;
    setRun({ apply: null, rows, busy: true });
    const writes = rows.filter((row) => row.state === "writing").flatMap((row) => writeOf(row.change) ?? []);
    try {
      const answer = writes.length === 0 ? { apply: null, results: [] } : await engine.call("screens.apply", { project, instance: instance.id, changes: writes });
      const current = runRef.current!;
      setRun({
        ...current,
        apply: answer.apply,
        rows: current.rows.map((row) => {
          const result = answer.results.find((each) => each.id === row.change.id);
          if (result === undefined) return row;
          return result.written ? { ...row, state: "checking" } : { ...row, state: "agent", reason: result.file === null ? NOT_IN_WORKTREE : result.reason };
        }),
      });
    } catch (error) {
      showError(messageOf(error));
      setRun({ ...runRef.current!, busy: false });
      return;
    }
    session.discard();
    const checking = runRef.current!.rows.filter((row) => row.state === "checking");
    if (checking.length > 0) {
      await session.nextUpdate(UPDATE_WAIT_MS);
      const outcome = await check(checking, CHECK_WINDOW_MS);
      update(outcome.took, "took", null);
      update(outcome.missed, "agent", DID_NOT_TAKE);
    }
    const forAgent = runRef.current!.rows.filter((row) => row.state === "agent");
    setRun({ ...runRef.current!, busy: false });
    if (forAgent.length > 0) await handOff(forAgent, of);
  };

  const undo = async (): Promise<boolean> => {
    const current = runRef.current;
    const { engine, project } = latest.current;
    if (current === undefined || current.apply === null || current.busy) return false;
    try {
      const answer = await engine.call("screens.revert", { project, apply: current.apply });
      generation.current += 1;
      setRun(undefined);
      showNotice(answer.kept.length === 0 ? `Put back ${answer.reverted === 1 ? "the change" : `${answer.reverted} changes`} Apply wrote.` : `Put back ${answer.reverted}; left ${answer.kept.length} that changed since.`, "info");
    } catch (error) {
      showError(messageOf(error));
    }
    return true;
  };

  return {
    run,
    apply,
    undo,
    clear: () => {
      generation.current += 1;
      setRun(undefined);
    },
  };
};
