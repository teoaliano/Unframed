import type { ElementChip, ScreenWrite } from "@unframed/contracts";
import { changeTook, continuableChat, DEFAULT_RUNTIME_MODE, DID_NOT_TAKE, elementKind, NO_SOURCE, NOT_SELF_MAPPED, ONLY_THIS_ONE, screenDraftInstruction, type DraftChange } from "@unframed/domain";
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

const chipOf = (shapeId: string, change: DraftChange): ElementChip => {
  const source = change.element.source;
  const where = source === null ? "" : ` · ${source.file}:${source.line}`;
  return {
    shapeId,
    elementId: null,
    selector: change.element.selector,
    tag: change.element.tag,
    label: `${elementKind(change.element.tag)} · ${change.element.name}`,
    excerpt: `<${change.element.tag}>${where}${change.element.component === null ? "" : ` in ${change.element.component}`}`,
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
  const update = (ids: readonly string[], state: ApplyState, reason?: string | null) => {
    const current = runRef.current;
    if (current === undefined) return;
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

  const handOff = async (rows: readonly ApplyRow[]) => {
    const { client, shapeId, instance, state } = latest.current;
    const text = screenDraftInstruction({
      shape: shapeId.replace(/^shape:/, ""),
      branch: instance?.branch ?? "",
      state,
      worktree: instance?.worktree ?? "",
      changes: rows.map((row) => ({ change: row.change, reason: row.reason ?? DID_NOT_TAKE })),
    });
    const ids = rows.map((row) => row.change.id);
    try {
      const setup = repositoryState(client.project).repository.get()?.setupChat;
      let chatId = continuableChat(client.chats().filter((chat) => chat.id !== setup), [shapeId])?.id;
      if (chatId === undefined) {
        if (client.providers === undefined) await client.loadProviders();
        const ready = readyProviders(client.providers);
        if (ready.length === 0) {
          update(ids, "unsent", NO_PROVIDER);
          return;
        }
        chatId = await createChat(client, { modelSelection: { provider: ready[0]!, model: "", traits: {} }, runtimeMode: DEFAULT_RUNTIME_MODE, interactionMode: "default", tags: [shapeId] }, text);
      }
      client.setUi({ open: true, chosen: chatId, pinned: null });
      const ended = turnEnded(client, chatId);
      await sendMessage(client, chatId, { text, selection: [shapeId], attachments: [], elements: rows.map((row) => chipOf(shapeId, row.change)) });
      update(ids, "agent");
      await ended;
      const outcome = await check(rows, CHECK_WINDOW_MS);
      update(outcome.took, "took", null);
      update(outcome.missed, "missed", DID_NOT_TAKE);
    } catch (error) {
      update(ids, "unsent", messageOf(error));
    }
  };

  const apply = async () => {
    const { session, engine, project, instance } = latest.current;
    if (instance === undefined || session.drafts.length === 0 || runRef.current?.busy === true) return;
    const drafts = await Promise.all(
      session.drafts.map(async (change) => {
        if (change.element.source !== null) return change;
        const found = await session.resolve(change.element.stamp);
        if (found === null || found.source === null) return change;
        return { ...change, element: { ...change.element, key: found.key, source: { file: found.source.file, line: found.source.line, col: found.source.col }, component: found.owner, selfMapped: found.selfMapped, instanceIndex: found.instanceIndex, instanceCount: found.instanceCount, tag: found.tag } };
      }),
    );
    const rows: ApplyRow[] = drafts.map((change) => {
      const reason = leftReason(change);
      return { change, state: reason === null ? "writing" : "agent", reason };
    });
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
          return result.written ? { ...row, state: "checking" } : { ...row, state: "agent", reason: result.reason };
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
    if (forAgent.length > 0) await handOff(forAgent);
    setRun({ ...runRef.current!, busy: false });
  };

  const undo = async (): Promise<boolean> => {
    const current = runRef.current;
    const { engine, project } = latest.current;
    if (current === undefined || current.apply === null || current.busy) return false;
    try {
      const answer = await engine.call("screens.revert", { project, apply: current.apply });
      setRun(undefined);
      showNotice(answer.kept.length === 0 ? `Put back ${answer.reverted === 1 ? "the change" : `${answer.reverted} changes`} Apply wrote.` : `Put back ${answer.reverted}; left ${answer.kept.length} that changed since.`, "info");
    } catch (error) {
      showError(messageOf(error));
    }
    return true;
  };

  return { run, apply, undo, clear: () => setRun(undefined) };
};
