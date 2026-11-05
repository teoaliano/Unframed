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

export const startVersions = (
  get: Get,
  shapeId: string,
  input: { readonly runId: string; readonly chainId: string | null; readonly claim: string; readonly batchId: string; readonly count: number; readonly fingerprint: string; readonly startedAt: number; readonly durable?: boolean },
): { change: CanvasChange; ids: string[] } | undefined => {
  const node = get(shapeId);
  if (!isNode(node)) return undefined;
  const marker = node.props.run;
  if (marker !== undefined && !(marker.runId === "" && marker.chainId === input.claim)) return undefined;
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

export const dropVersion = (get: Get, shapeId: string, versionId: string): CanvasChange | undefined => {
  const node = get(shapeId);
  if (!isNode(node) || !node.props.versions.some((version) => version.id === versionId)) return undefined;
  const versions = node.props.versions.filter((version) => version.id !== versionId);
  const current = node.props.currentVersionId === versionId ? (versions.find((version) => version.status === "done" && version.error === undefined)?.id ?? null) : node.props.currentVersionId;
  return put(node, { ...node.props, versions, currentVersionId: current });
};

export const failVersion = (get: Get, shapeId: string, versionId: string, error: string): CanvasChange | undefined => {
  const node = get(shapeId);
  if (!isNode(node)) return undefined;
  const versions = node.props.versions.map((version): NodeVersion => (version.id === versionId ? { ...version, status: "done", error } : version));
  return put(node, { ...node.props, versions });
};

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

export const claimNodes = (get: Get, ids: ReadonlyArray<string>, chainId: string, startedAt: number): { readonly change: CanvasChange } | { readonly busy: string } => {
  const records: TLRecord[] = [];
  for (const id of ids) {
    const node = get(id);
    if (!isNode(node)) continue;
    if (node.props.run !== undefined) return { busy: id };
    records.push({ ...node, props: { ...withoutKeys(node.props, "error"), run: { runId: "", chainId, startedAt } } } as unknown as TLRecord);
  }
  return { change: { put: records, remove: [] } };
};

export const stopNode = (get: Get, id: string, reason: string, chainId?: string): CanvasChange | undefined => {
  const node = get(id);
  if (!isNode(node)) return undefined;
  if (chainId !== undefined && node.props.run !== undefined && (node.props.run.chainId !== chainId || node.props.run.runId !== "")) return undefined;
  return put(node, { ...withoutKeys(node.props, "run"), error: reason });
};

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

export interface NodeTarget {
  readonly shapeId: string;
  readonly claim: string;
  readonly chainId: string | null;
  readonly step?: number | undefined;
  readonly fingerprint: string;
  readonly onFinished?: ((outcome: { readonly succeeded: number; readonly errors: ReadonlyArray<string>; readonly cost: number | null }) => void) | undefined;
}

export const nodeSidecarFields = (target: Pick<NodeTarget, "shapeId" | "chainId" | "step"> | undefined, versionId: string | undefined) =>
  target === undefined || versionId === undefined
    ? {}
    : {
        node: { shapeId: target.shapeId, versionId },
        ...(target.chainId === null || target.step === undefined ? {} : { chain: { chainId: target.chainId, step: target.step } }),
      };
