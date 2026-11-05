import { randomUUID } from "node:crypto";
import { runOriginId, type NodeRunMarker, type NodeVersion } from "@unframed/contracts";
import type { TLRecord } from "@tldraw/tlschema";
import * as Effect from "effect/Effect";
import type { CanvasChange, CanvasRooms, ChangeOrigin } from "../canvas/rooms.ts";
import { errorText, logError } from "../log.ts";

type Get = (id: string) => TLRecord | undefined;
type NodeRecord = TLRecord & { type: "node"; props: Record<string, unknown> & { versions: NodeVersion[]; currentVersionId: string | null; run?: NodeRunMarker; error?: string } };

export const isNode = (record: TLRecord | undefined): record is NodeRecord => record?.typeName === "shape" && (record as { type?: string }).type === "node";

export const nodeOrigin = (runId: string): ChangeOrigin => ({ kind: "server", id: runOriginId(runId) });

const put = (node: NodeRecord, props: Record<string, unknown>): CanvasChange => ({ put: [{ ...node, props } as unknown as TLRecord], remove: [] });

const withoutKeys = (props: Record<string, unknown>, ...keys: string[]) => {
  const next = { ...props };
  for (const key of keys) delete next[key];
  return next;
};

/** The change that puts a run's versions on a node: running, newest first, with the node's run marker. */
export const startVersions = (
  get: Get,
  shapeId: string,
  input: { readonly runId: string; readonly chainId: string | null; readonly batchId: string; readonly count: number; readonly fingerprint: string; readonly startedAt: number; readonly durable?: boolean },
): { change: CanvasChange; ids: string[] } | undefined => {
  const node = get(shapeId);
  if (!isNode(node)) return undefined;
  const createdAt = new Date(input.startedAt).toISOString();
  const made: NodeVersion[] = Array.from({ length: input.count }, (_, index) => ({
    id: `v-${randomUUID().slice(0, 12)}`,
    runId: input.runId,
    chainId: input.chainId,
    batchId: input.batchId,
    runIndex: index + 1,
    status: "running",
    fingerprint: input.fingerprint,
    createdAt,
    ...(input.durable ? { durable: true } : {}),
  }));
  const props = withoutKeys(node.props, "error");
  return {
    change: put(node, { ...props, versions: [...made].reverse().concat(node.props.versions), run: { runId: input.runId, chainId: input.chainId, startedAt: input.startedAt } }),
    ids: made.map((version) => version.id),
  };
};

/** Fills one running version with what landed. */
export const fillVersion = (get: Get, shapeId: string, versionId: string, landed: { readonly file?: string; readonly fileName?: string; readonly text?: string }): CanvasChange | undefined => {
  const node = get(shapeId);
  if (!isNode(node) || !node.props.versions.some((version) => version.id === versionId)) return undefined;
  const versions = node.props.versions.map((version): NodeVersion => {
    if (version.id !== versionId) return version;
    const { error: _error, ...rest } = version;
    return { ...rest, status: "done", ...landed };
  });
  return put(node, { ...node.props, versions });
};

/** Takes a version that will not land off its node. */
export const dropVersion = (get: Get, shapeId: string, versionId: string): CanvasChange | undefined => {
  const node = get(shapeId);
  if (!isNode(node) || !node.props.versions.some((version) => version.id === versionId)) return undefined;
  const versions = node.props.versions.filter((version) => version.id !== versionId);
  const current = node.props.currentVersionId === versionId ? (versions.find((version) => version.status === "done" && version.error === undefined)?.id ?? null) : node.props.currentVersionId;
  return put(node, { ...node.props, versions, currentVersionId: current });
};

/** A durable version whose render failed: it stays, with its error. */
export const failVersion = (get: Get, shapeId: string, versionId: string, error: string): CanvasChange | undefined => {
  const node = get(shapeId);
  if (!isNode(node)) return undefined;
  const versions = node.props.versions.map((version): NodeVersion => (version.id === versionId ? { ...version, status: "done", error } : version));
  return put(node, { ...node.props, versions });
};

/**
 * A run ended: its marker goes, the landed output with the lowest run index becomes current,
 * and a run that landed nothing leaves its failure on the node.
 */
export const finishRun = (get: Get, shapeId: string, runId: string, errors: ReadonlyArray<string>): CanvasChange | undefined => {
  const node = get(shapeId);
  if (!isNode(node)) return undefined;
  const landed = node.props.versions
    .filter((version) => version.runId === runId && version.status === "done" && version.error === undefined)
    .sort((a, b) => a.runIndex - b.runIndex)[0];
  const props = node.props.run?.runId === runId ? withoutKeys(node.props, "run") : { ...node.props };
  if (landed) return put(node, { ...withoutKeys(props, "error"), currentVersionId: landed.id });
  const error = errors.filter((each) => each !== "").join("; ");
  return put(node, error === "" ? props : { ...props, error });
};

/** Marks the steps of a chain that have not started: queued, so nothing else runs them. */
export const queueNodes = (get: Get, ids: ReadonlyArray<string>, chainId: string, startedAt: number): CanvasChange => {
  const records: TLRecord[] = [];
  for (const id of ids) {
    const node = get(id);
    if (!isNode(node)) continue;
    records.push({ ...node, props: { ...withoutKeys(node.props, "error"), run: { runId: "", chainId, startedAt } } } as unknown as TLRecord);
  }
  return { put: records, remove: [] };
};

/** A node that will not run: its queue marker goes and the reason stays. */
export const stopNode = (get: Get, id: string, reason: string, chainId?: string): CanvasChange | undefined => {
  const node = get(id);
  if (!isNode(node)) return undefined;
  if (chainId !== undefined && node.props.run !== undefined && (node.props.run.chainId !== chainId || node.props.run.runId !== "")) return undefined;
  return put(node, { ...withoutKeys(node.props, "run"), error: reason });
};

/** Applies a node change decided from the room as it is now, logging a failure rather than throwing. */
export const applyNodeChange = (
  rooms: CanvasRooms["Service"],
  runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
  project: string,
  decide: (get: Get) => CanvasChange | undefined,
  runId: string,
): Promise<boolean> =>
  runPromise(rooms.applyWhen(project, decide, nodeOrigin(runId))).then(
    (applied) => applied !== undefined,
    (error: unknown) => {
      logError(`${runId}: could not update the node: ${errorText(error)}`);
      return false;
    },
  );

/** Where a node run lands: the node, its chain and step, and what its inputs were. */
export interface NodeTarget {
  readonly shapeId: string;
  readonly chainId: string | null;
  readonly step?: number | undefined;
  readonly fingerprint: string;
  readonly onFinished?: ((outcome: { readonly succeeded: number; readonly errors: ReadonlyArray<string> }) => void) | undefined;
}

export const nodeSidecarFields = (target: NodeTarget | undefined, versionId: string | undefined) =>
  target === undefined || versionId === undefined
    ? {}
    : {
        node: { shapeId: target.shapeId, versionId },
        ...(target.chainId === null || target.step === undefined ? {} : { chain: { chainId: target.chainId, step: target.step } }),
      };
